# Architecture: Token Handling (Multi-User Authentication)

## Context

A primary design goal of this MCP server template is to support multi-user environments securely and flexibly. This means handling authentication credentials (API keys, tokens, etc.) in a way that allows different users interacting with the *same* server instance to use *their own* credentials for the underlying services, without exposing those credentials unnecessarily.

-   **Related:** [System Overview](system_overview.md), [Resource Management](resource_management.md)

## Goal

Implement an authentication strategy that:

1.  Allows user-specific credentials (termed `apiKey` generically) to be passed securely during a tool call.
2.  Avoids exposing the credential parameter (`apiKey`) in the public tool schema (MCP `list_tools` response).
3.  Provides a fallback mechanism to use globally configured credentials (from environment variables) for single-user or shared-credential scenarios.
4.  Is consistently applied across all tools requiring authentication.

## Implementation Strategy

The strategy relies on a combination of `context.extraArgs` provided by FastMCP and environment variable configuration.

**Steps within a Tool's `execute` function:**

1.  **Retrieve from `extraArgs`:** Access the `context.extraArgs` object passed to the `execute` function. Attempt to retrieve a property named `apiKey`. Type assertion is used as `extraArgs` is `Record<string, unknown>`.
    ```typescript
    const { apiKey: extraArgsApiKey } = context.extraArgs as { apiKey?: string } || {};
    ```
    *   **Rationale:** `extraArgs` is designed for passing contextual data alongside standard tool arguments. An intermediary application (acting as a proxy between the LLM user and this MCP server) can securely inject the user's specific `apiKey` here before forwarding the request. Because `apiKey` is not in the Zod schema, it's hidden from the LLM's view of the tool.

2.  **Prioritize `extraArgs`:** Use the `extraArgsApiKey` as the primary source for the credential.
    ```typescript
    let apiKey = extraArgsApiKey; // Prioritize key from extraArgs
    ```

3.  **Fallback to Environment Variable:** If `extraArgsApiKey` is not present (i.e., `undefined` or `null`), attempt to use the fallback key configured in the environment.
    ```typescript
    if (!apiKey) {
      apiKey = config.apiKey; // Fallback to environment variable (loaded in config.ts)
      logger.debug(`Tool using fallback API key (if configured).`);
    } else {
      logger.debug(`Tool using API key from extraArgs.`);
    }
    ```
    *   **Rationale:** This supports the traditional MCP server model where credentials might be set globally for the server instance via `.env` files. It allows the template to be used in simpler, single-user setups as well.

4.  **Check for Required Key:** If the specific tool *requires* an API key to function, check if one was successfully resolved. If not, throw a user-facing error.
    ```typescript
    if (!apiKey) {
       // This check is only needed if the tool cannot operate without a key
       logger.error(`Tool execution failed: API key missing.`);
       throw new UserError(apiKeyErrorMessage); // Use the shared error message
    }
    ```
    *   **Rationale:** Provides clear feedback to the caller if necessary authentication information is missing.

5.  **Use the Resolved `apiKey`:** Use the final `apiKey` value (which could be from `extraArgs` or the environment) for subsequent operations, such as:
    *   Authenticating direct API calls.
    *   Passing as the `key` parameter to `resourceManager.getResource()` to ensure resource isolation/reuse based on the credential.

## Example Code Snippet (within `execute`)

```typescript
import { config, apiKeyErrorMessage } from './config.js';
import { UserError } from '@missionsquad/fastmcp';
import { logger } from './logger.js';

// --- Inside async execute(args, context) ---

// 1. Retrieve from extraArgs
const { apiKey: extraArgsApiKey } = context.extraArgs as { apiKey?: string } || {};
logger.debug(`API Key provided via extraArgs: ${!!extraArgsApiKey}`);

// 2. Prioritize extraArgs, 3. Fallback to environment
let apiKey = extraArgsApiKey || config.apiKey;

// 4. Check if required (assuming this tool needs it)
if (!apiKey) {
  logger.error(`Authentication failed for tool execution: No API key found.`);
  throw new UserError(apiKeyErrorMessage);
}

// 5. Use the resolved apiKey
logger.info(`Proceeding with tool execution using resolved API key (source: ${extraArgsApiKey ? 'extraArgs' : 'environment'}).`);

// Example: Pass to ResourceManager
// const client = await resourceManager.getResource(apiKey, 'service_type', ...);

// Example: Use in an API call header
// const headers = { 'Authorization': `Bearer ${apiKey}` };
// await axios.get(url, { headers });

// ... rest of tool logic ...
```

## Security Considerations

*   **Intermediary Application:** This pattern relies on a trusted intermediary application (proxy) to securely handle user authentication and inject the correct `apiKey` into `extraArgs`. The MCP server itself trusts that the `apiKey` provided via `extraArgs` is valid and authorized for the user making the request.
*   **Environment Variable Security:** If using the fallback mechanism, ensure the `.env` file and environment variables on the server are properly secured.
*   **Logging:** Avoid logging the actual `apiKey` value. Log only whether it was received via `extraArgs` or fallback, or log masked versions (e.g., `...${key.slice(-4)}`). The template's `logger` and `resourceManager` attempt to follow this practice.

## Naming Convention

While the template uses the generic term `apiKey`, you should adapt this in your specific implementation if a different term is more appropriate (e.g., `authToken`, `bearerToken`, `dbPassword`). Ensure consistency between the key expected in `extraArgs`, the environment variable name (`.env`), and the configuration loading (`src/config.ts`).

## AI Assistance Notes

-   Model Used: (Specify Model)
-   Prompt: (Specify Prompt)
-   Date Generated: (Specify Date)

## Related Nexus Documents

-   [System Overview](system_overview.md)
-   [Resource Management](resource_management.md)
-   [Configuration (`src/config.ts`)](../src/config.ts)
