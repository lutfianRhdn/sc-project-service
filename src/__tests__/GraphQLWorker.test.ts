import { GraphQLWorker } from '../workers/GraphQLWorker';

// Mock dependencies
jest.mock('../utils/log', () => jest.fn());
jest.mock('../utils/RequestCounter', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn().mockReturnValue({
      incrementTotal: jest.fn(),
      incrementSuccessful: jest.fn(),
      incrementFailed: jest.fn(),
      logStats: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        total: 0,
        successful: 0,
        failed: 0,
        startTime: new Date(),
      }),
      reset: jest.fn(),
    }),
  },
}));
jest.mock('../utils/handleMessage', () => ({
  sendMessagetoSupervisor: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));
jest.mock('@apollo/server', () => ({
  ApolloServer: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  })),
}));
jest.mock('@apollo/server/standalone', () => ({
  startStandaloneServer: jest.fn().mockResolvedValue({ url: 'http://localhost:4001' }),
}));

describe('GraphQLWorker', () => {
  let worker: GraphQLWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock process.on to prevent actual event listeners in tests
    jest.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct instance ID', () => {
      worker = new GraphQLWorker();
      expect(worker.getInstanceId()).toMatch(/^GraphQLWorker-/);
    });

    it('should set isBusy to false initially', () => {
      worker = new GraphQLWorker();
      expect(worker.isBusy).toBe(false);
    });
  });

  describe('Message handling', () => {
    beforeEach(() => {
      worker = new GraphQLWorker();
    });

    it('should handle onProcessedMessage', async () => {
      const mockMessage = {
        messageId: 'test-id',
        data: { test: 'data' },
        status: 'completed' as const,
        destination: ['GraphQLWorker/onProcessedMessage'],
      };

      // Mock the event emitter
      const emitSpy = jest.spyOn(worker['eventEmitter'], 'emit');
      
      await worker['onProcessedMessage'](mockMessage);
      
      expect(emitSpy).toHaveBeenCalledWith('message', {
        messageId: 'test-id',
        data: { test: 'data' },
        status: 'completed',
      });
    });
  });

  describe('Authentication', () => {
    beforeEach(() => {
      worker = new GraphQLWorker();
    });

    it('should reject unauthorized requests', async () => {
      await expect(worker.getuserId('')).rejects.toThrow('Unauthorized');
    });

    it('should handle JWT verification', async () => {
      const jwt = require('jsonwebtoken');
      jwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, { _id: 'user123' });
      });

      const userId = await worker.getuserId('Bearer validtoken');
      expect(userId).toBe('user123');
    });
  });
});