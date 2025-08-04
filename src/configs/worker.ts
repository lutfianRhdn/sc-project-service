
import * as env from "./env";
export const DatabaseInteractionWorker = {
	count: 1,
	config: {
		db_url: env.DATABASE_URL || "mongodb://localhost:27017",
		db_name: env.DATABASE_NAME || "project",
		collection_name: env.DATABASE_COLLECTION_NAME || "projects",
	},
};
export const RestApiWorker= {
		count: 1,
		config: {
			port: env.PORT as number ||4000,
			jwt_secret: env.JWT_SECRET || 'secret'
		},
	}
export const RabbitMQWorker= {
		count: 1,
		config: {
      consumeQueue: env.RABBITMQ_CONSUME_QUEUE_NAME || "projectStatusQueue",
      consumeCompensationQueue: env.RABBITMQ_COMPENSATION_QUEUE_NAME || "projectCompensationQueueue",
      produceQueue: env.RABBITMQ_PRODUCER_NAME || "projectQueue",
      rabbitMqUrl:env.RABBITMQ_URL || "amqp://localhost:5672",
		},
}
	

export const allConfigs = {
	DatabaseInteractionWorker,
	RestApiWorker,
	RabbitMQWorker,
};
