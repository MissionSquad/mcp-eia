# MCP-EIA: Model Context Protocol server for U.S. EIA electricity data

MCP-EIA exposes curated tools over the U.S. Energy Information Administration (EIA) Electricity datasets, adding robust validation and domain analysis on top of the raw API. It is built with `@missionsquad/fastmcp`, validates responses with Zod, and manages authenticated API clients per user via a `ResourceManager`. Transport is stdio.

- Strong response validation with Zod schemas
- Multi-tenant authentication via `extraArgs.apiKey` with environment fallback
- Cached API clients with timed cleanup and safe shutdown hooks
- OpenAPI-derived request typing for EIA endpoints
- Practical analytic tools for state profiles, generation mix, capacity/utilization, retail price comparison, and energy storage siting

## Requirements

- Node.js ≥ 20
- An EIA API key

## Installation and Run

1) Install dependencies:
```bash
npm install
# or
yarn install
```

2) Configure environment (see Configuration):
- Set `EIA_API_KEY` or provide a per-request key via `extraArgs.apiKey`.

3) Build and start:
```bash
npm run build
npm start
# or
yarn build
yarn start
```

The server listens for MCP requests on stdio. The published bin name is `mcp-eia` (see `package.json`), enabling execution as a CLI if installed/published.

## Configuration

Set via environment variables (loaded from `.env` if present):

| Variable                    | Description                                                         | Default     |
|----------------------------|---------------------------------------------------------------------|-------------|
| EIA_API_KEY                | Fallback API key if not provided per request via `extraArgs.apiKey` | (none)      |
| EIA_API_TIMEOUT            | Axios request timeout in ms                                         | 30000       |
| LOG_LEVEL                  | Logging level: `error` | `warn` | `info` | `debug`                 | info        |
| RESOURCE_CLEANUP_INTERVAL  | Milliseconds between cached resource cleanup sweeps                 | 1800000     |
| MAX_RETRIES                | Generic retry ceiling (if used by callers)                          | 3           |
| RETRY_BASE_DELAY           | Base backoff in ms (if used by callers)                             | 1000        |

Example `.env`:
```ini
EIA_API_KEY=your_eia_api_key_here
LOG_LEVEL=info
EIA_API_TIMEOUT=30000
RESOURCE_CLEANUP_INTERVAL=1800000
MAX_RETRIES=3
RETRY_BASE_DELAY=1000
```

## Authentication

- Preferred (multi-tenant): Provide `context.extraArgs.apiKey` on each MCP tool call. This parameter is intentionally not part of tool schemas and is therefore not exposed in `list_tools`.
- Fallback: If `extraArgs.apiKey` is not provided, the server uses `process.env.EIA_API_KEY`.
- If neither is present, tools throw a `UserError`:
  - “Authentication failed: No EIA API key provided in the request context (extraArgs.apiKey) and no fallback EIA_API_KEY found in environment variables.”

## Available Tools

All tools return stringified JSON. Provide two-letter US state codes (e.g., `TX`, `CA`). Supply the API key via `extraArgs.apiKey` or `EIA_API_KEY`.

### 1) findHighPotentialEnergyStorageAreas

Analyzes multiple states to identify high-potential regions for energy storage deployment using capacity mix, demand patterns, renewable integration indicators, grid stability proxies, and price signals.

- Parameters (JSON):
```json
{
  "regions": ["TX", "CA", "FL"],
  "includeHourlyAnalysis": false
}
```
- Notes:
  - `regions`: array of 2-letter states (min 1).
  - `includeHourlyAnalysis`: when true, adds hourly RTO demand (where mappable) for finer stability metrics (TX, CA, NY, IL, PA, MA, OK).
- Output (stringified JSON):
  - `{ summary, detailedResults: EnergyStorageOpportunityMetrics[], failedRegions }`
  - `summary.topOpportunities` ranks by composite “storageOpportunityScore.overall”.
- EIA datasets used:
  - `/v2/electricity/operating-generator-capacity/data`
  - `/v2/electricity/electric-power-operational-data/data`
  - `/v2/electricity/retail-sales/data`
  - `/v2/electricity/rto/region-data/data` (if hourly analysis enabled)

Example:
```json
{
  "regions": ["TX", "CA", "FL"],
  "includeHourlyAnalysis": true
}
```

### 2) getStateElectricityProfileSummary

Returns a concise 5‑year state electricity profile with YoY deltas and trend for key metrics.

- Parameters:
```json
{ "region": "TX" }
```
- Output:
  - `{ region, analysisDate, years: string[], metrics: { "net-generation", "total-retail-sales", "average-retail-price" } }`
- EIA dataset:
  - `/v2/electricity/state-electricity-profiles/summary/data`

### 3) getGenerationMixByState

Summarizes latest-period net generation by fuel type with shares (%) and identifies the dominant fuel.

- Parameters:
```json
{ "region": "CA" }
```
- Output:
  - `{ region, period, totalNetGenerationGWh, byFuel: { [fuel]: { netGenerationGWh, sharePct, reportingUnits, description? } }, dominantFuel }`
- EIA dataset:
  - `/v2/electricity/electric-power-operational-data/data`

### 4) getCapacityAndUtilizationByState

Aggregates summer/winter capacity and estimates recent capacity utilization using generation data.

- Parameters:
```json
{ "region": "NY" }
```
- Output:
  - `{ region, latestPeriod, totalSummerCapacityMW, totalWinterCapacityMW, utilization: { ratio, totalGenerationGWh, totalConsumptionGWh } }`
- EIA datasets:
  - `/v2/electricity/operating-generator-capacity/data`
  - `/v2/electricity/electric-power-operational-data/data`

### 5) compareRetailElectricityPrices

Compares the most recent N monthly average retail electricity prices (sector=ALL) across states, returning average price, volatility index (CoV), and a simple trend.

- Parameters:
```json
{
  "regions": ["TX", "CA"],
  "months": 12
}
```
- Constraints:
  - `regions`: min length 2
  - `months`: integer 3–12 (default 12)
- Output:
  - `{ analysisDate, monthsAnalyzed, rankings[], top5[], failedRegions[], notes }`
- EIA dataset:
  - `/v2/electricity/retail-sales/data` with `sectorid=ALL`

### 6) discoverElectricityRouteMetadata

Discovers route metadata (frequencies, facets, data columns, date range) or enumerates facet options for the selected route.

- Parameters:
```json
{ "route": "retail-sales" }
```
or
```json
{ "route": "retail-sales", "facetId": "sectorid" }
```
- `route` enum:
  - `retail-sales`
  - `electric-power-operational-data`
  - `operating-generator-capacity`
  - `state-electricity-profiles/summary`
  - `rto/region-data`
- Output:
  - Without `facetId`: `{ route, response: { facets, data, startPeriod, endPeriod, ... } }`
  - With `facetId`: `{ route, facetId, response: { values: [{ code, name }, ...] } }`
- Endpoints:
  - Metadata: `GET /v2/electricity/{route}`
  - Facet options: `GET /v2/electricity/{route}/facet/{facetId}`

#### Planned/disabled
- `getRTODemandSnapshot` exists in code but is commented out. Intended to compute recent RTO demand metrics over a selected window. Enumerate valid respondents via:
  - `discoverElectricityRouteMetadata` with `route="rto/region-data"`, `facetId="respondent"` (and `facetId="type"` for series types).

## Data Sources (EIA)

- `/v2/electricity/operating-generator-capacity/data`
- `/v2/electricity/electric-power-operational-data/data`
- `/v2/electricity/retail-sales/data`
- `/v2/electricity/state-electricity-profiles/summary/data`
- `/v2/electricity/rto/region-data/data`
- Metadata/facets via:
  - `/v2/electricity/{route}`
  - `/v2/electricity/{route}/facet/{facetId}`

## Operational Details

- Transport: stdio (`server.start({ transportType: "stdio" })`)
- Client management: `ResourceManager` caches `EiaApiClient` per API key and performs periodic cleanup (interval configurable). All resources are destroyed on `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection`.
- Logging: request URLs, warnings for per-region failures, and full error messages. Level controlled by `LOG_LEVEL`.

## Using with an MCP Client

- Provide `extraArgs.apiKey` on each request for per-user authentication, or set `EIA_API_KEY` in the server environment for a shared key.
- Send tool parameters exactly as specified above. Responses are stringified JSON.

## Development

- Generate OpenAPI types from the included swagger file:
```bash
npm run gen:api-types
```

- Build, watch, start:
```bash
npm run build
npm run dev
npm start
```

- Inspect FastMCP declarations:
```bash
npm run inspect
```

OpenAPI types are generated from `eia-swagger.yaml` into `src/types/eia-api.d.ts`.

## License

MIT
