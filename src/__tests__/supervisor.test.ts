import Supervisor from '../supervisor';
import { ChildProcess } from 'child_process';
import { Message } from '../utils/handleMessage';
import { Timestamp } from 'mongodb';

// Mock dependencies
jest.mock('child_process');
jest.mock('../utils/log');
jest.mock('../configs/worker', () => ({
  workerConfig: {
    RestAPIWorker: {
      count: 1,
      cpu: 1,
      memory: 1024,
      config: {},
    },
    DatabaseInteractionWorker: {
      count: 1,
      cpu: 1,
      memory: 1024,
      config: {},
    },
    RabbitMQWorker: {
      count: 1,
      cpu: 1,
      memory: 1024,
      config: {},
    },
  },
}));

const mockChildProcess = require('child_process');
const mockLog = require('../utils/log').default;

describe('Supervisor', () => {
  let supervisor: Supervisor;
  let mockWorker: Partial<ChildProcess>;
  let mockSpawn: jest.MockedFunction<typeof mockChildProcess.spawn>;
  let mockExecSync: jest.MockedFunction<typeof mockChildProcess.execSync>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock worker process
    mockWorker = {
      pid: 12345,
      exitCode: null,
      killed: false,
      spawnargs: ['node', '/path/to/worker/RestAPIWorker.ts'],
      on: jest.fn(),
      send: jest.fn(),
      kill: jest.fn(),
    };

    // Mock spawn to return our mock worker
    mockSpawn = mockChildProcess.spawn.mockReturnValue(mockWorker);
    
    // Mock execSync for process state check
    mockExecSync = mockChildProcess.execSync.mockReturnValue(Buffer.from('S')); // Sleeping state

    // Mock log function
    mockLog.mockImplementation(() => {});
  });

  describe('Constructor', () => {
    it('should initialize supervisor and create default workers', () => {
      supervisor = new Supervisor();

      // Should call spawn for 3 default workers (RestAPI, Database, RabbitMQ)
      expect(mockSpawn).toHaveBeenCalledTimes(3);
      
      // Should log initialization
      expect(mockLog).toHaveBeenCalledWith('[Supervisor] Supervisor initialized');
    });

    it('should set up event listeners for workers', () => {
      supervisor = new Supervisor();

      // Each worker should have event listeners set up
      expect(mockWorker.on).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('createWorker', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks(); // Clear initialization calls
    });

    it('should create worker with valid configuration', () => {
      const options = {
        worker: 'TestWorker',
        count: 2,
        config: { test: 'value' },
        cpu: 1,
        memory: 512,
      };

      supervisor.createWorker(options);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] Creating 2 worker(s) of type TestWorker',
        'info'
      );
    });

    it('should throw error when count is zero or negative', () => {
      const options = {
        worker: 'TestWorker',
        count: 0,
        config: {},
        cpu: 1,
        memory: 512,
      };

      expect(() => supervisor.createWorker(options)).toThrow('Worker count must be greater than zero');
      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] Worker count must be greater than zero',
        'error'
      );
    });

    it('should spawn worker with correct arguments', () => {
      const options = {
        worker: 'TestWorker',
        count: 1,
        config: { test: 'config' },
        cpu: 1,
        memory: 512,
      };

      supervisor.createWorker(options);

      // Check that spawn was called with the correct structure
      expect(mockSpawn).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining([
          expect.stringContaining('ts-node'),
          expect.stringContaining('TestWorker.ts'),
        ]),
        {
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
          env: { test: 'config' },
        }
      );
    });

    it('should restart worker on exit', () => {
      const options = {
        worker: 'TestWorker',
        count: 1,
        config: {},
        cpu: 1,
        memory: 512,
      };

      supervisor.createWorker(options);

      // Get the exit handler
      const exitHandler = (mockWorker.on as jest.Mock).mock.calls.find(
        call => call[0] === 'exit'
      )[1];

      // Clear previous spawn calls
      jest.clearAllMocks();

      // Trigger exit
      exitHandler();

      // Should spawn a new worker
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledWith(
        `[Supervisor] Worker exited. PID: ${mockWorker.pid}`,
        'warn'
      );
    });
  });

  describe('handleWorkerMessage', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks();
    });

    it('should route message to other workers', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['DatabaseInteractionWorker'],
        data: {},
      };

      // Mock handleSendMessageWorker
      const handleSendSpy = jest.spyOn(supervisor, 'handleSendMessageWorker');

      supervisor.handleWorkerMessage(message, 12345);

      expect(handleSendSpy).toHaveBeenCalledWith(12345, expect.objectContaining({
        messageId: 'msg-1',
        destination: ['DatabaseInteractionWorker'],
      }));
    });

    it('should remove pending message on completion', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['supervisor'],
        data: {},
      };

      // Setup pending message first
      supervisor['pendingMessages']['supervisor'] = [{
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['supervisor'],
        data: {},
        timestamp: Date.now(),
      }];

      supervisor.handleWorkerMessage(message, 12345);

      expect(supervisor['pendingMessages']['supervisor']).toHaveLength(0);
    });
  });

  describe('handleSendMessageWorker', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks();
    });

    it('should send message to available worker', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['RestAPIWorker'],
        data: {},
      };

      // Mock available worker
      const availableWorker = {
        ...mockWorker,
        spawnargs: ['node', '/path/to/RestAPIWorker.ts'],
      };
      supervisor['workers'] = [availableWorker as ChildProcess];

      supervisor.handleSendMessageWorker(12345, message);

      expect(availableWorker.send).toHaveBeenCalledWith(message);
      expect(mockLog).toHaveBeenCalledWith(
        `[Supervisor] sent message msg-1 to worker: RestAPIWorker (${availableWorker.pid})`,
        'success'
      );
    });

    it('should handle error status and restart worker', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'error',
        reason: 'Test error',
        destination: ['RestAPIWorker'],
        data: {},
      };

      const worker = { ...mockWorker };
      supervisor['workers'] = [worker as ChildProcess];

      const restartSpy = jest.spyOn(supervisor, 'restartWorker');

      supervisor.handleSendMessageWorker(12345, message);

      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] Error in worker 12345: Test error',
        'error'
      );
      expect(restartSpy).toHaveBeenCalledWith(worker);
    });

    it('should create new worker when none available', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['NewWorker'],
        data: {},
      };

      // No workers available
      supervisor['workers'] = [];

      const createWorkerSpy = jest.spyOn(supervisor, 'createWorker');

      supervisor.handleSendMessageWorker(12345, message);

      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] No worker found for destination: NewWorker',
        'warn'
      );
      expect(createWorkerSpy).toHaveBeenCalled();
    });

    it('should handle SERVER_BUSY failure', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'failed',
        reason: 'SERVER_BUSY',
        destination: ['RestAPIWorker'],
        data: {},
      };

      const busyWorker = {
        ...mockWorker,
        pid: 12345,
        spawnargs: ['node', '/path/to/RestAPIWorker.ts'],
      };
      const availableWorker = {
        ...mockWorker,
        pid: 54321,
        spawnargs: ['node', '/path/to/RestAPIWorker.ts'],
      };

      supervisor['workers'] = [busyWorker, availableWorker] as ChildProcess[];

      supervisor.handleSendMessageWorker(12345, message);

      // Should send to available worker, not the busy one
      expect(availableWorker.send).toHaveBeenCalledWith(message);
    });
  });

  describe('restartWorker', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks();
    });

    it('should restart worker and resend pending messages', () => {
      const worker = {
        ...mockWorker,
        spawnargs: ['node', '/path/to/workers/TestWorker.ts'],
      } as ChildProcess;

      // Setup pending messages
      supervisor['pendingMessages']['TestWorker'] = [{
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['TestWorker'],
        data: {},
        timestamp: Date.now(),
      }];

      const createWorkerSpy = jest.spyOn(supervisor, 'createWorker');
      const resendSpy = jest.spyOn(supervisor as any, 'resendPendingMessages');

      supervisor.restartWorker(worker);

      expect(mockLog).toHaveBeenCalledWith(
        `[Supervisor] Restarting worker: TestWorker (PID: ${worker.pid})`,
        'warn'
      );
      expect(worker.kill).toHaveBeenCalled();
      expect(createWorkerSpy).toHaveBeenCalled();
      expect(resendSpy).toHaveBeenCalledWith('TestWorker');
    });
  });

  describe('Message Tracking', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks();
    });

    it('should track pending messages', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['TestWorker'],
        data: {},
      };

      supervisor['trackPendingMessage']('TestWorker', message);

      expect(supervisor['pendingMessages']['TestWorker']).toHaveLength(1);
      expect(supervisor['pendingMessages']['TestWorker'][0].messageId).toBe('msg-1');
    });

    it('should not duplicate pending messages', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['TestWorker'],
        data: {},
      };

      supervisor['trackPendingMessage']('TestWorker', message);
      supervisor['trackPendingMessage']('TestWorker', message);

      expect(supervisor['pendingMessages']['TestWorker']).toHaveLength(1);
    });

    it('should remove pending messages', () => {
      supervisor['pendingMessages']['TestWorker'] = [{
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['TestWorker'],
        data: {},
        timestamp: Date.now(),
      }];

      supervisor['removePendingMessage']('TestWorker', 'msg-1');

      expect(supervisor['pendingMessages']['TestWorker']).toHaveLength(0);
    });

    it('should resend pending messages to available worker', () => {
      const pendingMessage = {
        messageId: 'msg-1',
        status: 'completed' as const,
        reason: '',
        destination: ['TestWorker'],
        data: {},
        timestamp: Date.now(),
      };

      supervisor['pendingMessages']['TestWorker'] = [pendingMessage];

      const availableWorker = {
        ...mockWorker,
        spawnargs: ['node', '/path/to/TestWorker.ts'],
      };
      supervisor['workers'] = [availableWorker as ChildProcess];

      supervisor['resendPendingMessages']('TestWorker');

      expect(availableWorker.send).toHaveBeenCalledWith(pendingMessage);
      expect(mockLog).toHaveBeenCalledWith(
        `[Supervisor] Resending 1 pending messages to new worker: TestWorker`,
        'info'
      );
    });
  });

  describe('Worker Health and Lifecycle', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks();
    });

    it('should detect alive worker', () => {
      const worker = {
        exitCode: null,
        killed: false,
      } as ChildProcess;

      expect(supervisor['isWorkerAlive'](worker)).toBe(true);
    });

    it('should detect dead worker with exit code', () => {
      const worker = {
        exitCode: 1,
        killed: false,
      } as ChildProcess;

      expect(supervisor['isWorkerAlive'](worker)).toBe(false);
    });

    it('should detect killed worker', () => {
      const worker = {
        exitCode: null,
        killed: true,
      } as ChildProcess;

      expect(supervisor['isWorkerAlive'](worker)).toBe(false);
    });

    it('should handle null worker', () => {
      const result = supervisor['isWorkerAlive'](null as any);
      // isWorkerAlive returns a truthy/falsy value, not strictly boolean
      expect(!!result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      supervisor = new Supervisor();
      jest.clearAllMocks();
    });

    it('should handle worker errors', () => {
      const error = new Error('Test worker error');

      supervisor.handleWorkerError(error);

      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] Worker error: Test worker error',
        'error'
      );
    });

    it('should handle message to dead worker', () => {
      const message: Message = {
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['DeadWorker'],
        data: {},
      };

      // Create a worker that looks alive in initial filter but will be dead when checked later
      const deadWorker = {
        ...mockWorker,
        exitCode: null, // Initially looks alive
        killed: false,
        spawnargs: ['node', '/path/to/DeadWorker.ts'],
      };
      supervisor['workers'] = [deadWorker as ChildProcess];

      // Mock execSync to simulate the worker in a non-running state
      mockExecSync.mockReturnValueOnce(Buffer.from('S')); // Sleeping state, not running

      // Mock isWorkerAlive to return false when called on targetWorker
      const originalIsWorkerAlive = supervisor['isWorkerAlive'];
      supervisor['isWorkerAlive'] = jest.fn()
        .mockReturnValueOnce(true)  // First call in filter
        .mockReturnValueOnce(false); // Second call when checking targetWorker

      supervisor.handleSendMessageWorker(12345, message);

      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] Tried to send message to dead worker!',
        'error'
      );

      // Restore original method
      supervisor['isWorkerAlive'] = originalIsWorkerAlive;
    });

    it('should handle resend to unavailable worker', () => {
      supervisor['pendingMessages']['UnavailableWorker'] = [{
        messageId: 'msg-1',
        status: 'completed',
        reason: '',
        destination: ['UnavailableWorker'],
        data: {},
        timestamp: Date.now(),
      }];

      // No workers available
      supervisor['workers'] = [];

      supervisor['resendPendingMessages']('UnavailableWorker');

      expect(mockLog).toHaveBeenCalledWith(
        '[Supervisor] No available (alive) worker to resend messages for: UnavailableWorker',
        'warn'
      );
    });
  });
});