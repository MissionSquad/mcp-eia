# Guide: Adding New Tools

## Context

This guide explains the process of adding new custom tools to an MCP server built using this template. Tools are the core units of functionality exposed to the LLM.

-   **Related:** [System Overview](../architecture/system_overview.md), [Token Handling](../architecture/token_handling.md), [Resource Management](../architecture/resource_management.md)

## Goal

Provide clear steps for developers to define and implement new MCP tools within the template structure.

## Steps

1.  **Identify Tool Functionality:**
    *   Clearly define what the tool should do.
    *   Determine the necessary inputs (parameters) the LLM needs to provide.
    *   Determine the expected output format (usually a string, often JSON).
    *   Identify any external services the tool needs to interact with (APIs, SDKs, databases).
    *   Determine if the tool requires authentication credentials (`apiKey`).
    *   Determine if the tool needs managed resources (like SDK clients or DB connections) via the `ResourceManager`.

2.  **Define Parameter Schema (`src/index.ts`):**
    *   Using Zod, define a schema for the tool's input parameters.
    *   Place the schema definition near the top of `src/index.ts` or in a separate `src/schemas.ts` file if preferred.
    *   Use `.describe()` for each parameter to provide clear explanations for the LLM (exposed via `list_tools`).
    *   **IMPORTANT:** Do **NOT** include sensitive parameters like `apiKey` in the Zod schema. These are handled via `context.extraArgs`.

    ```typescript
    // src/index.ts
    import { z } from 'zod';

    // Example Schema for a tool that gets user details from an API
    const GetUserDetailsSchema = z.object({
      userId: z.string().describe('The unique identifier for the user.'),
      include_metadata: z.boolean().optional().default(false).describe('Whether to include extended metadata in the response.'),
    });
    ```

3.  **Implement the `execute` Function (`src/index.ts`):**
    *   Use `server.addTool<typeof YourSchemaType>(...)` to register the tool.
    *   Implement the `async execute(args, context)` function.
    *   **Inside `execute`:**
        *   **(Logging):** Add `logger.info` and `logger.debug` calls to trace execution.
        *   **(Authentication):** If required, implement the standard token handling pattern to resolve the `apiKey` from `context.extraArgs` or `config.apiKey`. Throw `UserError(apiKeyErrorMessage)` if a required key is missing.
        *   **(Resource Management):** If interacting with external services needing managed clients/connections, use `resourceManager.getResource()` with the resolved `apiKey` (or other appropriate key) and provide the necessary factory/cleanup functions.
        *   **(Core Logic):** Implement the main functionality of the tool using the validated `args` and any obtained resources. Perform API calls, SDK interactions, database queries, etc.
        *   **(Error Handling):** Wrap external calls and critical logic in `try...catch` blocks. Log internal errors with `logger.error`. Throw `UserError('User-friendly message')` for errors that should be reported back to the LLM.
        *   **(Return Value):** Return the result as a string. If returning complex data, serialize it to a JSON string (`JSON.stringify(...)`).

    ```typescript
    // src/index.ts
    import { server } from './server'; // Assuming server instance is exported
    import { logger } from './logger.js';
    import { config, apiKeyErrorMessage } from './config.js';
    import { UserError } from '@missionsquad/fastmcp';
    import { resourceManager } from './resource-manager.js';
    // import axios from 'axios'; // Example dependency

    server.addTool({
      name: 'get_user_details',
      description: 'Retrieves details for a specific user from the User Service API.',
      parameters: GetUserDetailsSchema, // Use the schema defined above
      execute: async (args, context) => {
        logger.info(`Executing 'get_user_details' for user ID: ${args.userId}, Request ID: ${context.requestId}`);
        logger.debug(`Args: ${JSON.stringify(args)}`);

        // --- Authentication ---
        const { apiKey: extraArgsApiKey } = context.extraArgs as { apiKey?: string } || {};
        let apiKey = extraArgsApiKey || config.apiKey; // Assuming API key needed for User Service
        if (!apiKey) {
          logger.error(`'get_user_details' failed: API key missing.`);
          throw new UserError(apiKeyErrorMessage);
        }
        logger.debug(`Using API key (source: ${extraArgsApiKey ? 'extraArgs' : 'environment'})`);

        // --- Resource Management (Example: Using a shared Axios instance) ---
        // const axiosInstance = await resourceManager.getResource<AxiosInstance>(
        //   'shared_axios', // Fixed key for shared resource
        //   'axios',
        //   async () => axios.create({ baseURL: process.env.USER_SERVICE_URL }),
        //   async () => {} // No specific cleanup for basic axios instance
        // );

        // --- Core Logic ---
        try {
          const apiUrl = `${process.env.USER_SERVICE_URL}/users/${args.userId}`;
          const headers = { 'Authorization': `Bearer ${apiKey}` };
          // const response = await axiosInstance.get(apiUrl, { headers }); // Using managed instance
          const response = await fetch(apiUrl, { headers }); // Or using native fetch

          if (!response.ok) {
             throw new Error(`API request failed with status ${response.status}`);
          }

          const userData = await response.json();

          // Optionally filter based on args.include_metadata
          const resultData = args.include_metadata ? userData : { id: userData.id, name: userData.name }; // Example filtering

          logger.info(`'get_user_details' completed successfully for user ID: ${args.userId}`);
          return JSON.stringify(resultData); // Return JSON string

        } catch (error: any) {
          logger.error(`'get_user_details' failed for user ID ${args.userId}: ${error.message}`, error);
          throw new UserError(`Failed to get user details for ID ${args.userId}: ${error.message}`);
        }
      },
    });
    ```

4.  **Add Configuration (if needed):**
    *   If the tool requires new configuration (e.g., API base URLs, specific keys), add corresponding environment variables to `.env.example` and load/validate them in `src/config.ts`.

5.  **Document the Tool:**
    *   Ensure the tool's `description` and parameter `.describe()` calls are clear.
    *   Consider adding a feature document in `/.nexus/features/your_tool_name/feature.md` explaining its purpose and usage in more detail.
    *   Update `README.md` or other relevant documentation if the tool represents a major piece of functionality.

6.  **Test:**
    *   Test the tool thoroughly by sending MCP `call_tool` requests (manually or via an MCP client/testing tool) with various valid and invalid inputs, including scenarios with and without `extraArgs.apiKey`.

## Best Practices

*   **Keep Tools Focused:** Each tool should perform a single, well-defined task.
*   **Validate Inputs:** Rely on the Zod schema for initial validation. Add further specific validation within `execute` if needed.
*   **Handle Errors Gracefully:** Provide informative `UserError` messages for expected failures and log detailed internal errors.
*   **Use `ResourceManager`:** Leverage the resource manager for any clients/connections that benefit from caching and lifecycle management.
*   **Secure Credential Handling:** Strictly follow the `extraArgs`/environment variable pattern for API keys. Never hardcode secrets.
*   **Clear Logging:** Use the logger to understand the tool's execution flow and diagnose issues.
*   **Return Strings:** Ensure the final return value is a string (serialize objects/arrays to JSON).

## AI Assistance Notes

-   Model Used: (Specify Model)
-   Prompt: (Specify Prompt)
-   Date Generated: (Specify Date)

## Related Nexus Documents

-   [System Overview](../architecture/system_overview.md)
-   [Token Handling](../architecture/token_handling.md)
-   [Resource Management](../architecture/resource_management.md)
-   [Integration Examples](./integration_examples.md)
