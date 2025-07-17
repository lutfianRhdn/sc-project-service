import { createClient } from 'redis';
export default class Idempotent {
  private redisInstance: ReturnType<typeof createClient>;
  private prefixKey: string = "IDEMPONTENT_";
  constructor() {
    this.redisInstance = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    this.redisInstance.connect().catch((error) => {
      console.error(`[Idempotent] Error connecting to Redis: ${error.message}`);
    });
  }
  async checkIdempotent(key: string): Promise<boolean> {
    return await this.redisInstance.get(`${this.prefixKey}${key}`)
      .then((result) => {
        if (result === null) {
          return false; // Key does not exist, operation is not idempotent
        }
        return true; // Key exists, operation is idempotent
      })
  }
  async setIdempotent(key: string, value: string): Promise<void> {
    await this.redisInstance.set(`${this.prefixKey}${key}`, value, {
      EX: 3600 // Set expiration time to 1 hour
    });
  }
  async removeIdempotent(key: string): Promise<void> {
    await this.redisInstance.del(`${this.prefixKey}${key}`);
  }
    
}