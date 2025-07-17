import * as amqp from "amqplib";
import { Worker } from "./Worker";
import Supervisor from "../supervisor";
import { v4 as uuidv4 } from "uuid";
import log from "../utils/log";
import { Message, sendMessage, sendMessagetoSupervisor } from "../utils/handleMessage";
import { RABBITMQ_URL } from "../configs/env";
export class RabbitMQWorker implements Worker {
	private instanceId: string;
	public isBusy: boolean = false; // Add isBusy property to track worker status
	private string_connection: string;
	private connection: amqp.ChannelModel | null = null; // Use null to indicate uninitialized state

	private consumeQueue: string = process.env.consumeQueue;
	private consumeCompensationQueue: string =process.env.consumeCompensationQueue; // Add compensation queue
	private consumeChannel: any;

	private produceQueue: string = process.env.produceQueue;
	private produceChannel: amqp.Channel;

	constructor() {
		this.instanceId = `RabbitMqWorker-${uuidv4()}`;
		this.string_connection = process.env.rabbitMqUrl || RABBITMQ_URL;
		this.run().catch((error) => {
			log(
				`[RabbitMQWorker] Error in run method: ${error.message}`,
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
			if (!this.string_connection) {
				throw new Error("Connection string is not provided");
			}
			this.connection = await amqp.connect(this.string_connection, {
				heartbeat: 60,
				timeout: 10000,
			});
			log(
				`[RabbitMQWorker] Connected to RabbitMQ at ${this.string_connection}`,
				"success"
			);
			this.connection.on("error", (error: Error) => {
				log(
					`[RabbitMQWorker] Connection error: ${error.message}`,
					"error"
				);
			});
			this.connection.on("close", (reason) => {
				sendMessagetoSupervisor({
					messageId: uuidv4(),
					status: "error",
					reason: reason.message || reason.toString(),
					data: [],
				});
				log(
					`[RabbitMQWorker] Connection closed ${reason}`,
					"error"
				);
			});
			this.connection.on("blocked", (reason: string) => {
				sendMessagetoSupervisor({
					messageId: uuidv4(),
					status: "error",
					data: [],
					destination: [],
				});
				log(
					`[RabbitMQWorker] Connection blocked: ${reason}`,
					"error"
				);
			});
			this.healthCheck();
			this.listenTask().catch((error) =>
				log(
					`[RabbitMQWorker] Error in linstenTask method: ${error.message}`,
					"error"
				)
			);
			log(
				`[RabbitMQWorker] instanceId: ${this.instanceId} is running`,
				"success"
			);
			await this.consumeMessage(this.consumeQueue);
		} catch (error) {
			log(
				`[RabbitMQWorker] Failed to run worker: ${error.message}`,
				"error"
			);
			throw error;
		}
	}
	public async consumeMessage(queueName: string): Promise<void> {
		if (!this.connection) {
			log("[RabbitMQWorker] Connection is not established", "error");
			throw new Error("Connection is not established");
		}
		this.consumeChannel = await this.connection.createChannel();
		await this.consumeChannel.assertQueue(queueName, {
			durable: true,
		});
		log(
			`[RabbitMQWorker] Listening to consume queue: ${queueName}`,
			"info"
		);
		this.consumeChannel.consume(
			queueName,
			(msg) => {
				if (msg !== null) {
					const messageContent = msg.content.toString();
					if (queueName === this.consumeQueue) {
						sendMessagetoSupervisor({
							messageId: uuidv4(),
							status: "completed",
							data: JSON.parse(messageContent),
							destination: [],
						});
					} else if (
						queueName === this.consumeCompensationQueue
					) {
						// sendMessagetoSupervisor({
						// 	messageId: uuidv4(),
						// 	status: "error",
						// 	reason: "ROLLBACK",
						// 	data: JSON.parse(messageContent),
						// 	destination: "DatabaseInteractionWorker",
						// });
					}
				}
			},
			{ noAck: true }
		);
	}
	public async produceMessage(
		data: any,
		queueName: string = this.produceQueue
	): Promise<void> {
		try {
			this.produceChannel = await this.connection.createChannel();
			await this.produceChannel.assertQueue(queueName, {
				durable: true,
			});
			if (!this.produceChannel) {
				throw new Error("Produce channel is not initialized");
			}
			const messageBuffer = Buffer.from(JSON.stringify({
				projectId: data._id,
				keyword: data.keyword,
				language: data.language,
				start_date_crawl: data.start_date_crawl,
				end_date_crawl: data.end_date_crawl,
				tweetToken: data.tweetToken,
			}));
			this.produceChannel.sendToQueue(
				queueName, // Use the specified queue name
				messageBuffer,
				{ persistent: true }
			);
		} catch (error) {
			console.error("Failed to send message to RabbitMQ:", error);
		}
	}
	async listenTask(): Promise<void> {
		try {
			process.on("message", async (message: Message) => {
				const { messageId, data, status, reason,destination } = message;
				log(
					`[RabbitMQWorker] Received message: ${messageId}`,
					"info"
				);
				const destinationFiltered = destination.filter((d) => d.includes("RabbitMQWorker"));
				destinationFiltered.forEach((dest) => {
					const destinationSplited = dest.split("/");
					const path = destinationSplited[1]; // Get the path from the destination

					this[path](data, this.produceQueue)
						.then(() => {
							log(
								`[RabbitMQWorker] Message ${messageId} sent to consume queue`,
								"info"
							);
						})
						.catch((error) => {
							log(
								`[RabbitMQWorker] Error sending message ${messageId} to consume queue: ${error.message}`,
								"error"
							);
						});
					
				});
				
					
					
			});
			// await this.produceMessage(task);
		} catch (error) {
			log(
				`[RabbitMQWorker] Error listening to task: ${error.message}`,
				"error"
			);
			throw error;
		}
	}
}

new RabbitMQWorker()