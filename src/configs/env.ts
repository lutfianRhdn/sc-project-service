import { config } from "dotenv";
import { parseEnv, z } from "znv";

config();

export const {
	PORT,
	JWT_SECRET,
	DATABASE_URL,
	DATABASE_NAME,
	DATABASE_COLLECTION_NAME,
	RABBITMQ_URL,
	RABBITMQ_CONSUME_QUEUE_NAME,
	RABBITMQ_COMPENSATION_QUEUE_NAME,
	RABBITMQ_PRODUCER_NAME,
	REIDS_PORT,
	REDIS_URL,
	REDIS_USERNAME,
	REDIS_PASSWORD,
} = parseEnv(process.env, {
	PORT: z.coerce.number().default(4000),
	JWT_SECRET: z.string().min(1).default("supersecretkey"),

	DATABASE_URL: z.string().min(1),
	DATABASE_NAME: z.string().min(1),
	DATABASE_COLLECTION_NAME: z.string().min(1).default("projects"),

	RABBITMQ_URL: z.string().min(1),
	RABBITMQ_CONSUME_QUEUE_NAME: z
		.string()
		.min(1)
		.default("projectStatusQueue"),
	RABBITMQ_COMPENSATION_QUEUE_NAME: z
		.string()
		.min(1)
		.default("projectCompensationQueue"),
	RABBITMQ_PRODUCER_NAME: z.string().min(1).default("projectQueue"),

	REIDS_PORT: z.coerce
		.number()
		.default(6379),
	REDIS_URL: z.string().min(1).default("localhost"),
	REDIS_USERNAME: z.string().min(1).default("default"),
	REDIS_PASSWORD: z.string().min(1).default("default"),
});
