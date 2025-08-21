import * as mongoDB from "mongodb";
import log from "../utils/log";
import { Message, sendMessagetoSupervisor } from "../utils/handleMessage";
import { Worker } from "./Worker";
import { v4 as uuidv4 } from "uuid";
export default class DatabaseInteractionWorker implements Worker {
	private instanceId: string;
	public isBusy: boolean = false;
	private client: mongoDB.MongoClient = new mongoDB.MongoClient(
		process.env.db_url || "mongodb://localhost:27017"
	);
	private db: mongoDB.Db = this.client.db(process.env.db_name || "project");
	private collection: mongoDB.Collection = this.db.collection(
		process.env.collection_name || "data"
	);

	constructor() {
		this.instanceId = `DatabaseInteractionWorker-${Date.now()}`;

		this.run().catch((error) => {
			console.error(
				`[DatabaseInteractionWorker] Error in constructor: ${error.message}`
			);
		});
	}
	public async run(): Promise<void> {
		try {
			this.client
				.connect()
				.then(() =>
					log(
						`[DatabaseInteractionWorker] Connected to MongoDB ${process.env.db_name}`,
						"success"
					)
				)
				.catch((error) =>
					log(
						`[DatabaseInteractionWorker] Error connecting to MongoDB: ${error.message}`,
						"error"
					)
				);
			this.listenTask().catch((error) => {
				log(
					`[DatabaseInteractionWorker] Error in run method: ${error.message}`,
					"error"
				);
			});
		} catch (error) {
			console.error(
				`[DatabaseInteractionWorker] Error in run method: ${error.message}`
			);
		}
	}
	async listenTask(): Promise<void> {
		// Simulate listening for tasks
		process.on("message", async (message: Message) => {
			console.log("busy ", this.isBusy);
			if (this.isBusy) {
				log(
					`[DatabaseInteractionWorker] Worker is busy, cannot process new task`,
					"warn"
				);
				sendMessagetoSupervisor({
					...message,
					status: "failed",
					reason: "SERVER_BUSY",
				});
				return;
			}
			this.isBusy = true;
			const { destination, data } = message;
			const dest = destination.filter((d) =>
				d.includes("DatabaseInteractionWorker")
			);
			dest.forEach(async (d) => {
				log(
					`[DatabaseInteractionWorker] Received message for destination: ${d}`,
					"info"
				);
				const destinationSplited = d.split("/");
				const path = destinationSplited[1];
				const subPath = destinationSplited[2];
				const result = await this[path]({ id: subPath, data });
				const { data: res, destination } = result;
				if (result) {
					sendMessagetoSupervisor({
						messageId: message.messageId,
						status: "completed",
						data: res,
						destination: destination,
					});
				}
			});

			this.isBusy = false;
		});
	}
	public async updateStatus({ id, data }): Promise<any> {
		try {
			const result = await this.collection.findOneAndUpdate(
				{ _id: new mongoDB.ObjectId(id) },
				[{$set: {
					project_status: {
						$mergeObjects: [{
							$ifNull: ["$project_status",{},],
						},
						data,
					]}},
				}],
				{
					returnDocument: "after", // Return updated document
					upsert: false,
				}
			);
			if (result.modifiedCount === 0) {
				log(
					`[DatabaseInteractionWorker] No document found with ID: ${id}`,
					"warn"
				);
				return {
					data: null,
					destination: [`GraphQLWorker/onProcessedMessage`],
				};
			}
			log(
				`[DatabaseInteractionWorker] Successfully updated document with ID: ${id}`,
				"success"
			);
			const updatedData = await this.collection.findOne({
				_id: new mongoDB.ObjectId(id),
			});
			return {
				data: updatedData,
				destination: [`GraphQLWorker/onProcessedMessage`],
			};
		} catch (error) {
			log(
				`[DatabaseInteractionWorker] Error updating status for ID ${id}: ${error.message}`,
				"error"
			);
			return {
				data: null,
				destination: [`GraphQLWorker/onProcessedMessage`],
			};
		}
	}
	public async getAllData({ id }): Promise<any> {
		try {
			const data = await this.collection
				.find({ userId: id })
				.toArray();
			log(
				`[DatabaseInteractionWorker] Successfully retrieved ${data.length} documents`,
				"success"
			);
			return {
				data,
				destination: [`GraphQLWorker/onProcessedMessage`],
			};
		} catch (error) {
			log(
				`[DatabaseInteractionWorker] Error retrieving data: ${error.message}`,
				"error"
			);
			return [];
		}
	}

	public async getAllDataPaginated({ data }): Promise<any> {
		try {
			const { userId, page = 1, limit = 10, name } = data;
			const skip = (page - 1) * limit;

			// Build query
			let query: any = { userId };
			if (name) {
				query.title = { $regex: name, $options: 'i' };
			}

			// Get total count
			const total = await this.collection.countDocuments(query);

			// Get paginated data
			const projects = await this.collection
				.find(query)
				.skip(skip)
				.limit(limit)
				.sort({ createdAt: -1 })
				.toArray();

			log(
				`[DatabaseInteractionWorker] Successfully retrieved ${projects.length} of ${total} documents for page ${page}`,
				"success"
			);

			return {
				data: {
					projects,
					total,
					page,
					limit,
				},
				destination: [`GraphQLWorker/onProcessedMessage`],
			};
		} catch (error) {
			log(
				`[DatabaseInteractionWorker] Error retrieving paginated data: ${error.message}`,
				"error"
			);
			return {
				data: {
					projects: [],
					total: 0,
					page: 1,
					limit: 10,
				},
				destination: [`GraphQLWorker/onProcessedMessage`],
			};
		}
	}
	public async getDataById({ id }): Promise<any> {
		try {
			const data = await this.collection.findOne({
				_id: new mongoDB.ObjectId(id),
			});
			if (!data) {
				log(
					`[DatabaseInteractionWorker] No data found for ID: ${id}`,
					"warn"
				);
				return {
					data: null,
					destination: [`GraphQLWorker/onProcessedMessage`],
				};
			}
			log(
				`[DatabaseInteractionWorker] Successfully retrieved document with ID: ${id}`,
				"success"
			);
			return {
				data,
				destination: [`GraphQLWorker/onProcessedMessage`, `GraphQLWorker/onProcessedMessage`],
			};
		} catch (error) {
			log(
				`[DatabaseInteractionWorker] Error retrieving data by ID: ${error.message}`,
				"error"
			);
			return {
				data: null,
				destination: [`GraphQLWorker/onProcessedMessage`],
			};
		}
	}
	public removeProject({ data }): Promise<any> {
		const projectId = data.project_id;
		return new Promise(async (resolve, reject) => {
			try {
				const result = await this.collection.deleteOne({
					_id: new mongoDB.ObjectId(projectId),
				});
				if (result.deletedCount === 0) {
					log(`[DatabaseInteractionWorker] No project found with ID: ${projectId}`,"warn");
					resolve({
						data: null,
						destination: [`GraphQLWorker/onProcessedMessage`],
					});
				} else {
					log(`[DatabaseInteractionWorker] Successfully deleted project with ID: ${projectId}`,"success");
					resolve({
						data: { id: projectId },
						destination: [`GraphQLWorker/onProcessedMessage`],
					});
				}
			} catch (error) {
				log(
					`[DatabaseInteractionWorker] Error deleting project: ${error.message}`,
					"error"
				);
				reject(error);
			}
		});
					
	}
	public getDataByKeywordAndRange({ data: req }: any): Promise<any> {
		return new Promise(async (resolve, reject) => {
			try {
				const { keyword, start_date_crawl, end_date_crawl } = req;
				const query: any = {
					keyword: keyword,
					start_date_crawl: new Date(start_date_crawl),
					end_date_crawl: new Date(end_date_crawl),
				};
				const data = await this.collection
					.find(query, { sort: { createdAt: 1 } })
					.toArray()[0];
				log(
					`[DatabaseInteractionWorker] Successfully retrieved ${data.length} documents for keyword: ${keyword}`,
					"success"
				);
				resolve({
					data,
					destination: [`GraphQLWorker/onProcessedMessage`],
				});
			} catch (error) {
				log(
					`[DatabaseInteractionWorker] Error retrieving data by keyword and range: ${error.message}`,
					"error"
				);
				reject(error);
			}
		});
	}
	public async createNewData({ data }: any): Promise<any> {
		try {
			if (!data || data.length === 0) {
				log(
					"[DatabaseInteractionWorker] No data provided to insert",
					"warn"
				);
				return;
			}
			const tweetToken = data.tweetToken;
			delete data.tweetToken;

			const insertedData = await this.collection.insertOne({
				...data,
				start_date_crawl: new Date(data.start_date_crawl),
				end_date_crawl: new Date(data.end_date_crawl),
				project_status: {
					topic_modelling: false,
					sentiment: false,
					emotion: false,
					sna: false,
					chatbot:false
				},
				createdAt: new Date(),
			});
			const project = await this.collection.findOne({
				_id: insertedData.insertedId,
			});
			project.tweetToken = tweetToken;
			return {
				data: {
					...project,
					start_date_crawl: new Date(
						data.start_date_crawl
					).toISOString().split("T")[0],
					end_date_crawl: new Date(
						data.end_date_crawl
					).toISOString().split("T")[0],
				},
				destination: [
					`GraphQLWorker/onProcessedMessage/`,
					`RabbitMQWorker/produceMessage`,
				],
			};
		} catch (error) {
			log(
				`[DatabaseInteractionWorker] Error creating new data: ${error.message}`,
				"error"
			);
		}
	}
}

new DatabaseInteractionWorker()