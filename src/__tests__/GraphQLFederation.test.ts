import { GraphQLWorker } from '../workers/GraphQLWorker';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';
import { typeDefs } from '../graphql/schema';
import { createResolvers } from '../graphql/resolvers';

describe('GraphQL Federation Worker', () => {
  let worker: GraphQLWorker;
  
  beforeEach(() => {
    // Mock the worker methods we need
    worker = {
      sendMessageToOtherWorker: jest.fn().mockResolvedValue({ _id: '1', title: 'Test Project' }),
      getuserId: jest.fn().mockResolvedValue('user123'),
    } as any;
  });

  describe('Federation Schema', () => {
    it('should build a valid federation subgraph schema', () => {
      const resolvers = createResolvers(worker);
      
      expect(() => {
        const schema = buildSubgraphSchema({
          typeDefs: gql(typeDefs),
          resolvers,
        });
        return schema;
      }).not.toThrow();
    });

    it('should have federation directives in schema', () => {
      expect(typeDefs).toContain('@link(url: "https://specs.apollo.dev/federation/v2.0"');
      expect(typeDefs).toContain('@key(fields: "_id")');
      expect(typeDefs).toContain('@shareable');
    });

    it('should include entity resolver for Project', () => {
      const resolvers = createResolvers(worker);
      
      expect(resolvers.Project).toBeDefined();
      expect(resolvers.Project.__resolveReference).toBeDefined();
      expect(typeof resolvers.Project.__resolveReference).toBe('function');
    });

    it('should resolve Project entity by reference', async () => {
      const resolvers = createResolvers(worker);
      const result = await resolvers.Project.__resolveReference({ _id: 'test-id' });
      
      expect(worker.sendMessageToOtherWorker).toHaveBeenCalledWith({}, [
        'DatabaseInteractionWorker/getDataById/test-id',
      ]);
      expect(result).toEqual({ _id: '1', title: 'Test Project' });
    });
  });
});