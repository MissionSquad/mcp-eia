/**
 * This file defines shared TypeScript types and interfaces used throughout the application.
 * Keeping types centralized improves maintainability and clarity.
 */

// --- Resource Manager Related Types ---

/**
 * Defines the structure for information about a managed resource
 * stored within the ResourceManager.
 *
 * @template T The type of the actual resource being managed (e.g., S3Client, Pool).
 */
export interface ManagedResourceInfo<T> {
  /** The actual resource instance. */
  resource: T
  /** Timestamp (ms since epoch) when the resource was last accessed. */
  lastUsed: number
  /** A unique identifier assigned to this specific instance upon creation. */
  instanceId: string
  /** The type identifier provided when the resource was created (e.g., 's3', 'postgres_pool'). */
  resourceType: string
  /** The key used to cache this resource (often an API key or connection identifier). */
  cacheKey: string
  /** Function provided during creation to clean up/destroy this specific resource. */
  cleanupFn: (resource: T) => Promise<void>
}

// --- Tool Related Types ---

/**
 * Represents the context object passed to a tool's execute function.
 * Extend this interface if you add more standard properties to your context.
 */
export interface ToolExecutionContext {
  /** A unique identifier for the current MCP request. */
  requestId: string
  /**
   * An object containing extra arguments passed alongside the main tool parameters.
   * This is typically used for passing authentication tokens (`apiKey`) or other
   * contextual data not part of the tool's public schema.
   * Use type assertion `as { apiKey?: string }` when accessing specific properties.
   */
  extraArgs?: Record<string, unknown> | null
  // Add other context properties if needed, e.g., userId, sessionId
}

/**
 * Defines the expected structure for a tool definition provided to FastMCP's `addTool`.
 *
 * @template T The Zod schema type for the tool's parameters.
 * @template U The expected return type of the tool's execute function (usually string).
 */
export interface ToolDefinition<T extends z.ZodTypeAny, U = string> {
  /** The name of the tool as exposed via MCP. */
  name: string
  /** A description of what the tool does. */
  description: string
  /** The Zod schema defining the tool's input parameters. */
  parameters: T
  /**
   * The asynchronous function that executes the tool's logic.
   * @param args The validated parameters matching the Zod schema.
   * @param context The execution context, including `requestId` and `extraArgs`.
   * @returns A promise resolving to the tool's output (typically a string or JSON string).
   */
  execute: (
    args: z.infer<T>,
    context: ToolExecutionContext,
  ) => Promise<U>
}

// Import Zod for use in ToolDefinition
import { z } from 'zod'

// Add other shared types and interfaces below as your application grows.
// Example:
// export interface UserProfile {
//   id: string;
//   username: string;
//   roles: string[];
// }
