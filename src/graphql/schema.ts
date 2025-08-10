export const typeDefs = `#graphql
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

  scalar DateTime

  type ProjectStatus {
    topic_modelling: Boolean!
    sentiment: Boolean!
    emotion: Boolean!
    sna: Boolean!
  }

  type Project @key(fields: "_id") {
    _id: ID!
    title: String!
    description: String!
    keyword: String!
    userId: String!
    topic_category: String!
    language: String!
    start_date_crawl: DateTime!
    end_date_crawl: DateTime!
    project_status: ProjectStatus!
  }

  type ProjectPaginatedResponse {
    projects: [Project!]!
    total: Int!
    page: Int!
    limit: Int!
  }

  type Query {
    getAllProjects(page: Int, limit: Int, name: String): ProjectPaginatedResponse!
    getProjectById(id: String!): Project!
  }

  type Mutation {
    createProject(input: CreateProjectInput!): Project!
  }

  input CreateProjectInput {
    title: String!
    description: String!
    keyword: String!
    category: String!
    language: String!
    start_date_crawl: DateTime!
    end_date_crawl: DateTime!
    tweetToken: String
  }

  type Subscription {
    subsProjectById(id: String!): Project!
  }
`;