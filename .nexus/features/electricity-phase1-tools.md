# Feature: Electricity Tools – Phase 1

## Context

This feature introduces five low-to-medium complexity tools to the `mcp-eia` MCP server. They leverage the existing repository (`ElectricityRepository`), analyzers (`CapacityAnalyzer`, `ProfileAnalyzer`), and the EIA API v2 via `EiaApiClient`. They follow the server’s token handling and resource management patterns.

- Code entry point: `src/index.ts`
- Repositories: `src/repositories/electricityRepository.ts`
- Analyzers: `src/analysis/capacityAnalyzer.ts`, `src/analysis/profileAnalyzer.ts`
- Validation: `src/validation/electricity.schemas.ts`
- EIA OpenAPI types: `src/types/eia-api.d.ts`
- Auth/config: `src/config.ts`, `apiKeyErrorMessage` constant
- Resource Manager: `src/resource-manager.ts`

## Token Handling

- Tools resolve the EIA API key using `context.extraArgs.apiKey` or fallback to `process.env.EIA_API_KEY` via `config.eiaApiKey`.
- If no key is available, tools throw a `UserError(apiKeyErrorMessage)`.
- `EiaApiClient` instances are obtained via `resourceManager.getResource`.

## Tools

### 1) getStateElectricityProfileSummary

- Description: Returns a concise 5-year summary for a state’s electricity profile with YoY deltas and simple trend markers.
- Parameters:
  - `region` (string, length 2) – Two-letter state code (e.g., "TX", "CA").
- Data:
  - Endpoint: `/v2/electricity/state-electricity-profiles/summary/data` (annual)
  - Repository: `getStateElectricityProfile(stateId)`
- Output (JSON string):
```json
{
  "region": "CO",
  "analysisDate": "2025-08-12T00:00:00.000Z",
  "years": ["2024", "2023", "2022", "2021", "2020"],
  "metrics": {
    "total-electric-power-industry": { "latest": 12345, "yoyDelta": 234, "trend": "up" },
    "total-consumption": { "latest": 23456, "yoyDelta": -100, "trend": "down" },
    "net-interstate-flow-of-electricity": { "latest": -789, "yoyDelta": 11, "trend": "flat" }
  }
}
```
- Notes: Trend uses ≈1% band or an absolute threshold for “flat”.

### 2) getGenerationMixByState

- Description: Summarizes latest-period net generation by fuel type and shares (%) for a state.
- Parameters:
  - `region` (string, length 2).
- Data:
  - Endpoint: `/v2/electricity/electric-power-operational-data/data` (monthly)
  - Repository: `getGenerationByFuelType(stateId)`
  - Analyzer: `ProfileAnalyzer.summarizeGeneration(...)`
- Output:
```json
{
  "region": "CO",
  "period": "2025-06",
  "totalNetGenerationGWh": 123.45,
  "byFuel": {
    "NG": { "netGenerationGWh": 60, "sharePct": 48.6, "reportingUnits": 10 }
  },
  "dominantFuel": { "fuelType": "NG", "sharePct": 48.6 }
}
```

### 3) getCapacityAndUtilizationByState

- Description: Reports aggregate summer/winter capacity (latest period) and estimates monthly utilization from generation data.
- Parameters:
  - `region` (string, length 2).
- Data:
  - Endpoints:
    - `/v2/electricity/operating-generator-capacity/data`
    - `/v2/electricity/electric-power-operational-data/data`
  - Repository: `getOperatingCapacityByState(stateId)`, `getGenerationByFuelType(stateId)`
  - Analyzer: `CapacityAnalyzer.calculateRegionalMetrics(...)` and `calculateCapacityUtilization(...)`
- Output:
```json
{
  "region": "TX",
  "latestPeriod": "2025-06",
  "totalSummerCapacityMW": 123456,
  "totalWinterCapacityMW": 120000,
  "utilization": {
    "ratio": 0.53,
    "totalGenerationGWh": 222.2,
    "totalConsumptionGWh": 200.1
  }
}
```

### 4) compareRetailElectricityPrices

- Description: Compares most recent N months (default 12, max 12) average retail electricity price across multiple states (sector ALL).
- Parameters:
  - `regions` (string[], min 2, two-letter states).
  - `months` (int 3–12, default 12).
- Data:
  - Endpoint: `/v2/electricity/retail-sales/data`
  - Repository: `getRetailPrices(stateId)` (returns up to last 12 months, ALL sector)
- Output:
```json
{
  "analysisDate": "2025-08-12T00:00:00.000Z",
  "monthsAnalyzed": 12,
  "rankings": [
    { "region": "CA", "avgPriceCentsPerKWh": 22.1, "volatilityIndex": 0.12, "trend": "rising" }
  ],
  "top5": [],
  "failedRegions": [],
  "notes": "Sector = ALL. Using the most recent N monthly observations returned by EIA."
}
```
- Notes: Trend computed via (latest−earliest) with 0.1¢/kWh deadband.

### 5) discoverElectricityRouteMetadata

- Description: Discovers route metadata (frequencies, facets, data columns) or facet options for a given electricity route.
- Parameters:
  - `route` ∈ { `retail-sales`, `electric-power-operational-data`, `operating-generator-capacity`, `state-electricity-profiles/summary`, `rto/region-data` }
  - `facetId?` – Optional facet identifier to enumerate options.
- Data:
  - Metadata endpoints:
    - `/v2/electricity/{route}`
    - `/v2/electricity/{route}/facet`
    - `/v2/electricity/{route}/facet/{facet_id}`
- Output (route metadata example):
```json
{
  "route": "retail-sales",
  "response": {
    "id": "retail-sales",
    "name": "Electricity Sales to Ultimate Customers",
    "frequency": [{ "id": "monthly", "format": "YYYY-MM" }],
    "facets": [{ "id": "stateid" }, { "id": "sectorid" }],
    "data": { "revenue": {}, "sales": {}, "price": {}, "customers": {} },
    "startPeriod": "2001-01",
    "endPeriod": "2025-06"
  }
}
```
- Output (facet example):
```json
{
  "route": "retail-sales",
  "facetId": "sectorid",
  "response": {
    "totalFacets": 6,
    "facets": [{ "id": "COM", "name": "commercial", "alias": "(COM) commercial" }]
  }
}
```

## API Limits and Performance

- EIA API max 5,000 rows per JSON response. All Phase 1 tools request small, recent windows.
- Sort by period desc with a bounded `length` to limit payloads.
- Hourly RTO data is not fetched in Phase 1 tools; discovery tool hits metadata only.

## Testing

- Use an MCP client to invoke `list_tools` then `call_tool` with appropriate parameters.
- Provide `extraArgs.apiKey` or set `EIA_API_KEY` in environment for the server.

## AI Assistance Notes

- Model: Cline (TypeScript engineering protocol enforced)
- Date: 2025-08-11
