import { v4 as uuidv4 } from 'uuid'
import { config } from './config.js'
import { logger } from './logger.js'

/**
 * Represents information about a managed resource.
 * @template T The type of the managed resource (e.g., SDK client, DB connection pool).
 */
interface ResourceInfo<T> {
  /** The actual resource instance (e.g., S3Client, Pool). */
  resource: T
  /** Timestamp (ms since epoch) when the resource was last accessed. */
  lastUsed: number
  /** A unique identifier for this specific instance of the resource. */
  instanceId: string
  /** The type identifier provided when the resource was created (e.g., 's3', 'postgres_pool'). */
  resourceType: string
  /** The key used to cache this resource (often an API key or connection identifier). */
  cacheKey: string
  /** Function provided during creation to clean up/destroy this specific resource. */
  cleanupFn: (resource: T) => Promise<void>
}

/**
 * Manages the lifecycle of external resources like SDK clients or database connections.
 *
 * Features:
 * - Caching: Reuses existing resource instances based on a provided key (e.g., API key).
 * - Lazy Initialization: Creates resources only when first requested.
 * - Automatic Cleanup: Periodically removes and destroys resources that haven't been used recently.
 * - Type Safety: Uses generics to manage different types of resources.
 * - Extensibility: Requires factory and cleanup functions to handle specific resource types.
 */
export class ResourceManager {
  /**
   * Stores the managed resources.
   * Key: The cache key provided when requesting the resource (e.g., API key).
   * Value: ResourceInfo object containing the resource and metadata.
   */
  private resources: Map<string, ResourceInfo<any>> = new Map()
  private readonly cleanupIntervalMs: number
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(options?: { cleanupIntervalMs?: number }) {
    this.cleanupIntervalMs =
      options?.cleanupIntervalMs ?? config.resourceCleanupInterval
    this.startCleanupTimer()
    logger.info(
      `ResourceManager initialized. Cleanup interval: ${this.cleanupIntervalMs}ms`,
    )
  }

  /**
   * Retrieves an existing resource or creates a new one if it doesn't exist for the given key.
   *
   * @template T The expected type of the resource.
   * @param key A unique key to identify and cache the resource (e.g., API key, connection string hash).
   * @param resourceType A string identifier for the *type* of resource being managed (e.g., 's3', 'postgres_pool'). Used for logging.
   * @param factoryFn An async function that takes the key and returns a new instance of the resource. Called only if the resource isn't cached.
   * @param cleanupFn An async function that takes a resource instance and performs necessary cleanup (e.g., closing connections, destroying clients).
   * @returns A promise resolving to the resource instance.
   * @throws If the factory function fails to create the resource.
   */
  public async getResource<T>(
    key: string,
    resourceType: string,
    factoryFn: (key: string) => Promise<T>,
    cleanupFn: (resource: T) => Promise<void>,
  ): Promise<T> {
    const existingInfo = this.resources.get(key)

    if (existingInfo) {
      logger.debug(
        `Reusing existing resource (Type: ${existingInfo.resourceType}, Instance ID: ${existingInfo.instanceId}) for key ending with ...${key.slice(-4)}`,
      )
      existingInfo.lastUsed = Date.now()
      // Ensure the type matches what the caller expects (runtime check)
      // This is a basic check; more robust checks might be needed depending on usage.
      if (existingInfo.resourceType !== resourceType) {
        logger.warn(
          `Resource type mismatch for key ${key}. Expected ${resourceType}, found ${existingInfo.resourceType}. Returning existing resource anyway.`,
        )
      }
      return existingInfo.resource as T
    }

    logger.info(
      `Creating new resource (Type: ${resourceType}) for key ending with ...${key.slice(-4)}`,
    )
    try {
      const newResource = await factoryFn(key)
      const instanceId = uuidv4()
      const newInfo: ResourceInfo<T> = {
        resource: newResource,
        lastUsed: Date.now(),
        instanceId: instanceId,
        resourceType: resourceType,
        cacheKey: key,
        cleanupFn: cleanupFn,
      }
      this.resources.set(key, newInfo)
      logger.info(
        `Successfully created resource (Type: ${resourceType}, Instance ID: ${instanceId})`,
      )
      return newResource
    } catch (error) {
      logger.error(
        `Failed to create resource (Type: ${resourceType}) for key ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
      throw new Error(
        `Resource factory function failed for type ${resourceType}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Starts the periodic cleanup process.
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
    this.cleanupTimer = setInterval(
      () => this.cleanupInactiveResources(),
      this.cleanupIntervalMs,
    )
    // Prevent the timer from keeping the Node.js process alive if it's the only thing running
    this.cleanupTimer.unref()
    logger.info('Resource cleanup timer started.')
  }

  /**
   * Stops the periodic cleanup process.
   */
  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
      logger.info('Resource cleanup timer stopped.')
    }
  }

  /**
   * Iterates through managed resources and cleans up those that have been inactive
   * for longer than the configured interval.
   */
  private async cleanupInactiveResources(): Promise<void> {
    const now = Date.now()
    let cleanedCount = 0
    logger.debug('Running inactive resource cleanup check...')

    // Create a list of keys to potentially remove to avoid modifying the map while iterating
    const keysToRemove: string[] = []
    for (const [key, info] of this.resources.entries()) {
      if (now - info.lastUsed > this.cleanupIntervalMs) {
        keysToRemove.push(key)
      }
    }

    if (keysToRemove.length === 0) {
      logger.debug('No inactive resources found to clean up.')
      return
    }

    logger.info(`Found ${keysToRemove.length} inactive resource(s) to clean up.`)

    for (const key of keysToRemove) {
      const info = this.resources.get(key)
      if (info && now - info.lastUsed > this.cleanupIntervalMs) {
        // Double-check inactivity before removing
        logger.info(
          `Cleaning up inactive resource (Type: ${info.resourceType}, Instance ID: ${info.instanceId}, Key: ...${key.slice(-4)})`,
        )
        try {
          await info.cleanupFn(info.resource)
          this.resources.delete(key)
          cleanedCount++
          logger.info(
            `Successfully cleaned up resource (Instance ID: ${info.instanceId})`,
          )
        } catch (error) {
          logger.error(
            `Error during cleanup of resource (Instance ID: ${info.instanceId}): ${error instanceof Error ? error.message : String(error)}`,
            error,
          )
          // Decide if you want to remove the resource from the map even if cleanup failed
          // this.resources.delete(key); // Optional: Remove even on cleanup failure
        }
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Finished cleanup. Removed ${cleanedCount} inactive resource(s).`)
    } else {
      logger.debug('Finished cleanup check, no resources were removed.')
    }
  }

  /**
   * Immediately destroys all managed resources and clears the cache.
   * Useful during application shutdown.
   */
  public async destroyAllNow(): Promise<void> {
    logger.warn('Destroying all managed resources immediately...')
    this.stopCleanupTimer() // Stop periodic cleanup first

    const cleanupPromises: Promise<void>[] = []
    for (const [key, info] of this.resources.entries()) {
      logger.info(
        `Initiating immediate cleanup for resource (Type: ${info.resourceType}, Instance ID: ${info.instanceId}, Key: ...${key.slice(-4)})`,
      )
      cleanupPromises.push(
        info
          .cleanupFn(info.resource)
          .catch((error) =>
            logger.error(
              `Error during immediate cleanup of resource (Instance ID: ${info.instanceId}): ${error instanceof Error ? error.message : String(error)}`,
              error,
            ),
          ),
      )
    }

    // Wait for all cleanup functions to complete (or fail)
    await Promise.allSettled(cleanupPromises)

    const finalCount = this.resources.size
    this.resources.clear() // Clear the map
    logger.warn(
      `Finished destroying all resources. Cleared ${finalCount} resource entries.`,
    )
  }
}

// Create and export a singleton instance of the ResourceManager
export const resourceManager = new ResourceManager()
