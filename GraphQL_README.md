# GraphQL Federation Worker Implementation

This document describes the GraphQL Federation Worker implementation that provides a GraphQL Federation subgraph alongside the existing REST API.

## Overview

The GraphQL Federation Worker follows the same microservices pattern as other workers in the system and now operates as a **GraphQL Federation subgraph**:
- Runs as a separate process managed by the Supervisor
- Communicates with DatabaseInteractionWorker for all database operations
- Provides JWT authentication compatibility with the REST API
- Runs on a configurable port (default: 4001)
- **NEW**: Functions as a GraphQL Federation subgraph that can be composed into a federated graph

## Federation Architecture

The service now implements GraphQL Federation v2.0 specification:
- Uses `@apollo/subgraph` to build federated schema
- Includes federation directives (`@key`, `@shareable`, etc.)
- Supports entity resolution for distributed queries
- Can be composed with other subgraphs using Apollo Gateway or Router

## Schema

The GraphQL schema implements federation directives and the exact specification provided:

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

scalar DateTime

type ProjectStatus @shareable {
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
```

## Federation Features

### Entity Support
- **Project** type is marked as an entity with `@key(fields: "_id")`
- Supports entity resolution for distributed queries across subgraphs
- Other subgraphs can extend the Project type with additional fields

### Shareable Types
- **ProjectStatus** type is marked as `@shareable`
- Multiple subgraphs can define the same shareable type

### Entity Resolution
- Implements `__resolveReference` resolver for Project entities
- Allows federation gateway to resolve Project references from other subgraphs

## Usage Examples

### 1. Get All Projects (with pagination)

```graphql
query GetAllProjects {
  getAllProjects(page: 1, limit: 10) {
    projects {
      _id
      title
      description
      keyword
      topic_category
      language
      start_date_crawl
      end_date_crawl
      project_status {
        topic_modelling
        sentiment
        emotion
        sna
      }
    }
    total
    page
    limit
  }
}
```

**Headers Required:**
```
Authorization: Bearer <your-jwt-token>
Content-Type: application/json
```

### 2. Get Project by ID

```graphql
query GetProject($id: String!) {
  getProjectById(id: $id) {
    _id
    title
    description
    keyword
    userId
    topic_category
    language
    start_date_crawl
    end_date_crawl
    project_status {
      topic_modelling
      sentiment
      emotion
      sna
    }
  }
}
```

**Variables:**
```json
{
  "id": "60c72b2f9b1e8b5f3c8d4e1f"
}
```

### 3. Create New Project

```graphql
mutation CreateProject($input: CreateProjectInput!) {
  createProject(input: $input) {
    _id
    title
    description
    keyword
    topic_category
    language
    start_date_crawl
    end_date_crawl
    project_status {
      topic_modelling
      sentiment
      emotion
      sna
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "title": "My New Project",
    "description": "A sample project for testing",
    "keyword": "test,sample,project",
    "category": "research",
    "language": "en",
    "start_date_crawl": "2024-01-01T00:00:00Z",
    "end_date_crawl": "2024-01-31T23:59:59Z",
    "tweetToken": "optional-tweet-token"
  }
}
```

**Headers Required:**
```
Authorization: Bearer <your-jwt-token>
Content-Type: application/json
```

## Configuration

Add these environment variables to your `.env` file:

```env
GRAPHQL_PORT=4001  # Port for GraphQL Federation subgraph (optional, defaults to 4001)
JWT_SECRET=your-secret-key  # Same JWT secret used by REST API
```

## Federation Gateway Setup

To use this subgraph in a federated architecture, you need an Apollo Gateway or Router:

### Apollo Gateway Example
```javascript
const { ApolloGateway } = require('@apollo/gateway');
const { ApolloServer } = require('@apollo/server');

const gateway = new ApolloGateway({
  serviceList: [
    { name: 'projects', url: 'http://localhost:4001/graphql' },
    // Add other subgraphs here
  ],
});

const server = new ApolloServer({
  gateway,
  subscriptions: false,
});
```

### Apollo Router Config (router.yaml)
```yaml
endpoints:
  - url: http://localhost:4001/graphql
    subgraph: projects
```

## Architecture

```
Federation Gateway/Router
        ↓
GraphQL Federation Subgraph → Supervisor → DatabaseInteractionWorker → MongoDB
        ↓
  JWT Authentication
        ↓
  Message Queue System
        ↓
  Response via Event Emitter
```

## Features Implemented

✅ **Federation v2.0**: Built with Apollo Federation v2.0 specification
✅ **Entity Support**: Project type can be referenced and extended by other subgraphs
✅ **Authentication**: JWT token validation (same as REST API)
✅ **Pagination**: Support for page/limit parameters in getAllProjects
✅ **Search**: Support for name parameter to filter projects by title
✅ **Type Safety**: Full TypeScript implementation with proper types
✅ **DateTime Handling**: Custom scalar for proper date serialization
✅ **Error Handling**: Proper GraphQL error responses
✅ **Integration**: Seamless communication with existing database worker
✅ **Shareable Types**: ProjectStatus type marked as shareable for composition

## Testing

The implementation includes comprehensive tests:

```bash
npm test -- GraphQLWorker.test.ts
```

## Limitations

- **Subscriptions**: Currently throws an error (not yet implemented)
- **Real-time Updates**: Subscription support requires WebSocket implementation
- **Advanced Filtering**: Only basic name search is implemented

## Future Enhancements

1. **WebSocket Support**: Implement proper subscription support with graphql-ws
2. **Advanced Filtering**: Add more search and filter options
3. **Caching**: Add Redis caching for frequently accessed data
4. **Rate Limiting**: Implement query complexity analysis and rate limiting
5. **File Uploads**: Support for file upload mutations if needed

## Server Information

- **GraphQL Federation Subgraph Endpoint**: `http://localhost:4001/graphql`
- **Federation SDL**: Available at the endpoint for schema composition
- **Health Check**: Worker sends health checks every 10 seconds to supervisor
- **Introspection**: Available in development mode

## Federation Benefits

1. **Distributed Architecture**: Each domain can have its own subgraph
2. **Schema Composition**: Multiple teams can work on different parts of the schema
3. **Entity Resolution**: Projects can be referenced and extended across subgraphs
4. **Type Sharing**: Shareable types can be reused across the federation
5. **Independent Deployment**: Subgraphs can be deployed independently

## Migration from Standalone GraphQL

The migration to federation maintains backward compatibility:
- All existing queries, mutations work exactly the same
- Authentication remains unchanged
- API endpoints and functionality preserved
- Added federation capabilities for future expansion

## Testing Federation

```bash
npm test -- --testPathPatterns=GraphQLFederation
```

This runs federation-specific tests that validate:
- Schema builds correctly with federation directives
- Entity resolvers work properly
- Federation composition compatibility