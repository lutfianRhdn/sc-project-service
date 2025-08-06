# GraphQL Worker Implementation

This document describes the new GraphQL Worker implementation that provides a GraphQL API alongside the existing REST API.

## Overview

The GraphQL Worker follows the same microservices pattern as other workers in the system:
- Runs as a separate process managed by the Supervisor
- Communicates with DatabaseInteractionWorker for all database operations
- Provides JWT authentication compatibility with the REST API
- Runs on a configurable port (default: 4001)

## Schema

The GraphQL schema implements the exact specification provided:

```graphql
scalar DateTime

type ProjectStatus {
  topic_modelling: Boolean!
  sentiment: Boolean!
  emotion: Boolean!
  sna: Boolean!
}

type Project {
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
GRAPHQL_PORT=4001  # Port for GraphQL server (optional, defaults to 4001)
JWT_SECRET=your-secret-key  # Same JWT secret used by REST API
```

## Architecture

```
GraphQL Request → GraphQLWorker → Supervisor → DatabaseInteractionWorker → MongoDB
                      ↓
                JWT Authentication
                      ↓
                Message Queue System
                      ↓
                Response via Event Emitter
```

## Features Implemented

✅ **Authentication**: JWT token validation (same as REST API)
✅ **Pagination**: Support for page/limit parameters in getAllProjects
✅ **Search**: Support for name parameter to filter projects by title
✅ **Type Safety**: Full TypeScript implementation with proper types
✅ **DateTime Handling**: Custom scalar for proper date serialization
✅ **Error Handling**: Proper GraphQL error responses
✅ **Integration**: Seamless communication with existing database worker

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

- **GraphQL Endpoint**: `http://localhost:4001/graphql`
- **GraphQL Playground**: Available in development mode at the same endpoint
- **Health Check**: Worker sends health checks every 10 seconds to supervisor