import { Worker } from "./Worker";
import { v4 as uuidv4 } from "uuid";
import log from "../utils/log";
import { Controller, Get, attachControllers,Request,Response, Post, Params } from "@decorators/express";
import express, { Express } from "express";
import * as jwt from "jsonwebtoken";
import EventEmitter from "events";
import Idempotent from "../utils/Imdempotent";

import {
	Message,
	sendMessage,
	sendMessagetoSupervisor,
} from "../utils/handleMessage";
type RequestType ={
  request: any
  response: any
}
@Controller("/")
export class RestApiWorker implements Worker {
	private instanceId: string;
	public isBusy: boolean = false; // Add isBusy property to track worker status
	private eventEmitter: EventEmitter = new EventEmitter();
	private requests: Map<String, RequestType> = new Map();
	constructor() {
		this.instanceId = `RestApiWorker-${uuidv4()}`;
		this.run().catch((error) => {
			console.log(error);
			log(
				`[RestApiWorker] Error in run method: ${error.message}`,
				"error"
			);
		});
	}
	healthCheck(): void {
		setInterval(
			() =>
				sendMessagetoSupervisor({
					messageId: uuidv4(),
					status: "healthy",
					data: {
						instanceId: this.instanceId,
						timestamp: new Date().toISOString(),
					},
				}),
			10000
		);
	}

	public getInstanceId(): string {
		return this.instanceId;
	}
	public async run(): Promise<void> {
		try {
			log(
				`[RestApiWorker] Starting worker with ID: ${this.instanceId}`,
				"info"
			);
			this.healthCheck();
			await this.listenTask();
			log(`[RestApiWorker] Worker is ready to receive tasks`, "info");
		} catch (error) {
			log(
				`[RabbitMQWorker] Failed to run worker: ${error.message}`,
				"error"
			);
		}
	}

	async listenTask(): Promise<void> {
		try {
			process.on("message", async (message: Message) => {
				const { messageId, data, status, reason, destination } =
					message;
				log(
					`[RestApiWorker] Received message: ${messageId}`,
					"info"
				);
				const destinationFiltered = destination.filter((d) =>
					d.includes("RestApiWorker")
				);
				destinationFiltered.forEach((dest) => {
					log(
						`[RestApiWorker] Processing message for destination: ${dest}`,
						"info"
					);
					const destinationSplited = dest.split("/");
					const path = destinationSplited[1]; // Get the path from the destination
					this[path](message);
				});
			});
		} catch (error) {
			log(
				`[RabbitMQWorker] Error listening to task: ${error.message}`,
				"error"
			);
			throw error;
		}
	}
	async onProcessedMessage(message: Message) {
		const { messageId, data } = message;
		log(
			`[RestApiWorker] Processing completed message with ID: ${messageId}`,
			"info"
		);
		// this.requests[messageId].response.json(data)
		this.eventEmitter.emit("message", {
			messageId,
			data,
			status: "completed",
		});
		log(
			`[RestApiWorker] Processed message with ID: ${messageId}`,
			"info"
		);
	}

	//routing

	async getuserId(authorization: string, res) {
		return new Promise((resolve, reject) => {
			if (!authorization) {
				log(`[RestApiWorker] Unauthorized access attempt`, "warn");
				reject(new Error("Unauthorized"));
			}
			const token = authorization.split(" ")[1];
			console.log(process.env.jwt_secret);
			jwt.verify(
				token,
				process.env.jwt_secret as string,
				(err, decoded) => {
					if (err) {
						log(`[RestApiWorker] Invalid token`, "warn");
						console.error(
							`[RestApiWorker] Token verification failed: ${err.message}`
						);
						reject(err);
					}
					console.log(decoded);
					if (typeof decoded !== "string" && "_id" in decoded) {
						resolve(decoded._id);
					}
					log(`[RestApiWorker] Invalid token payload`, "warn");
					reject(new Error("Invalid token payload"));
					log(
						`[RestApiWorker] Token verified successfully`,
						"info"
					);
				}
			);
		});
	}
	async sendMessageToOtherWorker(data: any, destination: string[]) {
		return new Promise((resolve, reject) => {
			const messageId = uuidv4();
			sendMessagetoSupervisor({
				messageId,
				status: "completed",
				data,
				destination,
			});
			this.eventEmitter.on("message", (message: Message) => {
				if (message.messageId === messageId) {
					log(
						`[RestApiWorker] Received message for ID: ${messageId}`,
						"info"
					);
					resolve(message.data == null ? {} : message.data);
					log(
						`[RestApiWorker] Response sent for ID: ${messageId}`,
						"info"
					);
				}
			});
		});
	}

	@Get("/")
	async getData(@Request() req, @Response() res) {
		try {
			const userId = await this.getuserId(
				req.headers.authorization,
				res
			);
			console.log(userId);
			const result = await this.sendMessageToOtherWorker({}, [
				`DatabaseInteractionWorker/getAllData/${userId}`,
			]);
			console.log({result});
			if (result) {
				res.json({ data: result });
			}
		} catch (error) {
			console.log(error);
			log(
				`[RestApiWorker] Error in getData: ${error.message}`,
				"error"
			);
			return res.json({ error: error.message });
		}
	}
	@Get("/:id")
	async getDataById(
		@Request() req,
		@Response() res,
		@Params("id") id: string
	) {
		try {
			// const userId = await this.getuserId(
			// 	req.headers.authorization,
			// 	res
			// );

			if (!id) {
				log(`[RestApiWorker] Data ID not provided`, "warn");
				return res
					.status(400)
					.json({ error: "Data ID is required" });
			}
			const result = await this.sendMessageToOtherWorker({}, [
				`DatabaseInteractionWorker/getDataById/${id}`,
			]);
			if (result) {
				res.json({ data: result });
			}
		} catch (error) {
			console.log(error);
			log(
				`[RestApiWorker] Error in getData: ${error.message}`,
				"error"
			);
			return res.json({ error: error.message });
		}
	}

	@Post("/")
	async postData(@Request() req, @Response() res) {
		const {
			title,
			description,
			category,
			keyword,
			language,
			tweetToken,
			start_date_crawl,
			end_date_crawl,
		} = req.body;
		try {
			const userId = await this.getuserId(
				req.headers.authorization,
				res
			);

			const idempotentKey = req.headers["idempotent-key"];
			if (!idempotentKey) {
				log(`[RestApiWorker] Idempotent key not provided`, "warn");
				return res
					.status(400)
					.json({ error: "Idempotent key required" });
			}
			// Check if the idempotent key already exists
			const idempotent = new Idempotent();
			const isIdempotent = await idempotent.checkIdempotent(
				idempotentKey
			);
			if (isIdempotent) {
				log(
					`[RestApiWorker] Idempotent operation detected for key: ${idempotentKey}`,
					"warn"
				);
				const data = this.sendMessageToOtherWorker(
					{
						keyword,
						start_date_crawl,
						end_date_crawl,
					},
					[`DatabaseInteractionWorker/getDataByKeywordAndRange`]
				);
				return res.status(208).json({
					data,
					message: "Operation already processed",
				});
			}
			// Set the idempotent key to prevent duplicate processing
			await idempotent.setIdempotent(idempotentKey, "processed");

			const result = await this.sendMessageToOtherWorker(
				{
					title,
					description,
					keyword,
					language,
					tweetToken,
					topic_category: category,
					start_date_crawl: new Date(start_date_crawl),
					end_date_crawl: new Date(end_date_crawl),
					userId: userId as string,
				},
				[`DatabaseInteractionWorker/createNewData`]
			);
			log(`[RestApiWorker] Data created successfully`, "success");

			idempotent.removeIdempotent(idempotentKey);
			return res.status(201).json({ data: result });
		} catch (error) {
			log(
				`[RestApiWorker] Error in postData: ${error.message}`,
				"error"
			);
			return res.status(500).json({ error: "Internal Server Error" });
		}
	}
}


 const app: Express = express();
 app.use(express.json());
 attachControllers(app, [RestApiWorker]);
 const port = process.env.port || 4000;
 app.listen(port, () => {
		log(`[RestApiWorker] Server is running on port ${port}`, "info");
 });