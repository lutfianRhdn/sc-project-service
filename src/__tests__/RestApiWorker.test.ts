import { RestApiWorker } from '../workers/RestApiWorker';
import { Message } from '../utils/handleMessage';
import * as jwt from 'jsonwebtoken';
import EventEmitter from 'events';

// Mock dependencies
jest.mock('jsonwebtoken');
jest.mock('../utils/log');
jest.mock('../utils/handleMessage');
jest.mock('../utils/Imdempotent');
jest.mock('@decorators/express', () => ({
  Controller: () => (target: any) => target,
  Get: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
  Post: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
  Request: () => (target: any, propertyKey: string, parameterIndex: number) => {},
  Response: () => (target: any, propertyKey: string, parameterIndex: number) => {},
  Params: () => (target: any, propertyKey: string, parameterIndex: number) => {},
  attachControllers: jest.fn(),
}));
jest.mock('express', () => {
  const mockExpress: any = jest.fn().mockReturnValue({
    use: jest.fn(),
    listen: jest.fn(),
  });
  mockExpress.json = jest.fn();
  return mockExpress;
});

const mockLog = require('../utils/log').default;
const mockSendMessagetoSupervisor = require('../utils/handleMessage').sendMessagetoSupervisor;
const mockIdempotent = require('../utils/Imdempotent').default;

describe('RestApiWorker', () => {
  let worker: RestApiWorker;
  let mockReq: any;
  let mockRes: any;
  let mockJwtVerify: jest.MockedFunction<typeof jwt.verify>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Clear any existing timers
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock environment variables
    process.env.jwt_secret = 'test-secret';
    process.env.port = '4000';

    // Mock Express request and response
    mockReq = {
      headers: {
        authorization: 'Bearer valid-token',
        'idempotent-key': 'test-key-123',
      },
      body: {
        title: 'Test Project',
        description: 'Test Description',
        category: 'test',
        keyword: 'test-keyword',
        language: 'en',
        tweetToken: 'token123',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
      },
    };

    mockRes = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    // Mock JWT verify
    mockJwtVerify = jwt.verify as jest.MockedFunction<typeof jwt.verify>;

    // Mock process.send
    process.send = jest.fn();

    // Mock log function
    mockLog.mockImplementation(() => {});
    mockSendMessagetoSupervisor.mockImplementation(() => {});

    // Mock Idempotent
    mockIdempotent.mockImplementation(() => ({
      checkIdempotent: jest.fn().mockResolvedValue(false),
      setIdempotent: jest.fn().mockResolvedValue(undefined),
      removeIdempotent: jest.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    // Clean up any running worker instance
    if (worker) {
      jest.clearAllTimers();
    }
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID', () => {
      worker = new RestApiWorker();

      expect(worker.getInstanceId()).toMatch(/^RestApiWorker-/);
      expect(worker.isBusy).toBe(false);
    });

    it('should have event emitter for internal communication', () => {
      worker = new RestApiWorker();

      expect(worker['eventEmitter']).toBeInstanceOf(EventEmitter);
      expect(worker['requests']).toBeInstanceOf(Map);
    });
  });

  describe('run', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
    });

    it('should start worker successfully', async () => {
      await worker.run();

      expect(mockLog).toHaveBeenCalledWith(
        `[RestApiWorker] Starting worker with ID: ${worker.getInstanceId()}`,
        'info'
      );
      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Worker is ready to receive tasks',
        'info'
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

    it('should handle errors during startup', async () => {
      // Mock listenTask to throw error
      jest.spyOn(worker, 'listenTask').mockRejectedValue(new Error('Listen failed'));

      await worker.run();

      expect(mockLog).toHaveBeenCalledWith(
        '[RabbitMQWorker] Failed to run worker: Listen failed',
        'error'
      );
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
      // Clear any health check calls from constructor
      jest.clearAllMocks();
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

  describe('listenTask', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
      jest.spyOn(worker, 'onProcessedMessage').mockImplementation(() => Promise.resolve());
      // Clear any calls from constructor
      jest.clearAllMocks();
    });

    it('should process incoming messages for RestApiWorker', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: ['RestApiWorker/onProcessedMessage'],
        data: { test: 'data' },
      };

      await worker.listenTask();

      // Simulate receiving a message
      (process.emit as any)('message', message);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Received message: test-msg-1',
        'info'
      );
      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Processing message for destination: RestApiWorker/onProcessedMessage',
        'info'
      );
      expect(worker.onProcessedMessage).toHaveBeenCalledWith(message);
    });

    it('should filter and process only RestApiWorker destinations', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'DatabaseInteractionWorker/getAllData',
          'RestApiWorker/onProcessedMessage',
          'RabbitMQWorker/produceMessage',
        ],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      // Should only call onProcessedMessage once for RestApiWorker destination
      expect(worker.onProcessedMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple RestApiWorker destinations', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'RestApiWorker/onProcessedMessage',
          'RestApiWorker/onProcessedMessage',
        ],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      expect(worker.onProcessedMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle messages with no RestApiWorker destinations', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'DatabaseInteractionWorker/getAllData',
          'RabbitMQWorker/produceMessage',
        ],
        data: { test: 'data' },
      };

      await worker.listenTask();
      (process.emit as any)('message', message);

      expect(worker.onProcessedMessage).not.toHaveBeenCalled();
    });
  });

  describe('onProcessedMessage', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
    });

    it('should emit message event with processed data', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        data: { result: 'processed' },
      };

      const emitSpy = jest.spyOn(worker['eventEmitter'], 'emit');

      await worker.onProcessedMessage(message);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Processing completed message with ID: test-msg-1',
        'info'
      );
      expect(emitSpy).toHaveBeenCalledWith('message', {
        messageId: 'test-msg-1',
        data: { result: 'processed' },
        status: 'completed',
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Processed message with ID: test-msg-1',
        'info'
      );
    });
  });

  describe('getuserId', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
    });

    it('should verify valid JWT token and return user ID', async () => {
      const mockDecoded = { _id: 'user123', username: 'testuser' };
      mockJwtVerify.mockImplementation((token, secret, callback: any) => {
        callback(null, mockDecoded);
      });

      const result = await worker.getuserId('Bearer valid-token', mockRes);

      expect(result).toBe('user123');
      expect(mockJwtVerify).toHaveBeenCalledWith(
        'valid-token',
        'test-secret',
        expect.any(Function)
      );
    });

    it('should reject when authorization header is missing', async () => {
      await expect(worker.getuserId('', mockRes)).rejects.toThrow('Unauthorized');
      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Unauthorized access attempt',
        'warn'
      );
    });

    it('should reject when JWT verification fails', async () => {
      const error = new Error('Invalid token');
      mockJwtVerify.mockImplementation((token, secret, callback: any) => {
        callback(error, null);
      });

      await expect(worker.getuserId('Bearer invalid-token', mockRes)).rejects.toThrow('Invalid token');
      expect(mockLog).toHaveBeenCalledWith('[RestApiWorker] Invalid token', 'warn');
    });

    it('should reject when token payload is invalid', async () => {
      const mockDecoded = 'invalid-payload';
      mockJwtVerify.mockImplementation((token, secret, callback: any) => {
        callback(null, mockDecoded);
      });

      await expect(worker.getuserId('Bearer valid-token', mockRes)).rejects.toThrow('Invalid token payload');
      expect(mockLog).toHaveBeenCalledWith('[RestApiWorker] Invalid token payload', 'warn');
    });

    it('should reject when token payload missing _id', async () => {
      const mockDecoded = { username: 'testuser' };
      mockJwtVerify.mockImplementation((token, secret, callback: any) => {
        callback(null, mockDecoded);
      });

      await expect(worker.getuserId('Bearer valid-token', mockRes)).rejects.toThrow('Invalid token payload');
      expect(mockLog).toHaveBeenCalledWith('[RestApiWorker] Invalid token payload', 'warn');
    });
  });

  describe('sendMessageToOtherWorker', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
    });

    it('should send message and wait for response', async () => {
      const testData = { test: 'data' };
      const testDestination = ['DatabaseInteractionWorker/getAllData'];
      const expectedResponse = { result: 'success' };

      // Start the sendMessage operation
      const resultPromise = worker.sendMessageToOtherWorker(testData, testDestination);

      // Wait a tick for the message to be sent
      await new Promise(resolve => setImmediate(resolve));

      // Verify message was sent to supervisor
      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'completed',
        data: testData,
        destination: testDestination,
      });

      // Get the messageId that was sent
      const sentMessage = mockSendMessagetoSupervisor.mock.calls[0][0];
      const messageId = sentMessage.messageId;

      // Use fake timers to avoid real async timing issues
      jest.useRealTimers();
      
      // Simulate receiving response
      setImmediate(() => {
        worker['eventEmitter'].emit('message', {
          messageId,
          data: expectedResponse,
          status: 'completed',
        });
      });

      const result = await resultPromise;

      expect(result).toEqual(expectedResponse);
      expect(mockLog).toHaveBeenCalledWith(
        `[RestApiWorker] Received message for ID: ${messageId}`,
        'info'
      );
      expect(mockLog).toHaveBeenCalledWith(
        `[RestApiWorker] Response sent for ID: ${messageId}`,
        'info'
      );
      
      jest.useFakeTimers();
    }, 10000);

    it('should handle null response data', async () => {
      const testData = { test: 'data' };
      const testDestination = ['DatabaseInteractionWorker/getAllData'];

      const resultPromise = worker.sendMessageToOtherWorker(testData, testDestination);

      await new Promise(resolve => setImmediate(resolve));

      const sentMessage = mockSendMessagetoSupervisor.mock.calls[0][0];
      const messageId = sentMessage.messageId;

      jest.useRealTimers();
      
      // Simulate receiving response with null data
      setImmediate(() => {
        worker['eventEmitter'].emit('message', {
          messageId,
          data: null,
          status: 'completed',
        });
      });

      const result = await resultPromise;

      expect(result).toEqual({});
      
      jest.useFakeTimers();
    }, 10000);
  });

  describe('getData', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
      jest.spyOn(worker, 'getuserId').mockResolvedValue('user123');
      jest.spyOn(worker, 'sendMessageToOtherWorker').mockResolvedValue({ data: 'test' });
    });

    it('should get data successfully for authenticated user', async () => {
      await worker.getData(mockReq, mockRes);

      expect(worker.getuserId).toHaveBeenCalledWith('Bearer valid-token', mockRes);
      expect(worker.sendMessageToOtherWorker).toHaveBeenCalledWith({}, [
        'DatabaseInteractionWorker/getAllData/user123',
      ]);
      expect(mockRes.json).toHaveBeenCalledWith({ data: { data: 'test' } });
    });

    it('should handle authentication error', async () => {
      const error = new Error('Unauthorized');
      (worker.getuserId as jest.Mock).mockRejectedValue(error);

      await worker.getData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in getData: Unauthorized',
        'error'
      );
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should handle sendMessageToOtherWorker error', async () => {
      const error = new Error('Database error');
      (worker.sendMessageToOtherWorker as jest.Mock).mockRejectedValue(error);

      await worker.getData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in getData: Database error',
        'error'
      );
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database error' });
    });
  });

  describe('getDataById', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
      jest.spyOn(worker, 'sendMessageToOtherWorker').mockResolvedValue({ data: 'test' });
    });

    it('should get data by ID successfully', async () => {
      const testId = '507f1f77bcf86cd799439011';

      await worker.getDataById(mockReq, mockRes, testId);

      expect(worker.sendMessageToOtherWorker).toHaveBeenCalledWith({}, [
        `DatabaseInteractionWorker/getDataById/${testId}`,
      ]);
      expect(mockRes.json).toHaveBeenCalledWith({ data: { data: 'test' } });
    });

    it('should handle missing ID parameter', async () => {
      await worker.getDataById(mockReq, mockRes, '');

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Data ID not provided',
        'warn'
      );
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Data ID is required' });
    });

    it('should handle sendMessageToOtherWorker error', async () => {
      const error = new Error('Database error');
      (worker.sendMessageToOtherWorker as jest.Mock).mockRejectedValue(error);

      await worker.getDataById(mockReq, mockRes, 'test-id');

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in getData: Database error',
        'error'
      );
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database error' });
    });
  });

  describe('postData', () => {
    let mockIdempotentInstance: any;

    beforeEach(() => {
      worker = new RestApiWorker();
      
      mockIdempotentInstance = {
        checkIdempotent: jest.fn().mockResolvedValue(false),
        setIdempotent: jest.fn().mockResolvedValue(undefined),
        removeIdempotent: jest.fn().mockResolvedValue(undefined),
      };
      mockIdempotent.mockImplementation(() => mockIdempotentInstance);

      jest.spyOn(worker, 'getuserId').mockResolvedValue('user123');
      jest.spyOn(worker, 'sendMessageToOtherWorker').mockResolvedValue({ data: 'created' });
    });

    it('should create data successfully', async () => {
      await worker.postData(mockReq, mockRes);

      expect(worker.getuserId).toHaveBeenCalledWith('Bearer valid-token', mockRes);
      expect(mockIdempotentInstance.checkIdempotent).toHaveBeenCalledWith('test-key-123');
      expect(mockIdempotentInstance.setIdempotent).toHaveBeenCalledWith('test-key-123', 'processed');

      expect(worker.sendMessageToOtherWorker).toHaveBeenCalledWith(
        {
          title: 'Test Project',
          description: 'Test Description',
          keyword: 'test-keyword',
          language: 'en',
          tweetToken: 'token123',
          topic_category: 'test',
          start_date_crawl: new Date('2023-01-01'),
          end_date_crawl: new Date('2023-12-31'),
          userId: 'user123',
        },
        ['DatabaseInteractionWorker/createNewData']
      );

      expect(mockIdempotentInstance.removeIdempotent).toHaveBeenCalledWith('test-key-123');
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ data: { data: 'created' } });
      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Data created successfully',
        'success'
      );
    });

    it('should handle missing idempotent key', async () => {
      mockReq.headers['idempotent-key'] = undefined;

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Idempotent key not provided',
        'warn'
      );
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Idempotent key required' });
    });

    it('should handle duplicate idempotent operation', async () => {
      mockIdempotentInstance.checkIdempotent.mockResolvedValue(true);
      const mockData = { existing: 'data' };
      jest.spyOn(worker, 'sendMessageToOtherWorker').mockResolvedValue(mockData);

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Idempotent operation detected for key: test-key-123',
        'warn'
      );
      expect(mockRes.status).toHaveBeenCalledWith(208);
      expect(mockRes.json).toHaveBeenCalledWith({
        data: mockData,
        message: 'Operation already processed',
      });
    });

    it('should handle authentication error', async () => {
      const error = new Error('Unauthorized');
      (worker.getuserId as jest.Mock).mockRejectedValue(error);

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in postData: Unauthorized',
        'error'
      );
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });

    it('should handle database creation error', async () => {
      const error = new Error('Database error');
      (worker.sendMessageToOtherWorker as jest.Mock).mockRejectedValue(error);

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in postData: Database error',
        'error'
      );
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });

    it('should handle idempotent check error', async () => {
      const error = new Error('Redis error');
      mockIdempotentInstance.checkIdempotent.mockRejectedValue(error);

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in postData: Redis error',
        'error'
      );
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });
  });

  describe('Instance Management', () => {
    it('should have unique instance IDs for different workers', () => {
      const worker1 = new RestApiWorker();
      const worker2 = new RestApiWorker();

      expect(worker1.getInstanceId()).not.toBe(worker2.getInstanceId());
      expect(worker1.getInstanceId()).toMatch(/^RestApiWorker-/);
      expect(worker2.getInstanceId()).toMatch(/^RestApiWorker-/);
    });

    it('should track busy state correctly', () => {
      worker = new RestApiWorker();

      expect(worker.isBusy).toBe(false);

      worker.isBusy = true;
      expect(worker.isBusy).toBe(true);

      worker.isBusy = false;
      expect(worker.isBusy).toBe(false);
    });

    it('should initialize requests map', () => {
      worker = new RestApiWorker();

      expect(worker['requests']).toBeInstanceOf(Map);
      expect(worker['requests'].size).toBe(0);
    });

    it('should initialize event emitter', () => {
      worker = new RestApiWorker();

      expect(worker['eventEmitter']).toBeInstanceOf(EventEmitter);
      expect(worker['eventEmitter'].listenerCount('message')).toBe(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      worker = new RestApiWorker();
    });

    it('should handle JWT verification with string token', async () => {
      mockJwtVerify.mockImplementation((token, secret, callback: any) => {
        callback(null, 'string-token');
      });

      await expect(worker.getuserId('Bearer valid-token', mockRes)).rejects.toThrow('Invalid token payload');
    });

    it('should handle missing request body fields in postData', async () => {
      const incompleteReq = {
        headers: {
          authorization: 'Bearer valid-token',
          'idempotent-key': 'test-key',
        },
        body: {
          title: 'Test Project',
          // Missing other fields
        },
      };

      jest.spyOn(worker, 'getuserId').mockResolvedValue('user123');
      jest.spyOn(worker, 'sendMessageToOtherWorker').mockResolvedValue({ data: 'created' });

      await worker.postData(incompleteReq, mockRes);

      expect(worker.sendMessageToOtherWorker).toHaveBeenCalledWith(
        {
          title: 'Test Project',
          description: undefined,
          keyword: undefined,
          language: undefined,
          tweetToken: undefined,
          topic_category: undefined,
          start_date_crawl: new Date('undefined'), // Invalid date
          end_date_crawl: new Date('undefined'), // Invalid date
          userId: 'user123',
        },
        ['DatabaseInteractionWorker/createNewData']
      );
    });

    it('should handle event emitter memory leak prevention', () => {
      worker = new RestApiWorker();

      // Simulate multiple message sends
      for (let i = 0; i < 15; i++) {
        worker.sendMessageToOtherWorker({ test: i }, ['TestWorker/method']);
      }

      // Should not exceed the default max listeners (10)
      expect(worker['eventEmitter'].getMaxListeners()).toBeGreaterThanOrEqual(10);
    });
  });
});