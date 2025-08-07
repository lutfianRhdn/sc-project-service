import { Worker } from "./Worker";
import { v4 as uuidv4 } from "uuid";
import log from "../utils/log";
import express, { Express } from "express";
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';
import * as jwt from "jsonwebtoken";
import EventEmitter from "events";

import { typeDefs } from "../graphql/schema";
import { createResolvers } from "../graphql/resolvers";
import {
	Message,
	sendMessage,
	sendMessagetoSupervisor,
} from "../utils/handleMessage";

type RequestType = {
	request: any;
	response: any;
};

export class GraphQLWorker implements Worker {
	private instanceId: string;
	public isBusy: boolean = false;
	private eventEmitter: EventEmitter = new EventEmitter();
	private requests: Map<String, RequestType> = new Map();
	private server: ApolloServer;

	constructor() {
		this.instanceId = `GraphQLWorker-${uuidv4()}`;
		this.run().catch((error) => {
			console.log(error);
			log(
				`[GraphQLWorker] Error in run method: ${error.message}`,
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
				`[GraphQLWorker] Starting worker with ID: ${this.instanceId}`,
				"info"
			);
			this.healthCheck();
			await this.listenTask();
			await this.startGraphQLServer();
			log(`[GraphQLWorker] Worker is ready to receive tasks`, "info");
		} catch (error) {
			log(
				`[GraphQLWorker] Failed to run worker: ${error.message}`,
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
					`[GraphQLWorker] Received message: ${messageId}`,
					"info"
				);
				const destinationFiltered = destination.filter((d) =>
					d.includes("GraphQLWorker")
				);
				destinationFiltered.forEach((dest) => {
					log(
						`[GraphQLWorker] Processing message for destination: ${dest}`,
						"info"
					);
					const destinationSplited = dest.split("/");
					const path = destinationSplited[1];
					this[path](message);
				});
			});
		} catch (error) {
			log(
				`[GraphQLWorker] Error listening to task: ${error.message}`,
				"error"
			);
			throw error;
		}
	}

	async onProcessedMessage(message: Message) {
		const { messageId, data } = message;
		log(
			`[GraphQLWorker] Processing completed message with ID: ${messageId}`,
			"info"
		);
		this.eventEmitter.emit("message", {
			messageId,
			data,
			status: "completed",
		});
		log(
			`[GraphQLWorker] Processed message with ID: ${messageId}`,
			"info"
		);
	}

	async getuserId(authorization: string): Promise<string> {
		return new Promise((resolve, reject) => {
			if (!authorization) {
				log(`[GraphQLWorker] Unauthorized access attempt`, "warn");
				reject(new Error("Unauthorized"));
			}
			const token = authorization.split(" ")[1];
			jwt.verify(
				token,
				process.env.jwt_secret as string,
				(err, decoded) => {
					if (err) {
						log(`[GraphQLWorker] Invalid token`, "warn");
						console.error(
							`[GraphQLWorker] Token verification failed: ${err.message}`
						);
						reject(err);
					}
					console.log(decoded);
					if (typeof decoded !== "string" && "_id" in decoded) {
						resolve(decoded._id);
					}
					log(`[GraphQLWorker] Invalid token payload`, "warn");
					reject(new Error("Invalid token payload"));
					log(
						`[GraphQLWorker] Token verified successfully`,
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
						`[GraphQLWorker] Received message for ID: ${messageId}`,
						"info"
					);
					resolve(message.data == null ? {} : message.data);
					log(
						`[GraphQLWorker] Response sent for ID: ${messageId}`,
						"info"
					);
				}
			});
		});
	}

	async startGraphQLServer(): Promise<void> {
		// Create GraphQL Federation subgraph schema
		const schema = buildSubgraphSchema({
			typeDefs: gql(typeDefs),
			resolvers: createResolvers(this),
		});

		// Apollo Server for Federation
		this.server = new ApolloServer({
			schema,
			
		});

		const { url } = await startStandaloneServer(this.server, {
			listen: { host:"0.0.0.0",port: Number(process.env.graphql_port) || 4001 },
			context: async ({ req }) => {
				return {
					authorization: req.headers.authorization,
				};
			},
		});

		log(`[GraphQLWorker] GraphQL Federation subgraph running at ${url}`, "info");
	}
}

new GraphQLWorker();