import dotenv from "dotenv";
import { z } from "zod";
import { logger } from "./logger.js";

dotenv.config();

const ConfigSchema = z.object({
  eiaApiKey: z.string().optional(),
  eiaApiTimeout: z.number().int().positive().default(30000),
  logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
  resourceCleanupInterval: z
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),
  maxRetries: z.number().int().min(0).default(3),
  retryBaseDelay: z.number().int().positive().default(1000),
});

const parsedConfig = ConfigSchema.safeParse({
  eiaApiKey: process.env.EIA_API_KEY,
  eiaApiTimeout: process.env.EIA_API_TIMEOUT
    ? parseInt(process.env.EIA_API_TIMEOUT, 10)
    : undefined,
  logLevel: process.env.LOG_LEVEL,
  resourceCleanupInterval: process.env.RESOURCE_CLEANUP_INTERVAL
    ? parseInt(process.env.RESOURCE_CLEANUP_INTERVAL, 10)
    : undefined,
  maxRetries: process.env.MAX_RETRIES
    ? parseInt(process.env.MAX_RETRIES, 10)
    : undefined,
  retryBaseDelay: process.env.RETRY_BASE_DELAY
    ? parseInt(process.env.RETRY_BASE_DELAY, 10)
    : undefined,
});

if (!parsedConfig.success) {
  console.error(
    "❌ Invalid environment configuration:",
    parsedConfig.error.flatten().fieldErrors
  );
  throw new Error("Invalid environment configuration.");
}

export const config = parsedConfig.data;

export const apiKeyErrorMessage =
  "Authentication failed: No EIA API key provided in the request context (extraArgs.apiKey) and no fallback EIA_API_KEY found in environment variables.";

// Log config safely
// Note: logger might not be fully initialized if this file is imported before logger.ts sets its config.
// This is generally safe as the default log level will be used initially.
logger.debug("Configuration loaded:", {
  logLevel: config.logLevel,
  resourceCleanupInterval: config.resourceCleanupInterval,
  maxRetries: config.maxRetries,
  retryBaseDelay: config.retryBaseDelay,
  eiaApiTimeout: config.eiaApiTimeout,
  eiaApiKeyProvided: !!config.eiaApiKey,
});
