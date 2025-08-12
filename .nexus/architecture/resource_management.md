# Architecture: Resource Management

## Context

MCP servers often need to interact with external services (databases, APIs, SDKs) that require managing client instances or connection pools. Creating a new client/connection for every request is inefficient and can exhaust resources. This template provides a `ResourceManager` class to address this.

-   **Related:** [System Overview](system_overview.md), [Token Handling](token_handling.md)

## Goal

Provide a centralized, efficient, and robust mechanism for managing the lifecycle of external resource instances (e.g., SDK clients, database connection pools) within the MCP server.

**Key Objectives:**

1.  **Reuse:** Avoid redundant creation of resource instances by caching them based on an identifier (typically an API key or connection configuration).
2.  **Lazy Initialization:** Create resource instances only when they are first needed for a specific key.
3.  **Automatic Cleanup:** Automatically destroy and remove resource instances that have been inactive for a configurable period to conserve system resources (memory, connections).
4.  **Graceful Shutdown:** Ensure all managed resources are properly cleaned up when the server shuts down.
5.  **Extensibility:** Allow easy integration of different types of resources by providing factory and cleanup logic.

## Implementation (`src/resource-manager.ts`)

The `ResourceManager` class (`src/resource-manager.ts`) implements this pattern.

```typescript
// Simplified interface
class ResourceManager {
  // Stores ResourceInfo<T> objects keyed by a cache key (e.g., apiKey)
  private resources: Map<string, ResourceInfo<any>>;
  private cleanupIntervalMs: number;
  private cleanupTimer: NodeJS.Timeout | null;

  constructor(options?: { cleanupIntervalMs?: number });

  // Core method to get/create resources
  public async getResource<T>(
    key: string, // Cache key (e.g., apiKey)
    resourceType: string, // Identifier for the type (e.g., 's3', 'postgres_pool')
    factoryFn: (key: string) => Promise<T>, // How to create the resource
    cleanupFn: (resource: T) => Promise<void> // How to destroy the resource
  ): Promise<T>;

  // Internal methods for cleanup timer and process
  private startCleanupTimer(): void;
  public stopCleanupTimer(): void;
  private async cleanupInactiveResources(): Promise<void>;

  // Method for immediate cleanup on shutdown
  public async destroyAllNow(): Promise<void>;
}

// Singleton instance is exported
export const resourceManager = new ResourceManager();
```

## How to Use

1.  **Identify Managed Resources:** Determine which external interactions require persistent clients or connections (e.g., `new S3Client()`, `new Pool()`).
2.  **Import `resourceManager`:** Import the singleton instance in your tool implementation file (`src/index.ts` or other modules).
3.  **Call `getResource`:** Within your tool's `execute` function, call `resourceManager.getResource<ResourceType>(...)`.
    *   **`key`:** Provide a unique string to identify the resource instance. This is crucial for caching and reuse. Often, this will be the `apiKey` resolved from `extraArgs` or the environment fallback, ensuring users with different keys get different resource instances. For shared resources (like a DB pool using env vars), use a constant string or a hash of the connection config.
    *   **`resourceType`:** A simple string name for this *kind* of resource (e.g., `'s3'`, `'postgres_pool'`, `'my_api_client'`). Used mainly for logging.
    *   **`factoryFn`:** An `async` function that takes the `key` and returns a `Promise` resolving to a *new* instance of your resource (e.g., `async (key) => new S3Client({...})`). This is where you configure the client/connection, potentially using the `key` or environment variables for credentials. **Do not hardcode secrets here.**
    *   **`cleanupFn`:** An `async` function that takes an instance of your resource and performs the necessary cleanup (e.g., `async (pool) => await pool.end()`, `async (client) => client.destroy()`). If no explicit cleanup is needed (rare), provide an empty async function: `async () => {}`.

## Example Usage (Inside a Tool's `execute` function)

```typescript
import { resourceManager } from './resource-manager.js';
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3"; // Example SDK
import { config, apiKeyErrorMessage } from './config.js';
import { UserError } from '@missionsquad/fastmcp';

// ... inside async execute(args, context) ...

// 1. Resolve the API key (using the standard pattern)
const { apiKey: extraArgsApiKey } = context.extraArgs as { apiKey?: string } || {};
let apiKey = extraArgsApiKey || config.apiKey;
if (!apiKey) {
  throw new UserError(apiKeyErrorMessage); // Assuming this tool requires auth
}

try {
  // 2. Get or create the resource instance
  const s3Client = await resourceManager.getResource<S3Client>(
    apiKey, // Use the resolved API key as the cache key
    's3',   // Type identifier for logging
    async (key) => {
      // 3. Factory Function (How to CREATE)
      logger.info(`Creating new S3 client for key ending ...${key.slice(-4)}`);
      // Adapt credential handling based on your needs and the structure of 'key'
      return new S3Client({
        region: args.region || process.env.AWS_REGION || 'us-east-1',
        // credentials: { accessKeyId: key, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } // Example - Adapt!
      });
    },
    async (client) => {
      // 4. Cleanup Function (How to DESTROY)
      logger.info(`Destroying S3 client (Instance ID: ${/* How to get instance ID if needed? Maybe pass it to cleanup? */''})`);
      // S3Client v3 doesn't need explicit destroy. For others:
      // await client.close(); // or client.end(); etc.
    }
  );

  // 5. Use the resource
  const command = new ListBucketsCommand({});
  const response = await s3Client.send(command);
  // ... process response ...
  return JSON.stringify(response.Buckets);

} catch (error: any) {
  logger.error(`Tool failed: ${error.message}`, error);
  throw new UserError(`Failed to interact with service: ${error.message}`);
}
```

## Configuration

The cleanup interval is configured via the `RESOURCE_CLEANUP_INTERVAL` environment variable (see `.env.example`).

## Considerations

*   **Cache Key Selection:** Choose the `key` carefully. It determines resource reuse. Using the user's `apiKey` isolates resources per user. Using a fixed key or config hash creates a shared resource.
*   **Resource Cleanup:** Ensure the `cleanupFn` correctly and completely terminates the resource to prevent leaks.
*   **Error Handling:** The `factoryFn` should handle errors during resource creation. `getResource` will propagate these errors.
*   **Concurrency:** The `ResourceManager` itself is synchronous in accessing the map, but the `factoryFn` and `cleanupFn` are async. Be mindful of potential race conditions if multiple requests trigger resource creation for the *same new key* simultaneously (though `getResource` handles basic locking for creation).
*   **Stateful Resources:** Be cautious managing resources that hold significant state tied to a specific user session if the cache key is shared.

## AI Assistance Notes

-   Model Used: (Specify Model)
-   Prompt: (Specify Prompt)
-   Date Generated: (Specify Date)

## Related Nexus Documents

-   [System Overview](system_overview.md)
-   [Token Handling](token_handling.md)
-   [Adding Tools Guide](../guides/adding_tools.md)
