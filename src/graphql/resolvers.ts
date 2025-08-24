import { GraphQLScalarType, Kind } from 'graphql';

// DateTime scalar type
const DateTimeType = new GraphQLScalarType({
  name: 'DateTime',
  description: 'Date custom scalar type',
  serialize(value: any) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return new Date(value).toISOString();
    }
    throw new Error('Value is not a valid DateTime: ' + value);
  },
  parseValue(value: any) {
    if (typeof value === 'string') {
      return new Date(value);
    }
    throw new Error('Value is not a valid DateTime string: ' + value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    throw new Error('Can only parse strings to DateTime but got a: ' + ast.kind);
  },
});

export interface GraphQLWorkerInstance {
  sendMessageToOtherWorker(data: any, destination: string[]): Promise<any>;
  getuserId(authorization: string): Promise<string>;
  requestCounter: {
    incrementTotal(): void;
    incrementSuccessful(): void;
    incrementFailed(): void;
  };
}

export const createResolvers = (workerInstance: GraphQLWorkerInstance) => ({
  DateTime: DateTimeType,

  Project: {
    __resolveReference: async (reference: { _id: string }) => {
      // This resolver is called when another subgraph needs to resolve a Project by its key
      workerInstance.requestCounter.incrementTotal();
      try {
        const result = await workerInstance.sendMessageToOtherWorker({}, [
          `DatabaseInteractionWorker/getDataById/${reference._id}`,
        ]);

        if (!result) {
          workerInstance.requestCounter.incrementFailed();
          return null;
        }

        workerInstance.requestCounter.incrementSuccessful();
        return result;
      } catch (error) {
        workerInstance.requestCounter.incrementFailed();
        throw error;
      }
    },
  },

  Query: {
    getAllProjects: async (
      _: any,
      args: { page?: number; limit?: number; name?: string },
      context: { authorization?: string }
    ) => {
      workerInstance.requestCounter.incrementTotal();
      try {
        if (!context.authorization) {
          workerInstance.requestCounter.incrementFailed();
          throw new Error('Unauthorized');
        }

        const userId = await workerInstance.getuserId(context.authorization);
        const { page = 1, limit = 10, name } = args;

        // Send message to DatabaseInteractionWorker for paginated results
        const result = await workerInstance.sendMessageToOtherWorker(
          { userId, page, limit, name },
          [`DatabaseInteractionWorker/getAllDataPaginated`]
        );

        if (!result) {
          workerInstance.requestCounter.incrementSuccessful();
          return {
            projects: [],
            total: 0,
            page,
            limit,
          };
        }

        workerInstance.requestCounter.incrementSuccessful();
        return {
          projects: result.projects || [],
          total: result.total || 0,
          page,
          limit,
        };
      } catch (error) {
        workerInstance.requestCounter.incrementFailed();
        throw error;
      }
    },

    getProjectById: async (
      _: any,
      args: { id: string },
      context: { authorization?: string }
    ) => {
      workerInstance.requestCounter.incrementTotal();
      try {
        const result = await workerInstance.sendMessageToOtherWorker({}, [
          `DatabaseInteractionWorker/getDataById/${args.id}`,
        ]);

        if (!result) {
          workerInstance.requestCounter.incrementFailed();
          throw new Error('Project not found');
        }

        workerInstance.requestCounter.incrementSuccessful();
        return result;
      } catch (error) {
        workerInstance.requestCounter.incrementFailed();
        throw error;
      }
    },
  },

  Mutation: {
    createProject: async (
      _: any,
      args: { input: any },
      context: { authorization?: string }
    ) => {
      workerInstance.requestCounter.incrementTotal();
      try {
        if (!context.authorization) {
          workerInstance.requestCounter.incrementFailed();
          throw new Error('Unauthorized');
        }

        const userId = await workerInstance.getuserId(context.authorization);
        const { input } = args;

        const projectData = {
          title: input.title,
          description: input.description,
          keyword: input.keyword,
          language: input.language,
          tweetToken: input.tweetToken,
          topic_category: input.category,
          start_date_crawl: new Date(input.start_date_crawl),
          end_date_crawl: new Date(input.end_date_crawl),
          userId: userId as string,
        };

        const result = await workerInstance.sendMessageToOtherWorker(
          projectData,
          [`DatabaseInteractionWorker/createNewData`]
        );

        if (!result) {
          workerInstance.requestCounter.incrementFailed();
          throw new Error('Failed to create project');
        }

        workerInstance.requestCounter.incrementSuccessful();
        return result;
      } catch (error) {
        workerInstance.requestCounter.incrementFailed();
        throw error;
      }
    },
  },

  Subscription: {
    subsProjectById: {
      subscribe: () => {
        // Simplified subscription - will implement properly later with WebSocket support
        throw new Error('Subscriptions not yet implemented');
      },
    },
  },
});