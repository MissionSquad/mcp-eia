# Architecture: System Overview

## High-Level Goal

This project serves as a **template** for building **Model Context Protocol (MCP) servers** using Node.js and TypeScript. It provides a structured, scalable, and efficient foundation designed specifically to handle multi-user environments where authentication credentials might vary per user, while also supporting traditional single-user deployments.

## Core Technologies

*   **Node.js (v20+):** Runtime environment.
*   **TypeScript (v5.5+):** Language for type safety and maintainability.
*   **@missionsquad/fastmcp:** Library for implementing the MCP server logic (handling requests, defining tools).
*   **Zod:** For robust schema definition and validation of tool parameters.
*   **dotenv:** For loading environment variables.
*   **uuid:** For generating unique identifiers (used in ResourceManager).

## Key Architectural Concepts

```mermaid
graph TD
    LLM[Language Learning Model] -->|MCP Request| FastMCP[FastMCP Server (src/index.ts)]
    FastMCP -->|Parse & Validate| ToolExec[Tool Execute Function]
    ToolExec -->|apiKey?| Auth{Authentication Logic}
    Auth -- Yes, extraArgs.apiKey --> UseExtraArgs[Use Key from extraArgs]
    Auth -- No extraArgs.apiKey --> UseEnvVar{Use Fallback Env Var?}
    UseEnvVar -- Yes, config.apiKey --> UseFallback[Use Key from Environment]
    UseEnvVar -- No --> ErrorAuth[Throw Auth Error]

    subgraph "Tool Logic & Resource Access"
        direction LR
        ResolvedKey[Resolved API Key] --> ResMan{ResourceManager (src/resource-manager.ts)}
        ResMan -- Get/Create --> ResourceInstance[External Resource Instance (e.g., SDK Client, DB Pool)]
        ResourceInstance -->|Interact| ExternalService[External Service (API, DB, SDK Target)]
        ToolExec -->|Uses| ResolvedKey
        ToolExec -->|Uses| ResourceInstance
    end

    UseExtraArgs --> ResolvedKey
    UseFallback --> ResolvedKey

    ToolExec -->|Response| FastMCP
    FastMCP -->|MCP Response| LLM

    Config[Configuration (src/config.ts)] -- Reads --> EnvVars[.env File]
    FastMCP -->|Uses| Config
    ToolExec -->|Uses| Config
    ResMan -->|Uses| Config

    Logger[Logger (src/logger.ts)]
    FastMCP -->|Logs| Logger
    ToolExec -->|Logs| Logger
    ResMan -->|Logs| Logger

    ResMan -- Manages Lifecycle --> ResourceInstance
    ResMan -- Periodically Cleans --> ResourceInstance
```

1.  **FastMCP Server (`src/index.ts`):**
    *   The main entry point, responsible for initializing the FastMCP server.
    *   Defines MCP tools using `server.addTool()`.
    *   Each tool definition includes:
        *   `name`, `description`.
        *   `parameters`: A Zod schema for validating input arguments. **Crucially, sensitive info like API keys is NOT defined here.**
        *   `execute`: An async function containing the tool's logic.

2.  **Multi-User Authentication (`execute` function logic):**
    *   A core pattern implemented within *each* tool's `execute` function that requires authentication.
    *   It prioritizes retrieving an `apiKey` (or similar credential) from `context.extraArgs`. This allows a proxying application to inject user-specific keys securely.
    *   If no key is found in `extraArgs`, it falls back to a globally configured key from environment variables (`config.apiKey`).
    *   If neither is available and the tool requires a key, it throws a `UserError`.
    *   See [Token Handling Architecture](token_handling.md).

3.  **Resource Management (`src/resource-manager.ts`):**
    *   A singleton class (`resourceManager`) responsible for managing instances of external clients (SDKs, DB pools, etc.).
    *   Uses the resolved `apiKey` (or another suitable identifier) as a cache key to reuse resource instances.
    *   Handles lazy creation and automatic cleanup of inactive resources based on a configurable interval (`config.resourceCleanupInterval`).
    *   Requires factory and cleanup functions to be provided when requesting a resource type for the first time.
    *   See [Resource Management Architecture](resource_management.md).

4.  **Configuration (`src/config.ts`):**
    *   Loads configuration from environment variables (`.env` file via `dotenv`).
    *   Uses Zod (`ConfigSchema`) to validate environment variables and provide defaults.
    *   Exports the validated `config` object and shared constants like `apiKeyErrorMessage`.

5.  **Logging (`src/logger.ts`):**
    *   Provides a simple, level-based logger that writes to `stderr`. Configured via `config.logLevel`.

6.  **Error Handling:**
    *   Uses `try...catch` blocks within tool execution.
    *   Throws `UserError` from `@missionsquad/fastmcp` for errors that should be reported back to the LLM/user.
    *   Logs detailed internal errors using the `logger`.
    *   Includes global `uncaughtException` and `unhandledRejection` handlers for robustness.

## Request Flow

1.  An LLM sends an MCP `call_tool` request.
2.  The `FastMCP` server receives the request via stdio.
3.  The server parses the request, identifies the tool, and validates the `arguments` against the tool's Zod schema.
4.  The tool's `execute(args, context)` function is called.
5.  Inside `execute`:
    *   Authentication logic resolves the `apiKey` (from `context.extraArgs` or `config.apiKey`).
    *   If needed, `resourceManager.getResource()` is called with the resolved `apiKey` to get/create an external service client instance.
    *   The core tool logic is executed using the validated `args` and the obtained resource instance.
    *   Logging occurs via the `logger`.
    *   A result (string or JSON string) is returned.
6.  `FastMCP` formats the result into an MCP response.
7.  The server sends the MCP response back to the LLM via stdio.

## Extensibility

Adding new functionality involves:

1.  Defining a new Zod schema for the tool's parameters in `src/index.ts`.
2.  Implementing the tool's logic within a new `server.addTool()` call in `src/index.ts`.
3.  If the tool uses a new type of external resource, potentially updating the `ResourceManager` usage (providing new factory/cleanup functions if needed).
4.  Adding relevant Nexus documentation (feature description, guides).

## AI Assistance Notes

-   Model Used: (Specify Model)
-   Prompt: (Specify Prompt)
-   Date Generated: (Specify Date)

## Related Nexus Documents

-   [Token Handling](token_handling.md)
-   [Resource Management](resource_management.md)
-   [Adding Tools Guide](../guides/adding_tools.md)
-   [Technology Choices](../decisions/technology_choices/main_technologies.md)
