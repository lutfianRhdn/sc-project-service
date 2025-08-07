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
}

export const createResolvers = (workerInstance: GraphQLWorkerInstance) => ({
  DateTime: DateTimeType,

  Query: {
    getAllProjects: async (
      _: any,
      args: { page?: number; limit?: number; name?: string },
      context: { authorization?: string }
    ) => {
      if (!context.authorization) {
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
        return {
          projects: [],
          total: 0,
          page,
          limit,
        };
      }

      return {
        projects: result.projects || [],
        total: result.total || 0,
        page,
        limit,
      };
    },

    getProjectById: async (
      _: any,
      args: { id: string },
      context: { authorization?: string }
    ) => {
      const result = await workerInstance.sendMessageToOtherWorker({}, [
        `DatabaseInteractionWorker/getDataById/${args.id}`,
      ]);

      if (!result) {
        throw new Error('Project not found');
      }

      return result;
    },
  },

  Mutation: {
    createProject: async (
      _: any,
      args: { input: any },
      context: { authorization?: string }
    ) => {
      if (!context.authorization) {
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
        throw new Error('Failed to create project');
      }

      return result;
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

  // Federation entity resolver for Project
  Project: {
    __resolveReference: async (project: { _id: string }) => {
      // This resolver allows the federation gateway to resolve Project entities by their key field (_id)
      const result = await workerInstance.sendMessageToOtherWorker({}, [
        `DatabaseInteractionWorker/getDataById/${project._id}`,
      ]);

      if (!result) {
        return null;
      }

      return result;
    },
  },
});