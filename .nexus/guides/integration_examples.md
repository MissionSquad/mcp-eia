# Guide: Integration Examples

## Context

This guide provides conceptual examples of how to integrate different types of external services (SDKs, APIs, Databases) into MCP tools using this template's patterns, particularly focusing on authentication and resource management.

-   **Related:** [System Overview](../architecture/system_overview.md), [Token Handling](../architecture/token_handling.md), [Resource Management](../architecture/resource_management.md), [Adding Tools Guide](./adding_tools.md)

## Goal

Illustrate practical application of the template's architecture for common integration scenarios. These are *examples* and need adaptation for specific services and security requirements.

---

## Example 1: AWS SDK (S3 List Buckets)

**Scenario:** Create a tool to list S3 buckets using the AWS SDK for JavaScript v3. Authentication should use AWS credentials (Access Key ID & Secret Access Key).

**Assumptions:**

*   The `apiKey` passed via `extraArgs` or `config.apiKey` represents the AWS Access Key ID.
*   The corresponding AWS Secret Access Key is stored securely as an environment variable (e.g., `AWS_SECRET_ACCESS_KEY`). **Never pass secrets directly in `extraArgs` or commit them.**
*   The AWS region can be specified as a tool parameter or default via environment variable (`AWS_REGION`).

**Steps:**

1.  **Install SDK:** `npm install @aws-sdk/client-s3`
2.  **Define Schema (`src/index.ts`):**
    ```typescript
    import { z } from 'zod';
    const ListS3BucketsSchema = z.object({
      region: z.string().optional().describe('Optional AWS region (e.g., us-west-2). Defaults to environment setting or us-east-1.'),
    });
    ```
3.  **Implement Tool (`src/index.ts`):**
    ```typescript
    import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
    import { resourceManager } from './resource-manager.js';
    import { config, apiKeyErrorMessage } from './config.js';
    import { UserError } from '@missionsquad/fastmcp';
    import { logger } from './logger.js';

    server.addTool({
      name: "list_s3_buckets",
      description: "Lists S3 buckets accessible with the configured/provided AWS credentials.",
      parameters: ListS3BucketsSchema,
      execute: async (args, context) => {
        logger.info(`Executing 'list_s3_buckets'...`);

        // --- Authentication ---
        const { apiKey: accessKeyId } = context.extraArgs as { apiKey?: string } || {}; // apiKey = Access Key ID
        const resolvedAccessKeyId = accessKeyId || config.apiKey;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY; // Get secret from env

        if (!resolvedAccessKeyId || !secretAccessKey) {
          logger.error('AWS credentials missing (Access Key ID or Secret Access Key).');
          throw new UserError("AWS credentials are not configured correctly.");
        }
        // Use Access Key ID as the cache key for the resource manager
        const resourceKey = resolvedAccessKeyId;

        try {
          // --- Resource Management ---
          const s3Client = await resourceManager.getResource<S3Client>(
            resourceKey,
            's3',
            async (key) => { // Factory Function
              logger.info(`Creating new S3 client for Access Key ID ending ...${key.slice(-4)}`);
              return new S3Client({
                region: args.region || process.env.AWS_REGION || 'us-east-1',
                credentials: {
                  accessKeyId: key, // The resolved Access Key ID
                  secretAccessKey: secretAccessKey, // The secret from env
                },
              });
            },
            async (client) => { // Cleanup Function
              logger.debug(`Destroying S3 client (no-op for v3)`);
              // No explicit destroy needed for S3Client v3
            }
          );

          // --- Core Logic ---
          const command = new ListBucketsCommand({});
          const response = await s3Client.send(command);
          const bucketNames = response.Buckets?.map(b => b.Name) || [];

          logger.info(`Found ${bucketNames.length} S3 buckets.`);
          return JSON.stringify({ buckets: bucketNames });

        } catch (error: any) {
          logger.error(`'list_s3_buckets' failed: ${error.message}`, error);
          throw new UserError(`Failed to list S3 buckets: ${error.name} - ${error.message}`);
        }
      },
    });
    ```
4.  **Configure Environment (`.env`):**
    ```env
    # Used as fallback if extraArgs.apiKey (Access Key ID) isn't provided
    API_KEY=YOUR_AWS_ACCESS_KEY_ID_FALLBACK
    # Required if using the above fallback or extraArgs
    AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
    # Optional default region
    AWS_REGION=us-east-1
    ```

---

## Example 2: REST API (Generic GET Request)

**Scenario:** Create a tool to make a GET request to an arbitrary REST API, using a Bearer token for authentication.

**Assumptions:**

*   The `apiKey` passed via `extraArgs` or `config.apiKey` represents the Bearer token.
*   The tool accepts the URL as a parameter.

**Steps:**

1.  **Install HTTP Client (Optional):** `npm install axios` (or use native `fetch`)
2.  **Define Schema (`src/index.ts`):**
    ```typescript
    import { z } from 'zod';
    const CallApiGetSchema = z.object({
      url: z.string().url().describe('The full URL of the API endpoint to call.'),
      headers: z.record(z.string()).optional().describe('Optional custom request headers (Authorization header will be added automatically).'),
    });
    ```
3.  **Implement Tool (`src/index.ts`):**
    ```typescript
    // import axios from 'axios'; // Or use fetch
    import { config, apiKeyErrorMessage } from './config.js';
    import { UserError } from '@missionsquad/fastmcp';
    import { logger } from './logger.js';

    server.addTool({
      name: "call_api_get",
      description: "Makes a GET request to the specified URL using the configured/provided Bearer token.",
      parameters: CallApiGetSchema,
      execute: async (args, context) => {
        logger.info(`Executing 'call_api_get' for URL: ${args.url}`);

        // --- Authentication ---
        const { apiKey: bearerToken } = context.extraArgs as { apiKey?: string } || {}; // apiKey = Bearer Token
        const resolvedBearerToken = bearerToken || config.apiKey;

        if (!resolvedBearerToken) {
          logger.error('API Bearer token missing.');
          throw new UserError(apiKeyErrorMessage);
        }

        // --- Core Logic ---
        try {
          const requestHeaders: Record<string, string> = {
            ...args.headers, // Include optional custom headers
            'Authorization': `Bearer ${resolvedBearerToken}`, // Add Bearer token
            'Accept': 'application/json', // Example default header
          };

          // Using native fetch:
          const response = await fetch(args.url, {
            method: 'GET',
            headers: requestHeaders,
          });

          const responseBody = await response.text(); // Read body as text first

          if (!response.ok) {
            logger.error(`API call failed with status ${response.status}: ${responseBody}`);
            throw new UserError(`API request failed with status ${response.status}. Body: ${responseBody.substring(0, 200)}`);
          }

          logger.info(`'call_api_get' completed successfully for URL: ${args.url}`);
          // Attempt to parse as JSON, but return text if it fails
          try {
            return JSON.stringify(JSON.parse(responseBody));
          } catch {
            return responseBody; // Return as plain text if not valid JSON
          }

          // Using Axios (alternative):
          // const response = await axios.get(args.url, { headers: requestHeaders });
          // logger.info(`'call_api_get' completed successfully for URL: ${args.url}`);
          // return JSON.stringify(response.data);

        } catch (error: any) {
          logger.error(`'call_api_get' failed for URL ${args.url}: ${error.message}`, error);
          if (error instanceof UserError) throw error;
          throw new UserError(`Failed to call API at ${args.url}: ${error.message}`);
        }
      },
    });
    ```
4.  **Configure Environment (`.env`):**
    ```env
    # Used as fallback if extraArgs.apiKey (Bearer Token) isn't provided
    API_KEY=YOUR_API_BEARER_TOKEN_FALLBACK
    ```

---

## Example 3: Database (PostgreSQL Query)

**Scenario:** Create a tool to execute a read-only (SELECT) query against a PostgreSQL database.

**Assumptions:**

*   Database connection details (host, port, database name) are configured via environment variables.
*   Authentication uses username/password. The `apiKey` from `extraArgs` or `config.apiKey` represents the database *username*.
*   The corresponding password is set via a separate environment variable (e.g., `DB_PASSWORD`).

**Steps:**

1.  **Install DB Driver:** `npm install pg @types/pg`
2.  **Define Schema (`src/index.ts`):**
    ```typescript
    import { z } from 'zod';
    const QueryDatabaseSchema = z.object({
      query: z.string().describe('The SELECT SQL query to execute.'),
      // Consider adding parameters for parameterized queries for security
      // params: z.array(z.any()).optional().describe('Parameters for the query.'),
    });
    ```
3.  **Implement Tool (`src/index.ts`):**
    ```typescript
    import { Pool, PoolClient } from 'pg';
    import { resourceManager } from './resource-manager.js';
    import { config, apiKeyErrorMessage } from './config.js';
    import { UserError } from '@missionsquad/fastmcp';
    import { logger } from './logger.js';

    server.addTool({
      name: "query_database",
      description: "Executes a read-only SELECT SQL query against the configured PostgreSQL database.",
      parameters: QueryDatabaseSchema,
      execute: async (args, context) => {
        logger.info(`Executing 'query_database'...`);

        // Basic security check (improve with parsing or allowlisting if needed)
        if (!args.query.trim().toUpperCase().startsWith('SELECT')) {
          throw new UserError("Invalid query: Only SELECT statements are allowed.");
        }

        // --- Authentication ---
        const { apiKey: dbUsername } = context.extraArgs as { apiKey?: string } || {}; // apiKey = DB Username
        const resolvedDbUsername = dbUsername || config.apiKey || process.env.DB_USER;
        const dbPassword = process.env.DB_PASSWORD;

        if (!resolvedDbUsername || !dbPassword) {
           logger.error('Database credentials missing (username or password).');
           throw new UserError("Database credentials are not configured correctly.");
        }

        // --- Resource Management (Connection Pool) ---
        // Use a key derived from connection details to potentially support multiple pools
        const poolKey = `pg_pool_${process.env.DB_HOST}_${process.env.DB_DATABASE}_${resolvedDbUsername}`;

        let client: PoolClient | null = null; // Define client outside try block
        try {
          const dbPool = await resourceManager.getResource<Pool>(
            poolKey,
            'postgres_pool',
            async (key) => { // Factory Function
              logger.info(`Creating new PostgreSQL pool for key: ${key}`);
              return new Pool({
                user: resolvedDbUsername,
                password: dbPassword,
                host: process.env.DB_HOST,
                database: process.env.DB_DATABASE,
                port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
                max: 10, // Example pool config
              });
            },
            async (pool) => { // Cleanup Function
              logger.info(`Closing PostgreSQL pool for key: ${poolKey}`);
              await pool.end();
            }
          );

          // --- Core Logic ---
          client = await dbPool.connect(); // Get client from pool
          logger.debug(`Executing query: ${args.query}`);
          // Add parameter handling here if using parameterized queries
          const result = await client.query(args.query);

          logger.info(`Query executed successfully. Rows returned: ${result.rowCount}`);
          return JSON.stringify(result.rows);

        } catch (error: any) {
          logger.error(`'query_database' failed: ${error.message}`, error);
          throw new UserError(`Database query failed: ${error.message}`);
        } finally {
           if (client) {
             client.release(); // IMPORTANT: Release client back to the pool
             logger.debug('Database client released.');
           }
        }
      },
    });
    ```
4.  **Configure Environment (`.env`):**
    ```env
    # Used as fallback if extraArgs.apiKey (DB Username) isn't provided
    API_KEY=YOUR_DB_USERNAME_FALLBACK
    # Required if using the above fallback or extraArgs
    DB_PASSWORD=YOUR_DB_PASSWORD
    # Required connection details
    DB_HOST=localhost
    DB_PORT=5432
    DB_DATABASE=mydatabase
    DB_USER=fallback_user # Optional: Can be another fallback if API_KEY isn't set
    ```

---

These examples illustrate the core patterns. Remember to adapt them carefully based on the specific requirements, authentication methods, and error handling needs of the service you are integrating. Always prioritize security, especially when handling credentials and executing external commands or queries.
