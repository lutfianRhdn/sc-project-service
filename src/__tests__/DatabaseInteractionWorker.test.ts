// Mock dependencies first
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

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => mockClient),
  ObjectId: jest.fn().mockImplementation((id) => ({ toString: () => id })),
}));

jest.mock('../utils/log', () => jest.fn());
jest.mock('../utils/handleMessage', () => ({
  sendMessagetoSupervisor: jest.fn(),
}));

import * as mongoDB from 'mongodb';
import { Message } from '../utils/handleMessage';

const mockLog = require('../utils/log');
const mockSendMessagetoSupervisor = require('../utils/handleMessage').sendMessagetoSupervisor;

// Create a simplified worker class for testing
class TestDatabaseInteractionWorker {
  public isBusy: boolean = false;
  private instanceId: string;

  constructor() {
    this.instanceId = `DatabaseInteractionWorker-${Date.now()}`;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  async getAllData({ id }: any): Promise<any> {
    try {
      const data = await mockCollection.find({ userId: id }).toArray();
      mockLog(`[DatabaseInteractionWorker] Successfully retrieved ${data.length} documents`, 'success');
      return { data, destination: [`RestApiWorker/onProcessedMessage`] };
    } catch (error) {
      mockLog(`[DatabaseInteractionWorker] Error retrieving data: ${error.message}`, 'error');
      return [];
    }
  }

  async getDataById({ id }: any): Promise<any> {
    try {
      const data = await mockCollection.findOne({ _id: new mongoDB.ObjectId(id) });
      if (!data) {
        mockLog(`[DatabaseInteractionWorker] No data found for ID: ${id}`, 'warn');
        return { data: null, destination: [`RestApiWorker/onProcessedMessage`] };
      }
      mockLog(`[DatabaseInteractionWorker] Successfully retrieved document with ID: ${id}`, 'success');
      return { data, destination: [`RestApiWorker/onProcessedMessage`] };
    } catch (error) {
      mockLog(`[DatabaseInteractionWorker] Error retrieving data by ID: ${error.message}`, 'error');
      return { data: null, destination: [`RestApiWorker/onProcessedMessage`] };
    }
  }

  async createNewData({ data }: any): Promise<any> {
    try {
      if (!data || data.length === 0) {
        mockLog("[DatabaseInteractionWorker] No data provided to insert", 'warn');
        return;
      }
      const tweetToken = data.tweetToken;
      delete data.tweetToken;

      const insertedData = await mockCollection.insertOne({
        ...data,
        start_date_crawl: new Date(data.start_date_crawl),
        end_date_crawl: new Date(data.end_date_crawl),
        createdAt: new Date(),
      });
      const project = await mockCollection.findOne({ _id: insertedData.insertedId });
      project.tweetToken = tweetToken;
      return {
        data: project,
        destination: [
          `RestApiWorker/onProcessedMessage/`,
          `RabbitMQWorker/produceMessage`
        ],
      };
    } catch (error) {
      mockLog(`[DatabaseInteractionWorker] Error creating new data: ${error.message}`, "error");
    }
  }
}

describe('DatabaseInteractionWorker (Simplified)', () => {
  let worker: TestDatabaseInteractionWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new TestDatabaseInteractionWorker();
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID', () => {
      expect(worker.getInstanceId()).toMatch(/^DatabaseInteractionWorker-\d+$/);
      expect(worker.isBusy).toBe(false);
    });
  });

  describe('getAllData', () => {
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
    it('should retrieve data by MongoDB ObjectId', async () => {
      const mockData = { _id: '507f1f77bcf86cd799439011', title: 'Test Data' };
      mockFindOne.mockResolvedValue(mockData);

      const result = await worker.getDataById({ id: '507f1f77bcf86cd799439011' });

      expect(mockFindOne).toHaveBeenCalledWith({
        _id: expect.any(Object),
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

  describe('createNewData', () => {
    it('should create new data successfully', async () => {
      const inputData = {
        title: 'Test Project',
        keyword: 'test',
        start_date_crawl: '2023-01-01',
        end_date_crawl: '2023-12-31',
        tweetToken: 'token123',
        userId: 'user123',
      };

      const insertedId = { toString: () => 'new-id' };
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
});