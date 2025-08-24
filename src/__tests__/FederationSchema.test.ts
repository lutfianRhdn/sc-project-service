import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';
import { typeDefs } from '../graphql/schema';
import { createResolvers } from '../graphql/resolvers';

describe('Federation Schema', () => {
  it('should build a valid federation subgraph schema', () => {
    const mockWorkerInstance = {
      sendMessageToOtherWorker: jest.fn().mockResolvedValue({}),
      getuserId: jest.fn().mockResolvedValue('test-user-id'),
      requestCounter: {
        incrementTotal: jest.fn(),
        incrementSuccessful: jest.fn(),
        incrementFailed: jest.fn(),
      },
    };

    const resolvers = createResolvers(mockWorkerInstance);

    expect(() => {
      const schema = buildSubgraphSchema({
        typeDefs: gql(typeDefs),
        resolvers,
      });
      expect(schema).toBeDefined();
    }).not.toThrow();
  });

  it('should include federation directives in schema', () => {
    expect(typeDefs).toContain('@link(url: "https://specs.apollo.dev/federation/v2.0"');
    expect(typeDefs).toContain('@key(fields: "_id")');
  });

  it('should include reference resolver for Project entity', () => {
    const mockWorkerInstance = {
      sendMessageToOtherWorker: jest.fn().mockResolvedValue({ _id: 'test-id', title: 'Test Project' }),
      getuserId: jest.fn().mockResolvedValue('test-user-id'),
      requestCounter: {
        incrementTotal: jest.fn(),
        incrementSuccessful: jest.fn(),
        incrementFailed: jest.fn(),
      },
    };

    const resolvers = createResolvers(mockWorkerInstance);
    
    expect(resolvers.Project).toBeDefined();
    expect(resolvers.Project.__resolveReference).toBeDefined();
    expect(typeof resolvers.Project.__resolveReference).toBe('function');
  });

  it('should resolve Project reference correctly', async () => {
    const mockWorkerInstance = {
      sendMessageToOtherWorker: jest.fn().mockResolvedValue({ _id: 'test-id', title: 'Test Project' }),
      getuserId: jest.fn().mockResolvedValue('test-user-id'),
      requestCounter: {
        incrementTotal: jest.fn(),
        incrementSuccessful: jest.fn(),
        incrementFailed: jest.fn(),
      },
    };

    const resolvers = createResolvers(mockWorkerInstance);
    
    const result = await resolvers.Project.__resolveReference({ _id: 'test-id' });
    
    expect(mockWorkerInstance.sendMessageToOtherWorker).toHaveBeenCalledWith(
      {},
      ['DatabaseInteractionWorker/getDataById/test-id']
    );
    expect(result).toEqual({ _id: 'test-id', title: 'Test Project' });
  });
});