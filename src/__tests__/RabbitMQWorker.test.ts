import { RabbitMQWorker } from '../workers/RabbitMQWorker';
import * as amqp from 'amqplib';
import { Message } from '../utils/handleMessage';

// Mock dependencies
jest.mock('amqplib');
jest.mock('../utils/log');
jest.mock('../utils/handleMessage');
jest.mock('../configs/env', () => ({
  RABBITMQ_URL: 'amqp://localhost:5672',
}));

const mockLog = require('../utils/log').default;
const mockSendMessagetoSupervisor = require('../utils/handleMessage').sendMessagetoSupervisor;

describe('RabbitMQWorker', () => {
  let worker: RabbitMQWorker;
  let mockConnection: jest.Mocked<amqp.Connection>;
  let mockChannel: jest.Mocked<amqp.Channel>;
  let mockConnect: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Clear any existing timers
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock environment variables
    process.env.rabbitMqUrl = 'amqp://test:5672';
    process.env.consumeQueue = 'test-consume-queue';
    process.env.consumeCompensationQueue = 'test-compensation-queue';
    process.env.produceQueue = 'test-produce-queue';

    // Mock RabbitMQ channel
    mockChannel = {
      assertQueue: jest.fn().mockResolvedValue({}),
      consume: jest.fn(),
      sendToQueue: jest.fn(),
    } as any;

    // Mock RabbitMQ connection
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      on: jest.fn(),
    } as any;

    // Mock amqp.connect
    mockConnect = jest.fn().mockResolvedValue(mockConnection);
    jest.mocked(amqp.connect).mockImplementation(mockConnect);

    // Mock process.send
    process.send = jest.fn();

    // Mock log function
    mockLog.mockImplementation(() => {});
    mockSendMessagetoSupervisor.mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    // Clean up any running worker instance
    if (worker) {
      jest.clearAllTimers();
    }
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID and connection string', () => {
      worker = new RabbitMQWorker();

      expect(worker.getInstanceId()).toMatch(/^RabbitMqWorker-/);
      expect(worker.isBusy).toBe(false);
    });

    it('should use default RABBITMQ_URL when env variable is not set', () => {
      delete process.env.rabbitMqUrl;
      worker = new RabbitMQWorker();

      expect(worker.getInstanceId()).toMatch(/^RabbitMqWorker-/);
    });
  });

  describe('run', () => {
    beforeEach(() => {
      worker = new RabbitMQWorker();
    });

    it('should connect to RabbitMQ successfully', async () => {
      mockConnect.mockResolvedValue(mockConnection);

      await worker.run();

      expect(mockConnect).toHaveBeenCalledWith('amqp://test:5672', {
        heartbeat: 60,
        timeout: 10000,
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Connected to RabbitMQ at amqp://test:5672',
        'success'
      );
    });

    it('should throw error when connection string is not provided', async () => {
      // Create worker with no connection string
      process.env.rabbitMqUrl = '';
      const workerWithoutUrl = new RabbitMQWorker();

      await expect(workerWithoutUrl.run()).rejects.toThrow('Connection string is not provided');
    });

    it('should handle connection error', async () => {
      const error = new Error('Connection failed');
      mockConnect.mockRejectedValue(error);

      await expect(worker.run()).rejects.toThrow('Connection failed');
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Failed to run worker: Connection failed',
        'error'
      );
    });

    it('should set up connection event listeners', async () => {
      await worker.run();

      expect(mockConnection.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('blocked', expect.any(Function));
    });

    it('should handle connection error event', async () => {
      await worker.run();

      // Get the error handler
      const errorHandler = (mockConnection.on as jest.Mock).mock.calls.find(
        call => call[0] === 'error'
      )[1];

      const error = new Error('Connection error');
      errorHandler(error);

      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Connection error: Connection error',
        'error'
      );
    });

    it('should handle connection close event', async () => {
      await worker.run();

      // Get the close handler
      const closeHandler = (mockConnection.on as jest.Mock).mock.calls.find(
        call => call[0] === 'close'
      )[1];

      const reason = { message: 'Connection closed by server' };
      closeHandler(reason);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'error',
        reason: 'Connection closed by server',
        data: [],
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Connection closed Connection closed by server',
        'error'
      );
    });

    it('should handle connection blocked event', async () => {
      await worker.run();

      // Get the blocked handler
      const blockedHandler = (mockConnection.on as jest.Mock).mock.calls.find(
        call => call[0] === 'blocked'
      )[1];

      const reason = 'Memory limit reached';
      blockedHandler(reason);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'error',
        data: [],
        destination: [],
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Connection blocked: Memory limit reached',
        'error'
      );
    });

    it('should start health check', async () => {
      await worker.run();

      // Fast-forward time to trigger health check
      jest.advanceTimersByTime(10000);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'healthy',
        data: {
          instanceId: worker.getInstanceId(),
          timestamp: expect.any(String),
        },
      });
    });

    it('should start consuming messages', async () => {
      await worker.run();

      expect(mockChannel.assertQueue).toHaveBeenCalledWith('test-consume-queue', {
        durable: true,
      });
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'test-consume-queue',
        expect.any(Function),
        { noAck: true }
      );
    });

    it('should log successful startup', async () => {
      await worker.run();

      expect(mockLog).toHaveBeenCalledWith(
        `[RabbitMQWorker] instanceId: ${worker.getInstanceId()} is running`,
        'success'
      );
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      worker = new RabbitMQWorker();
    });

    it('should send health status every 10 seconds', () => {
      worker.healthCheck();

      // Fast-forward time and check multiple intervals
      jest.advanceTimersByTime(10000);
      expect(mockSendMessagetoSupervisor).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(10000);
      expect(mockSendMessagetoSupervisor).toHaveBeenCalledTimes(2);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'healthy',
        data: {
          instanceId: worker.getInstanceId(),
          timestamp: expect.any(String),
        },
      });
    });
  });

  describe('consumeMessage', () => {
    beforeEach(async () => {
      worker = new RabbitMQWorker();
      await worker.run();
    });

    it('should throw error when connection is not established', async () => {
      const workerWithoutConnection = new RabbitMQWorker();
      // Don't call run() to avoid establishing connection

      await expect(workerWithoutConnection.consumeMessage('test-queue')).rejects.toThrow(
        'Connection is not established'
      );
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Connection is not established',
        'error'
      );
    });

    it('should create channel and assert queue', async () => {
      await worker.consumeMessage('test-queue');

      expect((mockConnection as any).createChannel).toHaveBeenCalled();
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

    it('should handle consumed messages from main queue', async () => {
      await worker.consumeMessage('test-consume-queue');

      // Get the consumer function
      const consumerFunction = (mockChannel.consume as jest.Mock).mock.calls[0][1];

      const mockMessage = {
        content: Buffer.from(JSON.stringify({ test: 'data' })),
      };

      consumerFunction(mockMessage);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'completed',
        data: { test: 'data' },
        destination: [],
      });
    });

    it('should handle null messages', async () => {
      await worker.consumeMessage('test-queue');

      // Get the consumer function
      const consumerFunction = (mockChannel.consume as jest.Mock).mock.calls[0][1];

      consumerFunction(null);

      // Should not call sendMessagetoSupervisor for null messages
      expect(mockSendMessagetoSupervisor).not.toHaveBeenCalled();
    });
  });

  describe('produceMessage', () => {
    beforeEach(async () => {
      worker = new RabbitMQWorker();
      await worker.run();
    });

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

      expect((mockConnection as any).createChannel).toHaveBeenCalled();
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

    it('should use default produce queue when not specified', async () => {
      const testData = {
        _id: 'project123',
        keyword: 'test',
        language: 'en',
        tweetToken: 'token123',
      };

      await worker.produceMessage(testData);

      expect(mockChannel.assertQueue).toHaveBeenCalledWith('test-produce-queue', {
        durable: true,
      });
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-produce-queue',
        expect.any(Buffer),
        { persistent: true }
      );
    });

    it('should handle produce channel creation error', async () => {
      const error = new Error('Channel creation failed');
      (mockConnection as any).createChannel.mockRejectedValue(error);

      const testData = { _id: 'project123', keyword: 'test' };

      // Should not throw, but should log error internally
      await worker.produceMessage(testData);

      // The method catches errors internally, so we can't assert on thrown errors
      // But we can verify that createChannel was called
      expect((mockConnection as any).createChannel).toHaveBeenCalled();
    });

    it('should handle sendToQueue error', async () => {
      const error = new Error('Send failed');
      mockChannel.sendToQueue.mockImplementation(() => {
        throw error;
      });

      const testData = { _id: 'project123', keyword: 'test' };

      // Should not throw, method handles errors internally
      await worker.produceMessage(testData);

      expect(mockChannel.sendToQueue).toHaveBeenCalled();
    });
  });

  describe('listenTask', () => {
    beforeEach(async () => {
      worker = new RabbitMQWorker();
      jest.spyOn(worker, 'produceMessage').mockResolvedValue();
    });

    it('should process incoming messages', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: ['RabbitMQWorker/produceMessage'],
        data: { test: 'data' },
      };

      await worker.listenTask();

      // Simulate receiving a message
      (process.emit as any)('message', message);

      expect(worker.produceMessage).toHaveBeenCalledWith(
        { test: 'data' },
        'test-produce-queue'
      );
    });

    it('should filter and process only RabbitMQWorker destinations', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'DatabaseInteractionWorker/getAllData',
          'RabbitMQWorker/produceMessage',
          'RestApiWorker/onProcessedMessage',
        ],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      // Should only call produceMessage once for RabbitMQWorker destination
      expect(worker.produceMessage).toHaveBeenCalledTimes(1);
      expect(worker.produceMessage).toHaveBeenCalledWith(
        { test: 'data' },
        'test-produce-queue'
      );
    });

    it('should handle multiple RabbitMQWorker destinations', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'RabbitMQWorker/produceMessage',
          'RabbitMQWorker/produceMessage',
        ],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      expect(worker.produceMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle messages with no RabbitMQWorker destinations', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'DatabaseInteractionWorker/getAllData',
          'RestApiWorker/onProcessedMessage',
        ],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      expect(worker.produceMessage).not.toHaveBeenCalled();
    });

    it('should log successful message processing', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: ['RabbitMQWorker/produceMessage'],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      // Wait for async operation to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Received message: test-msg-1',
        'info'
      );
      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Message test-msg-1 sent to consume queue',
        'info'
      );
    });

    it('should handle produceMessage errors', async () => {
      const error = new Error('Produce failed');
      (worker.produceMessage as jest.Mock).mockRejectedValue(error);

      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: ['RabbitMQWorker/produceMessage'],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      // Wait for async operation to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Error sending message test-msg-1 to consume queue: Produce failed',
        'error'
      );
    });
  });

  describe('Instance Management', () => {
    it('should have unique instance IDs for different workers', () => {
      const worker1 = new RabbitMQWorker();
      const worker2 = new RabbitMQWorker();

      expect(worker1.getInstanceId()).not.toBe(worker2.getInstanceId());
      expect(worker1.getInstanceId()).toMatch(/^RabbitMqWorker-/);
      expect(worker2.getInstanceId()).toMatch(/^RabbitMqWorker-/);
    });

    it('should track busy state correctly', () => {
      worker = new RabbitMQWorker();

      expect(worker.isBusy).toBe(false);

      worker.isBusy = true;
      expect(worker.isBusy).toBe(true);

      worker.isBusy = false;
      expect(worker.isBusy).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed JSON in consumed messages', async () => {
      worker = new RabbitMQWorker();
      await worker.run();
      await worker.consumeMessage('test-queue');

      // Get the consumer function
      const consumerFunction = (mockChannel.consume as jest.Mock).mock.calls[0][1];

      const mockMessage = {
        content: Buffer.from('invalid json'),
      };

      // Should not throw error
      expect(() => consumerFunction(mockMessage)).not.toThrow();
    });

    it('should handle missing data fields in produceMessage', async () => {
      worker = new RabbitMQWorker();
      await worker.run();

      const incompleteData = {
        keyword: 'test',
        // Missing other fields
      };

      // Should not throw error
      await expect(worker.produceMessage(incompleteData)).resolves.not.toThrow();

      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-produce-queue',
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
});