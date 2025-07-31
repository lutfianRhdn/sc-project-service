// Test setup file
// Mock environment variables
process.env.DATABASE_URL = 'mongodb://localhost:27017';
process.env.DATABASE_NAME = 'test_db';
process.env.DATABASE_COLLECTION_NAME = 'test_collection';
process.env.RABBITMQ_URL = 'amqp://localhost:5672';
process.env.JWT_SECRET = 'test_secret';
process.env.PORT = '4000';

// Suppress console output during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};