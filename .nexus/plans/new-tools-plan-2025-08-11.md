# Plan: New MCP Tools for mcp-eia (Phase 1 and Phase 2)

## Context

mcp-eia is an MCP server exposing EIA (eia.gov) data to AI agents. One tool currently exists: `findHighPotentialEnergyStorageAreas`, which analyzes multiple states for energy storage opportunity using capacity, generation, demand (optional hourly), and price data. The objective is to add useful, low-to-medium complexity tools that leverage existing repository methods, analyzers, and the EIA API v2.

This plan verifies current code constructs, documents exact endpoints/types to use, defines new tools (names, inputs, outputs, logic), specifies repository/schema additions (when needed), and outlines error handling, security, and a staged implementation approach.

- Code inspected:  
  - `src/index.ts` (tool registration pattern, FastMCP usage, auth/extraArgs, resource manager usage)  
  - `src/services/eiaClient.ts` (typed client calling EIA API v2)  
  - `src/repositories/electricityRepository.ts` (validated calls to electricity endpoints using Zod schemas)  
  - `src/validation/electricity.schemas.ts` (Zod schemas for specific routes)  
  - `src/analysis/*` (`energyStorageAnalyzer.ts`, `capacityAnalyzer.ts`, `profileAnalyzer.ts`)  
  - `src/types/eia-api.d.ts` (auto-generated from EIA OAS; authoritative list of routes)  
  - `.nexus/guides/adding_tools.md`, `.nexus/architecture/*` (patterns for auth and resource management)

- Verification of available endpoints (from `types/eia-api.d.ts`):  
  - Electricity datasets and metadata:  
    - `/v2/electricity`, `/v2/electricity/{route}`, `/v2/electricity/{route}/facet`, `/v2/electricity/{route}/facet/{facet_id}`  
  - Data endpoints used (validated):  
    - `/v2/electricity/retail-sales/data`  
    - `/v2/electricity/electric-power-operational-data/data`  
    - `/v2/electricity/operating-generator-capacity/data`  
    - `/v2/electricity/state-electricity-profiles/summary/data`  
    - `/v2/electricity/rto/region-data/data`  
    - Available for Phase 2:  
      - `/v2/electricity/state-electricity-profiles/emissions-by-state-by-fuel/data`

- Existing repository methods (validated against Zod schemas):  
  - `getOperatingCapacityByState(stateId)` → `/v2/electricity/operating-generator-capacity/data`  
  - `getGenerationByFuelType(stateId)` → `/v2/electricity/electric-power-operational-data/data`  
  - `getRetailSales(stateId)` → `/v2/electricity/retail-sales/data`  
  - `getStateElectricityProfile(stateId)` → `/v2/electricity/state-electricity-profiles/summary/data`  
  - `getRTODemandData(stateId)` → `/v2/electricity/rto/region-data/data` (hourly; with internal state→RTO mapping)  
  - `getCapacityByFuelType(stateId)` (builds totals by energy_source_code using `OperatingCapacityResponseSchema`)  
  - `getRetailPrices(stateId)` (last 12 months, sector ALL)

- Existing analyzers:  
  - `CapacityAnalyzer`: calculates regional capacity metrics (latest period) and capacity utilization using generation data.  
  - `ProfileAnalyzer`: summarizes generation by fuel type (latest period), with GWh and reporting units.  
  - `EnergyStorageAnalyzer`: computes composite metrics for storage opportunity (grid/economic/renewable/stability).

- Token handling and resource lifecycle (as per `.nexus/architecture/token_handling.md` and current code):  
  - Tools must resolve `apiKey` from `context.extraArgs.apiKey` or fallback to `config.eiaApiKey`.  
  - Throw `UserError(apiKeyErrorMessage)` if missing.  
  - Use `resourceManager.getResource(eiaApiKey, "EiaApiClient", factory, cleanup)` for client reuse.

## Goals

- Deliver a small suite of low/medium complexity tools that provide immediate analytical and discovery value:
  - State electricity profile summary (last ~5 years, trends).
  - Generation mix by fuel type (latest period).
  - Capacity and utilization estimation (monthly approximation).
  - Multi-state retail price comparison (recent months).
  - Discovery of electricity route metadata and facet options (to guide further queries).

- Avoid high complexity, respect EIA API row limits, and keep requests conservative.

- Stage more advanced tools (e.g., emissions intensity estimation) for a Phase 2, requiring minimal new schemas.

## Tool Set Overview

### Phase 1 (implement first; quick wins)
1) getStateElectricityProfileSummary (Simple)  
2) getGenerationMixByState (Simple)  
3) getCapacityAndUtilizationByState (Simple–Medium)  
4) compareRetailElectricityPrices (Simple)  
5) discoverElectricityRouteMetadata (Simple)

### Phase 2 (follow-up; medium)
6) getRTODemandSnapshot (Medium)  
7) estimateEmissionsIntensityByState (Medium; requires schema discovery/addition)

## Detailed Specifications

### 1) getStateElectricityProfileSummary
- Description: Returns a concise 5-year summary of a state’s electricity profile with YoY deltas and simple trend indicators.
- Parameters (Zod):  
  - `region: string` of length 2; US state code (e.g., "TX", "CA").
- Data sources:  
  - Repository: `ElectricityRepository.getStateElectricityProfile(region)` (already implemented)  
  - Endpoint: `/v2/electricity/state-electricity-profiles/summary/data`
- Logic:  
  - Use repository result (sorted desc, length 5).  
  - For each metric (`total-electric-power-industry`, `total-consumption`, `net-interstate-flow-of-electricity`), compute:  
    - latest value  
    - YoY delta = latest − previous  
    - trend ∈ { up, down, flat } with a small deadband (e.g., ~1% or a small absolute threshold) to avoid noise.  
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
- Complexity: Simple.

### 2) getGenerationMixByState
- Description: Summarizes latest-period net generation by fuel type and shares (%) for a state.
- Parameters (Zod):  
  - `region: string` (length 2).
- Data sources:  
  - `ElectricityRepository.getGenerationByFuelType(region)`  
  - Endpoint: `/v2/electricity/electric-power-operational-data/data`
- Logic:  
  - Use `ProfileAnalyzer.summarizeGeneration` → `{ [fuelType]: { netGenerationGWh, reportingUnits } }` for latest period.  
  - Sum total netGenerationGWh; compute share = (byFuel / total) * 100 (rounded).  
  - Determine dominant fuel by highest share. Period inferred as `generationData[0]?.period`.
- Output:
```json
{
  "region": "CO",
  "period": "2025-06",
  "totalNetGenerationGWh": 123.45,
  "byFuel": { "NG": { "netGenerationGWh": 60, "sharePct": 48.6, "reportingUnits": 10 }, "...": {} },
  "dominantFuel": { "fuelType": "NG", "sharePct": 48.6 }
}
```
- Complexity: Simple.

### 3) getCapacityAndUtilizationByState
- Description: Combines capacity and recent generation to estimate monthly capacity utilization and report aggregate seasonal capacity.
- Parameters (Zod):  
  - `region: string` (length 2).
- Data sources:  
  - `ElectricityRepository.getOperatingCapacityByState(region)`  
  - `ElectricityRepository.getGenerationByFuelType(region)`  
  - Endpoints: `/v2/electricity/operating-generator-capacity/data` and `/v2/electricity/electric-power-operational-data/data`
- Logic:  
  - `CapacityAnalyzer.calculateRegionalMetrics` → latest period, total summer/winter capacity.  
  - `CapacityAnalyzer.calculateCapacityUtilization` → ratio, totalGenerationGWh, totalConsumptionGWh.  
- Output:
```json
{
  "region": "TX",
  "latestPeriod": "2025-06",
  "totalSummerCapacityMW": 123456,
  "totalWinterCapacityMW": 120000,
  "utilization": { "ratio": 0.53, "totalGenerationGWh": 222.2, "totalConsumptionGWh": 200.1 }
}
```
- Complexity: Simple–Medium.

### 4) compareRetailElectricityPrices
- Description: Compares most recent N months (default 12, max 12) average retail electricity price across multiple states (ALL sector).
- Parameters (Zod):  
  - `regions: string[]` (length 2 each; min 2)  
  - `months: number` int, min 3, max 12, default 12
- Data sources:  
  - `ElectricityRepository.getRetailPrices(region)` (returns up to 12 months for sector ALL)  
  - Endpoint: `/v2/electricity/retail-sales/data`
- Logic:  
  - For each region, take first `months` entries (sorted desc).  
  - Compute average price (cents/kWh), coefficient of variation as volatility proxy, and trend via simple delta (latest−earliest) with a deadband (e.g., 0.1¢/kWh) → rising/falling/flat.  
  - Sort regions by avg price (desc). Include top 5.  
- Output:
```json
{
  "analysisDate": "2025-08-12T00:00:00.000Z",
  "monthsAnalyzed": 12,
  "rankings": [
    { "region": "CA", "avgPriceCentsPerKWh": 22.1, "volatilityIndex": 0.12, "trend": "rising" },
    { "region": "NY", "avgPriceCentsPerKWh": 18.0, "volatilityIndex": 0.08, "trend": "flat" }
  ],
  "top5": [ ... ],
  "notes": "Sector = ALL. Using last N monthly points."
}
```
- Complexity: Simple.

### 5) discoverElectricityRouteMetadata
- Description: Discovers frequencies, facets, and available data columns for a supported electricity route and optionally enumerates facet options for a specific facetId.
- Parameters (Zod):  
  - `route: enum("retail-sales", "electric-power-operational-data", "operating-generator-capacity", "state-electricity-profiles/summary", "rto/region-data")`  
  - `facetId?: string`
- Data sources:
  - Metadata endpoints (exist in `eia-api.d.ts`):  
    - `/v2/electricity/{route}`  
    - `/v2/electricity/{route}/facet`  
    - `/v2/electricity/{route}/facet/{facet_id}`
- Logic:
  - If `facetId` provided, return facet option details.  
  - Else return route metadata, extracting frequencies, facets, data columns (if provided), `startPeriod`, `endPeriod`.
- Output:
```json
{
  "route": "retail-sales",
  "info": {
    "frequencies": [ { "id": "monthly", "format": "YYYY-MM" }, ... ],
    "facets": [ { "id": "stateid" }, { "id": "sectorid" } ],
    "dataColumns": { "revenue": { "units": "million dollars" }, ... },
    "startPeriod": "2001-01",
    "endPeriod": "2025-06"
  }
}
```
(or, with facetId: `{ route, facetId, options: [...] }`)

- Complexity: Simple.

### Phase 2

#### 6) getRTODemandSnapshot
- Description: Provides recent RTO demand snapshot for a state, with daily peak/min, load factor, and ramp metrics for a lookback window.
- Parameters (Zod):  
  - `region: string` (length 2)  
  - `days: number` int, min 1, max 30, default 7
- Data sources:  
  - `ElectricityRepository.getRTODemandData(region)` (already fetches last 30 days * 24 hours capped at length 720)  
  - Endpoint: `/v2/electricity/rto/region-data/data` with `frequency=hourly`
- Logic:  
  - Slice to `days` without additional API calls.  
  - Compute average, daily peak/min, load factor (avg/peak), maxHourlyRamp, ramping frequency (>5% avg threshold).  
  - Optionally include derived `respondent` RTO code from internal mapping.
- Output:
```json
{
  "region": "TX",
  "rto": "ERC",
  "windowDays": 7,
  "metrics": {
    "avgDemandMW": 30000,
    "dailyPeakMW": 42000,
    "dailyMinMW": 18000,
    "loadFactor": 0.71,
    "maxHourlyRampMW": 2500,
    "rampingFrequencyPerDay": 3.6
  }
}
```
- Complexity: Medium (reuses existing repository behavior).

#### 7) estimateEmissionsIntensityByState
- Description: Estimates annual CO2 emissions intensity (kgCO2/MWh) per state using emissions-by-fuel and generation-by-fuel for a target year.
- Parameters (Zod):  
  - `region: string` (length 2)  
  - `year?: string` (YYYY)
- Data sources:  
  - Emissions: `/v2/electricity/state-electricity-profiles/emissions-by-state-by-fuel/data`  
  - Generation: `/v2/electricity/electric-power-operational-data/data`
- Implementation steps:  
  1. Metadata discovery for emissions dataset to confirm exact column IDs and units (e.g., whether field keys include `-units`).  
  2. Add precise Zod schema reflecting discovered fields; add `ElectricityRepository.getEmissionsByStateByFuel(stateId, year?)` with annual frequency and small `length`.  
  3. Aggregate emissions (convert to kg if needed) and net generation (MWh) for matching year.  
  4. Compute intensity = total_kgCO2 / total_MWh; group by fuel (coal, gas, oil, other).
- Output:
```json
{
  "region": "CA",
  "year": "2023",
  "total": { "kgCO2": 1.23e9, "MWh": 200e6, "intensityKgPerMWh": 6.15 },
  "byFuelGroup": { "coal": {...}, "gas": {...}, "oil": {...}, "other": {...} },
  "notes": "Units derived from EIA metadata; fields validated via schema."
}
```
- Complexity: Medium; 1–2 new schemas and 1 repository method.

## Repository and Schema Additions

- Phase 1: No new repository methods or schemas required; all tools reuse existing validated methods and analyzers.
- Phase 2:  
  - Add: `getEmissionsByStateByFuel(stateId: string, year?: string)` in `ElectricityRepository`.  
  - Add precise Zod schema for emissions-by-state-by-fuel (finalize from metadata discovery).  
  - Optional: helper to standardize units (kgCO2, MWh) using `*-units` fields.

## Error Handling, Auth, and Resource Management

- Auth:
  - Resolve `eiaApiKey` from `context.extraArgs.apiKey` or fallback to `config.eiaApiKey`.  
  - If missing, `throw new UserError(apiKeyErrorMessage)`.
- Resource Management:
  - `resourceManager.getResource(eiaApiKey, "EiaApiClient", async (key) => new EiaApiClient(key, config.eiaApiTimeout), async () => {})`
- Error handling:
  - Log internal errors with `logger.error`.  
  - Re-throw as `UserError` for user-facing messages where appropriate.  
  - Keep data requests conservative (`length` small, prefer metadata over full datasets).
- Return values:
  - Always return string (JSON.stringify for complex objects).

## Performance and Limits

- EIA API row limit: 5,000 rows (JSON). Our Phase 1 tools request limited, recent data.  
- Sorting by period desc and setting `length` avoids oversize responses.  
- RTO hourly fetch is capped in repository (length=720).

## Effort Estimate and Priority

- Phase 1 (~1–2 dev-days):
  - getStateElectricityProfileSummary — 0.25d  
  - getGenerationMixByState — 0.25d  
  - getCapacityAndUtilizationByState — 0.25d  
  - compareRetailElectricityPrices — 0.5d  
  - discoverElectricityRouteMetadata — 0.25d
- Phase 2 (~1–2 dev-days):
  - getRTODemandSnapshot — 0.5–0.75d  
  - estimateEmissionsIntensityByState — 1.0–1.25d

## Implementation Plan (Step-by-Step)

1) Phase 1 (now)
- Add Zod parameter schemas:
  - `StateOnlySchema`, `CompareRetailPricesSchema`, `DiscoverRouteMetadataSchema`.
- Register 5 tools in `src/index.ts`:
  - `getStateElectricityProfileSummary`
  - `getGenerationMixByState`
  - `getCapacityAndUtilizationByState`
  - `compareRetailElectricityPrices`
  - `discoverElectricityRouteMetadata`
- Import analyzers: `CapacityAnalyzer`, `ProfileAnalyzer`.
- Use existing repository methods to fetch data.
- Implement conservative computations and return well-structured JSON strings.
- Logging: info for start/finish, debug for inputs, warn for partial data, error for failures.

2) Phase 2 (follow-up)
- Add metadata discovery for emissions dataset; finalize Zod schema for emissions-by-state-by-fuel.
- Implement `ElectricityRepository.getEmissionsByStateByFuel`.
- Implement `getRTODemandSnapshot` (reusing fetched 30-day hourly) and `estimateEmissionsIntensityByState`.
- Add concise docs in `.nexus/features/` as needed.

## Considerations / Open Questions

- State→RTO mapping currently limited to { TX, CA, NY, IL, PA }. For broader coverage, expand mapping or accept explicit RTO input in future.
- Emissions unit consistency must be validated from metadata; schema and conversions should be explicit.
- For price trend calculations, deadband threshold (e.g., 0.1 cents/kWh) is a heuristic; can be configurable.

## AI Assistance Notes
- Model Used: Cline (TypeScript engineering protocol enforced)  
- Prompt: Plan and implement additional tools for mcp-eia, reusing existing validated code and EIA API v2.  
- Date Generated: 2025-08-11

## Related Nexus Documents
- Architecture: [System Overview](../architecture/system_overview.md)  
- Architecture: [Token Handling](../architecture/token_handling.md)  
- Architecture: [Resource Management](../architecture/resource_management.md)  
- Guides: [Adding Tools](../guides/adding_tools.md)
