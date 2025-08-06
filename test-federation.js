"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const subgraph_1 = require("@apollo/subgraph");
const graphql_tag_1 = require("graphql-tag");
const typeDefs = (0, graphql_tag_1.gql) `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

  scalar DateTime

  type Project @key(fields: "_id") {
    _id: ID!
    title: String!
  }

  type Query {
    getProjectById(id: String!): Project!
  }
`;
const resolvers = {
    Query: {
        getProjectById: () => ({ _id: '1', title: 'Test' }),
    },
    Project: {
        __resolveReference: (project) => ({ ...project, title: 'Test' }),
    },
};
try {
    const schema = (0, subgraph_1.buildSubgraphSchema)({
        typeDefs,
        resolvers,
    });
    console.log('✅ GraphQL Federation subgraph schema built successfully!');
}
catch (error) {
    console.error('❌ Failed to build federation schema:', error);
    process.exit(1);
}
