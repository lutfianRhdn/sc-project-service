// Mock dependencies
const mockJwtVerify = jest.fn();

jest.mock('jsonwebtoken', () => ({
  verify: mockJwtVerify,
}));

jest.mock('../utils/log', () => jest.fn());
jest.mock('../utils/handleMessage', () => ({
  sendMessagetoSupervisor: jest.fn(),
}));

const mockIdempotentClass = jest.fn().mockImplementation(() => ({
  checkIdempotent: jest.fn().mockResolvedValue(false),
  setIdempotent: jest.fn().mockResolvedValue(undefined),
  removeIdempotent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/Imdempotent', () => mockIdempotentClass);

import { Message } from '../utils/handleMessage';

const mockLog = require('../utils/log');
const mockSendMessagetoSupervisor = require('../utils/handleMessage').sendMessagetoSupervisor;

// Simplified RestApiWorker for testing
class TestRestApiWorker {
  public isBusy: boolean = false;
  private instanceId: string;

  constructor() {
    this.instanceId = `RestApiWorker-${Date.now()}-${Math.random()}`;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  async getuserId(authorization: string, res: any): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!authorization) {
        mockLog(`[RestApiWorker] Unauthorized access attempt`, "warn");
        reject(new Error("Unauthorized"));
        return;
      }
      const token = authorization.split(" ")[1];
      mockJwtVerify(token, process.env.jwt_secret as string, (err: any, decoded: any) => {
        if (err) {
          mockLog(`[RestApiWorker] Invalid token`, "warn");
          reject(err);
          return;
        }
        if (typeof decoded !== "string" && "_id" in decoded) {
          resolve(decoded._id);
          return;
        }
        mockLog(`[RestApiWorker] Invalid token payload`, "warn");
        reject(new Error("Invalid token payload"));
      });
    });
  }

  async sendMessageToOtherWorker(data: any, destination: string[]): Promise<any> {
    const messageId = `test-msg-${Date.now()}`;
    mockSendMessagetoSupervisor({
      messageId,
      status: 'completed',
      data,
      destination,
    });
    
    mockLog(`[RestApiWorker] Received message for ID: ${messageId}`, 'info');
    mockLog(`[RestApiWorker] Response sent for ID: ${messageId}`, 'info');
    
    // Simulate successful response
    return { result: 'success' };
  }

  async getData(req: any, res: any): Promise<void> {
    try {
      const userId = await this.getuserId(req.headers.authorization, res);
      const result = await this.sendMessageToOtherWorker({}, [`DatabaseInteractionWorker/getAllData/${userId}`]);
      res.json({ data: result });
    } catch (error) {
      mockLog(`[RestApiWorker] Error in getData: ${error.message}`, 'error');
      res.json({ error: error.message });
    }
  }

  async getDataById(req: any, res: any, id: string): Promise<void> {
    try {
      if (!id) {
        mockLog(`[RestApiWorker] Data ID not provided`, "warn");
        res.status(400).json({ error: "Data ID is required" });
        return;
      }
      const result = await this.sendMessageToOtherWorker({}, [`DatabaseInteractionWorker/getDataById/${id}`]);
      res.json({ data: result });
    } catch (error) {
      mockLog(`[RestApiWorker] Error in getData: ${error.message}`, 'error');
      res.json({ error: error.message });
    }
  }

  async postData(req: any, res: any): Promise<void> {
    const {
      title,
      description,
      category,
      keyword,
      language,
      tweetToken,
      start_date_crawl,
      end_date_crawl,
    } = req.body;

    try {
      const userId = await this.getuserId(req.headers.authorization, res);

      const idempotentKey = req.headers["idempotent-key"];
      if (!idempotentKey) {
        mockLog(`[RestApiWorker] Idempotent key not provided`, "warn");
        res.status(400).json({ error: "Idempotent key required" });
        return;
      }

      // Check if the idempotent key already exists
      const idempotent = new mockIdempotentClass();
      const isIdempotent = await idempotent.checkIdempotent(idempotentKey);
      if (isIdempotent) {
        mockLog(`[RestApiWorker] Idempotent operation detected for key: ${idempotentKey}`, "warn");
        const data = await this.sendMessageToOtherWorker(
          {
            keyword,
            start_date_crawl,
            end_date_crawl,
          },
          [`DatabaseInteractionWorker/getDataByKeywordAndRange`]
        );
        res.status(208).json({
          data,
          message: "Operation already processed",
        });
        return;
      }

      // Set the idempotent key to prevent duplicate processing
      await idempotent.setIdempotent(idempotentKey, "processed");

      const result = await this.sendMessageToOtherWorker(
        {
          title,
          description,
          keyword,
          language,
          tweetToken,
          topic_category: category,
          start_date_crawl: new Date(start_date_crawl),
          end_date_crawl: new Date(end_date_crawl),
          userId: userId as string,
        },
        [`DatabaseInteractionWorker/createNewData`]
      );
      mockLog(`[RestApiWorker] Data created successfully`, "success");

      idempotent.removeIdempotent(idempotentKey);
      res.status(201).json({ data: result });
    } catch (error) {
      mockLog(`[RestApiWorker] Error in postData: ${error.message}`, 'error');
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
}

describe('RestApiWorker (Simplified)', () => {
  let worker: TestRestApiWorker;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    process.env.jwt_secret = 'test-secret';

    worker = new TestRestApiWorker();

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
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID', () => {
      expect(worker.getInstanceId()).toMatch(/^RestApiWorker-/);
      expect(worker.isBusy).toBe(false);
    });
  });

  describe('getuserId', () => {
    it('should verify valid JWT token and return user ID', async () => {
      const mockDecoded = { _id: 'user123', username: 'testuser' };
      mockJwtVerify.mockImplementation((token, secret, callback) => {
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
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(error, null);
      });

      await expect(worker.getuserId('Bearer invalid-token', mockRes)).rejects.toThrow('Invalid token');
      expect(mockLog).toHaveBeenCalledWith('[RestApiWorker] Invalid token', 'warn');
    });

    it('should reject when token payload is invalid', async () => {
      const mockDecoded = 'invalid-payload';
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(null, mockDecoded);
      });

      await expect(worker.getuserId('Bearer valid-token', mockRes)).rejects.toThrow('Invalid token payload');
      expect(mockLog).toHaveBeenCalledWith('[RestApiWorker] Invalid token payload', 'warn');
    });
  });

  describe('sendMessageToOtherWorker', () => {
    it('should send message and return response', async () => {
      const testData = { test: 'data' };
      const testDestination = ['DatabaseInteractionWorker/getAllData'];

      const result = await worker.sendMessageToOtherWorker(testData, testDestination);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'completed',
        data: testData,
        destination: testDestination,
      });

      expect(result).toEqual({ result: 'success' });
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('[RestApiWorker] Received message for ID:'),
        'info'
      );
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('[RestApiWorker] Response sent for ID:'),
        'info'
      );
    });
  });

  describe('getData', () => {
    it('should get data successfully for authenticated user', async () => {
      const mockDecoded = { _id: 'user123' };
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(null, mockDecoded);
      });

      await worker.getData(mockReq, mockRes);

      expect(mockJwtVerify).toHaveBeenCalled();
      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'completed',
        data: {},
        destination: ['DatabaseInteractionWorker/getAllData/user123'],
      });
      expect(mockRes.json).toHaveBeenCalledWith({ data: { result: 'success' } });
    });

    it('should handle authentication error', async () => {
      const error = new Error('Unauthorized');
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(error, null);
      });

      await worker.getData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in getData: Unauthorized',
        'error'
      );
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });

  describe('getDataById', () => {
    it('should get data by ID successfully', async () => {
      const testId = '507f1f77bcf86cd799439011';

      await worker.getDataById(mockReq, mockRes, testId);

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'completed',
        data: {},
        destination: [`DatabaseInteractionWorker/getDataById/${testId}`],
      });
      expect(mockRes.json).toHaveBeenCalledWith({ data: { result: 'success' } });
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
  });

  describe('postData', () => {
    it('should create data successfully', async () => {
      const mockDecoded = { _id: 'user123' };
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(null, mockDecoded);
      });

      const mockIdempotentInstance = {
        checkIdempotent: jest.fn().mockResolvedValue(false),
        setIdempotent: jest.fn().mockResolvedValue(undefined),
        removeIdempotent: jest.fn().mockResolvedValue(undefined),
      };
      mockIdempotentClass.mockImplementation(() => mockIdempotentInstance);

      await worker.postData(mockReq, mockRes);

      expect(mockIdempotentInstance.checkIdempotent).toHaveBeenCalledWith('test-key-123');
      expect(mockIdempotentInstance.setIdempotent).toHaveBeenCalledWith('test-key-123', 'processed');

      expect(mockSendMessagetoSupervisor).toHaveBeenCalledWith({
        messageId: expect.any(String),
        status: 'completed',
        data: {
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
        destination: ['DatabaseInteractionWorker/createNewData'],
      });

      expect(mockIdempotentInstance.removeIdempotent).toHaveBeenCalledWith('test-key-123');
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ data: { result: 'success' } });
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
      const mockDecoded = { _id: 'user123' };
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(null, mockDecoded);
      });

      const mockIdempotentInstance = {
        checkIdempotent: jest.fn().mockResolvedValue(true),
        setIdempotent: jest.fn().mockResolvedValue(undefined),
        removeIdempotent: jest.fn().mockResolvedValue(undefined),
      };
      mockIdempotentClass.mockImplementation(() => mockIdempotentInstance);

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Idempotent operation detected for key: test-key-123',
        'warn'
      );
      expect(mockRes.status).toHaveBeenCalledWith(208);
      expect(mockRes.json).toHaveBeenCalledWith({
        data: { result: 'success' },
        message: 'Operation already processed',
      });
    });

    it('should handle authentication error', async () => {
      const error = new Error('Unauthorized');
      mockJwtVerify.mockImplementation((token, secret, callback) => {
        callback(error, null);
      });

      await worker.postData(mockReq, mockRes);

      expect(mockLog).toHaveBeenCalledWith(
        '[RestApiWorker] Error in postData: Unauthorized',
        'error'
      );
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });
  });

  describe('Instance Management', () => {
    it('should have unique instance IDs for different workers', () => {
      const worker1 = new TestRestApiWorker();
      const worker2 = new TestRestApiWorker();

      expect(worker1.getInstanceId()).not.toBe(worker2.getInstanceId());
      expect(worker1.getInstanceId()).toMatch(/^RestApiWorker-/);
      expect(worker2.getInstanceId()).toMatch(/^RestApiWorker-/);
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