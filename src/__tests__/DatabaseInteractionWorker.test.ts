// Mock dependencies
jest.mock('mongodb');
jest.mock('../utils/log');
jest.mock('../utils/handleMessage');

// Mock the MongoClient constructor before importing the worker
const mockToArray = jest.fn();
const mockFind = jest.fn().mockReturnValue({ toArray: mockToArray, sort: jest.fn().mockReturnThis() });
const mockFindOne = jest.fn();
const mockInsertOne = jest.fn();

const mockCollection = {
  find: mockFind,
  findOne: mockFindOne,
  insertOne: mockInsertOne,
} as any;

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
} as any;

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClient = {
  connect: mockConnect,
  db: jest.fn().mockReturnValue(mockDb),
} as any;

// Mock MongoDB.MongoClient constructor
(require('mongodb').MongoClient as jest.MockedClass<any>) = jest.fn().mockImplementation(() => mockClient);

// Now import the worker after mocking
import DatabaseInteractionWorker from '../workers/DatabaseInteractionWorker';
import * as mongoDB from 'mongodb';
import { Message } from '../utils/handleMessage';

const mockLog = require('../utils/log').default;
const mockSendMessagetoSupervisor = require('../utils/handleMessage').sendMessagetoSupervisor;

describe('DatabaseInteractionWorker', () => {
  let worker: DatabaseInteractionWorker;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Clear any existing timers
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock environment variables
    process.env.db_url = 'mongodb://localhost:27017';
    process.env.db_name = 'test_project';
    process.env.collection_name = 'test_data';

    // Reset mock implementations
    mockToArray.mockClear();
    mockFind.mockClear().mockReturnValue({ toArray: mockToArray, sort: jest.fn().mockReturnThis() });
    mockFindOne.mockClear();
    mockInsertOne.mockClear();
    mockConnect.mockClear().mockResolvedValue(undefined);

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
      // Clear any intervals that might be running
      jest.clearAllTimers();
    }
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID and start worker', async () => {
      worker = new DatabaseInteractionWorker();

      expect(worker.getInstanceId()).toMatch(/^DatabaseInteractionWorker-\d+$/);
      expect(worker.isBusy).toBe(false);
      expect(require('mongodb').MongoClient).toHaveBeenCalledWith(
        'mongodb://localhost:27017'
      );
    });

    it('should use default values when environment variables are not set', () => {
      delete process.env.db_url;
      delete process.env.db_name;
      delete process.env.collection_name;

      worker = new DatabaseInteractionWorker();

      expect(require('mongodb').MongoClient).toHaveBeenCalledWith(
        'mongodb://localhost:27017'
      );
      expect(mockClient.db).toHaveBeenCalledWith('project');
      expect(mockDb.collection).toHaveBeenCalledWith('data');
    });
  });

  describe('run', () => {
    beforeEach(() => {
      worker = new DatabaseInteractionWorker();
    });

    it('should connect to MongoDB successfully', async () => {
      mockConnect.mockResolvedValue(undefined);

      await worker.run();

      expect(mockConnect).toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Connected to MongoDB',
        'success'
      );
    });

    it('should handle MongoDB connection error', async () => {
      const error = new Error('Connection failed');
      mockConnect.mockRejectedValue(error);

      await worker.run();

      expect(mockConnect).toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Error connecting to MongoDB: Connection failed',
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
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      worker = new DatabaseInteractionWorker();
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
      worker = new DatabaseInteractionWorker();
      jest.spyOn(worker, 'getAllData').mockResolvedValue({ data: [], destination: [] });
    });

    it('should process incoming messages when not busy', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: ['DatabaseInteractionWorker/getAllData/user123'],
        data: { test: 'data' },
      };

      await worker.listenTask();

      // Simulate receiving a message
      (process.emit as any)('message', message);

      expect(worker.getAllData).toHaveBeenCalledWith({
        id: 'user123',
        data: { test: 'data' },
      });
    });

    it('should reject messages when worker is busy', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: ['DatabaseInteractionWorker/getAllData/user123'],
        data: { test: 'data' },
      };

      worker.isBusy = true;

      await worker.listenTask();
      (process.emit as any)('message', message);

      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Worker is busy, cannot process new task',
        'warn'
      );

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        ...message,
        status: 'failed',
        reason: 'SERVER_BUSY',
      });
    });

    it('should handle multiple destinations in single message', async () => {
      const message: Message = {
        messageId: 'test-msg-1',
        status: 'completed',
        destination: [
          'DatabaseInteractionWorker/getAllData/user123',
          'DatabaseInteractionWorker/getDataById/507f1f77bcf86cd799439011',
        ],
        data: { test: 'data' },
      };

      jest.spyOn(worker, 'getDataById').mockResolvedValue({ data: null, destination: [] });

      await worker.listenTask();
      (process.emit as any)('message', message);

      expect(worker.getAllData).toHaveBeenCalledWith({
        id: 'user123',
        data: { test: 'data' },
      });
      expect(worker.getDataById).toHaveBeenCalledWith({
        id: '507f1f77bcf86cd799439011',
        data: { test: 'data' },
      });
    });
  });

  describe('getAllData', () => {
    beforeEach(() => {
      worker = new DatabaseInteractionWorker();
    });

    it('should retrieve all data for a user ID', async () => {
      const mockData = [
        { _id: '1', userId: 'user123', title: 'Test 1' },
        { _id: '2', userId: 'user123', title: 'Test 2' },
      ];
      mockToArray.mockResolvedValue(mockData);

      const result = await worker.getAllData({ id: 'user123' });

      expect(mockFind).toHaveBeenCalledWith({ userId: 'user123' });
      expect(result).toEqual({
        data: mockData,
        destination: ['RestApiWorker/onProcessedMessage'],
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Successfully retrieved 2 documents',
        'success'
      );
    });

    it('should handle database error gracefully', async () => {
      const error = new Error('Database error');
      mockToArray.mockRejectedValue(error);

      const result = await worker.getAllData({ id: 'user123' });

      expect(result).toEqual([]);
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Error retrieving data: Database error',
        'error'
      );
    });
  });

  describe('getDataById', () => {
    beforeEach(() => {
      worker = new DatabaseInteractionWorker();
    });

    it('should retrieve data by MongoDB ObjectId', async () => {
      const mockData = { _id: '507f1f77bcf86cd799439011', title: 'Test Data' };
      mockFindOne.mockResolvedValue(mockData);

      const result = await worker.getDataById({ id: '507f1f77bcf86cd799439011' });

      expect(mockFindOne).toHaveBeenCalledWith({
        _id: new mongoDB.ObjectId('507f1f77bcf86cd799439011'),
      });
      expect(result).toEqual({
        data: mockData,
        destination: ['RestApiWorker/onProcessedMessage'],
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Successfully retrieved document with ID: 507f1f77bcf86cd799439011',
        'success'
      );
    });

    it('should handle case when document is not found', async () => {
      mockFindOne.mockResolvedValue(null);

      const result = await worker.getDataById({ id: '507f1f77bcf86cd799439011' });

      expect(result).toEqual({
        data: null,
        destination: ['RestApiWorker/onProcessedMessage'],
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] No data found for ID: 507f1f77bcf86cd799439011',
        'warn'
      );
    });

    it('should handle database error', async () => {
      const error = new Error('Database error');
      mockFindOne.mockRejectedValue(error);

      const result = await worker.getDataById({ id: '507f1f77bcf86cd799439011' });

      expect(result).toEqual({
        data: null,
        destination: ['RestApiWorker/onProcessedMessage'],
      });
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Error retrieving data by ID: Database error',
        'error'
      );
    });
  });

  describe('getDataByKeywordAndRange', () => {
    beforeEach(() => {
      worker = new DatabaseInteractionWorker();
    });

    it('should retrieve data by keyword and date range', async () => {
      const mockData = [{ _id: '1', keyword: 'test', title: 'Test Data' }];
      const mockQuery = {
        keyword: 'test',
        start_date_crawl: new Date('2023-01-01'),
        end_date_crawl: new Date('2023-12-31'),
      };

      // Mock the chained methods
      const mockSort = jest.fn().mockReturnValue([mockData]);
      mockFind.mockReturnValue({ sort: mockSort });

      const requestData = {
        keyword: 'test',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
      };

      const result = await worker.getDataByKeywordAndRange({ data: requestData });

      expect(mockFind).toHaveBeenCalledWith(mockQuery, { sort: { createdAt: 1 } });
      expect(result).toEqual({
        data: mockData,
        destination: ['RestApiWorker/onProcessedMessage'],
      });
    });

    it('should handle database error in promise', async () => {
      const error = new Error('Database error');
      mockFind.mockImplementation(() => {
        throw error;
      });

      const requestData = {
        keyword: 'test',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
      };

      await expect(worker.getDataByKeywordAndRange({ data: requestData })).rejects.toThrow('Database error');
    });
  });

  describe('createNewData', () => {
    beforeEach(() => {
      worker = new DatabaseInteractionWorker();
    });

    it('should create new data successfully', async () => {
      const inputData = {
        title: 'Test Project',
        keyword: 'test',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
        tweetToken: 'token123',
        userId: 'user123',
      };

      const insertedId = new mongoDB.ObjectId();
      mockInsertOne.mockResolvedValue({ insertedId });

      const mockProject = {
        _id: insertedId,
        title: 'Test Project',
        keyword: 'test',
        start_date_crawl: new Date('2023-01-01'),
        end_date_crawl: new Date('2023-12-31'),
        userId: 'user123',
        createdAt: expect.any(Date),
      };
      mockFindOne.mockResolvedValue(mockProject);

      const result = await worker.createNewData({ data: inputData });

      expect(mockInsertOne).toHaveBeenCalledWith({
        title: 'Test Project',
        keyword: 'test',
        start_date_crawl: new Date('2023-01-01'),
        end_date_crawl: new Date('2023-12-31'),
        userId: 'user123',
        createdAt: expect.any(Date),
      });

      expect(mockFindOne).toHaveBeenCalledWith({ _id: insertedId });

      expect(result).toEqual({
        data: { ...mockProject, tweetToken: 'token123' },
        destination: [
          'RestApiWorker/onProcessedMessage/',
          'RabbitMQWorker/produceMessage',
        ],
      });
    });

    it('should handle empty data', async () => {
      const result = await worker.createNewData({ data: null });

      expect(result).toBeUndefined();
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] No data provided to insert',
        'warn'
      );
      expect(mockInsertOne).not.toHaveBeenCalled();
    });

    it('should handle empty array data', async () => {
      const result = await worker.createNewData({ data: [] });

      expect(result).toBeUndefined();
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] No data provided to insert',
        'warn'
      );
      expect(mockInsertOne).not.toHaveBeenCalled();
    });

    it('should handle database insertion error', async () => {
      const inputData = {
        title: 'Test Project',
        keyword: 'test',
        tweetToken: 'token123',
      };

      const error = new Error('Insertion failed');
      mockInsertOne.mockRejectedValue(error);

      const result = await worker.createNewData({ data: inputData });

      expect(result).toBeUndefined();
      expect(mockLog).toHaveBeenCalledWith(
        '[DatabaseInteractionWorker] Error creating new data: Insertion failed',
        'error'
      );
    });
  });

  describe('Instance Management', () => {
    it('should have unique instance IDs for different workers', () => {
      const worker1 = new DatabaseInteractionWorker();
      const worker2 = new DatabaseInteractionWorker();

      expect(worker1.getInstanceId()).not.toBe(worker2.getInstanceId());
      expect(worker1.getInstanceId()).toMatch(/^DatabaseInteractionWorker-\d+$/);
      expect(worker2.getInstanceId()).toMatch(/^DatabaseInteractionWorker-\d+$/);
    });

    it('should track busy state correctly', () => {
      worker = new DatabaseInteractionWorker();

      expect(worker.isBusy).toBe(false);

      worker.isBusy = true;
      expect(worker.isBusy).toBe(true);

      worker.isBusy = false;
      expect(worker.isBusy).toBe(false);
    });
  });
});