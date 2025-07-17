
import * as env from "./env";
export const workerConfig = {
	DatabaseInteractionWorker: {
		count: 1,
		cpu: "200mc",
		memory: 1028, // in MB
		config: {
			db_url: env.DATABASE_URL || "mongodb://localhost:27017",
			db_name: env.DATABASE_NAME || "project",
			collection_name: env.DATABASE_COLLECTION_NAME || "projects",
		},
	},
	RestApiWorker: {
		count: 1,
		cpu: 1,
		memory: 1028, // in MB
		config: {
			port: env.PORT ||4000,
			jwt_secret: env.JWT_SECRET || 'secret'
		},
	},
	RabbitMQWorker: {
		count: 1,
		cpu: 1,
		memory: 1028, // in MB
		config: {
      consumeQueue: env.RABBITMQ_CONSUME_QUEUE_NAME || "projectStatusQueue",
      consumeCompensationQueue: env.RABBITMQ_COMPENSATION_QUEUE_NAME || "projectCompensationQueueue",
      produceQueue: env.RABBITMQ_PRODUCER_NAME || "projectQueue",
      rabbitMqUrl:env.RABBITMQ_URL || "amqp://localhost:5672",
		},
	},
};