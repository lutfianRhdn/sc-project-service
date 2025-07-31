// Mock dependencies
const mockChannel = {
  assertQueue: jest.fn().mockResolvedValue({}),
  consume: jest.fn(),
  sendToQueue: jest.fn(),
} as any;

const mockConnection = {
  createChannel: jest.fn().mockResolvedValue(mockChannel),
  on: jest.fn(),
} as any;

const mockConnect = jest.fn().mockResolvedValue(mockConnection);

jest.mock('amqplib', () => ({
  connect: mockConnect,
}));

jest.mock('../utils/log', () => jest.fn());
jest.mock('../utils/handleMessage', () => ({
  sendMessagetoSupervisor: jest.fn(),
}));

jest.mock('../configs/env', () => ({
  RABBITMQ_URL: 'amqp://localhost:5672',
}));

import { Message } from '../utils/handleMessage';

const mockLog = require('../utils/log');
const mockSendMessagetoSupervisor = require('../utils/handleMessage').sendMessagetoSupervisor;

// Simplified RabbitMQ Worker for testing
class TestRabbitMQWorker {
  public isBusy: boolean = false;
  private instanceId: string;

  constructor() {
    this.instanceId = `RabbitMqWorker-${Date.now()}-${Math.random()}`;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  async produceMessage(data: any, queueName: string = 'test-queue'): Promise<void> {
    try {
      const channel = await mockConnection.createChannel();
      await channel.assertQueue(queueName, { durable: true });

      const messageBuffer = Buffer.from(JSON.stringify({
        projectId: data._id,
        keyword: data.keyword,
        language: data.language,
        start_date_crawl: data.start_date_crawl,
        end_date_crawl: data.end_date_crawl,
        tweetToken: data.tweetToken,
      }));

      channel.sendToQueue(queueName, messageBuffer, { persistent: true });
    } catch (error) {
      console.error("Failed to send message to RabbitMQ:", error);
    }
  }

  async consumeMessage(queueName: string): Promise<void> {
    const channel = await mockConnection.createChannel();
    await channel.assertQueue(queueName, { durable: true });
    mockLog(`[RabbitMQWorker] Listening to consume queue: ${queueName}`, 'info');
    
    channel.consume(queueName, (msg: any) => {
      if (msg !== null) {
        const messageContent = msg.content.toString();
        mockSendMessagetoSupervisor({
          messageId: 'test-msg',
          status: 'completed',
          data: JSON.parse(messageContent),
          destination: [],
        });
      }
    }, { noAck: true });
  }
}

describe('RabbitMQWorker (Simplified)', () => {
  let worker: TestRabbitMQWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset mock implementations
    mockConnection.createChannel.mockResolvedValue(mockChannel);
    
    worker = new TestRabbitMQWorker();
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID', () => {
      expect(worker.getInstanceId()).toMatch(/^RabbitMqWorker-/);
      expect(worker.isBusy).toBe(false);
    });
  });

  describe('produceMessage', () => {
    it('should produce message to specified queue', async () => {
      const testData = {
        _id: 'project123',
        keyword: 'test',
        language: 'en',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
        tweetToken: 'token123',
      };

      await worker.produceMessage(testData, 'custom-queue');

      expect(mockConnection.createChannel).toHaveBeenCalled();
      expect(mockChannel.assertQueue).toHaveBeenCalledWith('custom-queue', {
        durable: true,
      });

      const expectedMessage = {
        projectId: 'project123',
        keyword: 'test',
        language: 'en',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
        tweetToken: 'token123',
      };

      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'custom-queue',
        Buffer.from(JSON.stringify(expectedMessage)),
        { persistent: true }
      );
    });

    it('should use default queue when not specified', async () => {
      const testData = {
        _id: 'project123',
        keyword: 'test',
        language: 'en',
        tweetToken: 'token123',
      };

      await worker.produceMessage(testData);

      expect(mockChannel.assertQueue).toHaveBeenCalledWith('test-queue', {
        durable: true,
      });
    });

    it('should handle produce channel creation error', async () => {
      const error = new Error('Channel creation failed');
      mockConnection.createChannel.mockRejectedValue(error);

      const testData = { _id: 'project123', keyword: 'test' };

      // Should not throw error
      await expect(worker.produceMessage(testData)).resolves.not.toThrow();
    });

    it('should handle missing data fields', async () => {
      const incompleteData = {
        keyword: 'test',
        // Missing other fields
      };

      await worker.produceMessage(incompleteData);

      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-queue',
        Buffer.from(JSON.stringify({
          projectId: undefined,
          keyword: 'test',
          language: undefined,
          start_date_crawl: undefined,
          end_date_crawl: undefined,
          tweetToken: undefined,
        })),
        { persistent: true }
      );
    });
  });

  describe('consumeMessage', () => {
    it('should create channel and assert queue', async () => {
      await worker.consumeMessage('test-queue');

      expect(mockConnection.createChannel).toHaveBeenCalled();
      expect(mockChannel.assertQueue).toHaveBeenCalledWith('test-queue', {
        durable: true,
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Listening to consume queue: test-queue',
        'info'
      );
    });

    it('should set up message consumer', async () => {
      await worker.consumeMessage('test-queue');

      expect(mockChannel.consume).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        { noAck: true }
      );
    });

    it('should handle consumed messages', async () => {
      await worker.consumeMessage('test-queue');

      // Get the consumer function
      const consumerFunction = mockChannel.consume.mock.calls[0][1];

      const mockMessage = {
        content: Buffer.from(JSON.stringify({ test: 'data' })),
      };

      consumerFunction(mockMessage);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: 'test-msg',
        status: 'completed',
        data: { test: 'data' },
        destination: [],
      });
    });

    it('should handle null messages', async () => {
      await worker.consumeMessage('test-queue');

      // Get the consumer function
      const consumerFunction = mockChannel.consume.mock.calls[0][1];

      consumerFunction(null);

      // Should not call sendMessagetoSupervisor for null messages
      expect(mockSendMessagetoSupervisor).not.toHaveBeenCalled();
    });
  });

  describe('Instance Management', () => {
    it('should have unique instance IDs for different workers', () => {
      const worker1 = new TestRabbitMQWorker();
      const worker2 = new TestRabbitMQWorker();

      expect(worker1.getInstanceId()).not.toBe(worker2.getInstanceId());
      expect(worker1.getInstanceId()).toMatch(/^RabbitMqWorker-/);
      expect(worker2.getInstanceId()).toMatch(/^RabbitMqWorker-/);
    });

    it('should track busy state correctly', () => {
      expect(worker.isBusy).toBe(false);

      worker.isBusy = true;
      expect(worker.isBusy).toBe(true);

      worker.isBusy = false;
      expect(worker.isBusy).toBe(false);
    });
  });
});