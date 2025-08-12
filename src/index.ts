#!/usr/bin/env node

import { FastMCP, FastMCPSession, UserError } from "@missionsquad/fastmcp";
import { z } from "zod";
import { resourceManager } from "./resource-manager.js";
import { config, apiKeyErrorMessage } from "./config.js";
import { logger } from "./logger.js";
import { EiaApiClient } from "./services/eiaClient.js";
import { ElectricityRepository } from "./repositories/electricityRepository.js";
import { EnergyStorageAnalyzer } from "./analysis/energyStorageAnalyzer.js";
import {
  type EnergyStorageOpportunityMetrics,
  type RegionalAnalysisResult,
} from "./types/energyStorage.types.js";
import { CapacityAnalyzer } from "./analysis/capacityAnalyzer.js";
import { ProfileAnalyzer } from "./analysis/profileAnalyzer.js";

const server = new FastMCP({
  name: "mcp-eia",
  version: "1.0.0",
});

const GetRegionalCapacityMetricsSchema = z.object({
  region: z
    .string()
    .length(2, {
      message: "Region must be a two-letter state abbreviation (e.g., 'TX').",
    })
    .describe("The two-letter US state abbreviation (e.g., 'TX', 'CA')."),
});


const GetRegionalEnergyProfileSchema = z.object({
  region: z
    .string()
    .length(2, {
      message: "Region must be a two-letter state abbreviation (e.g., 'TX').",
    })
    .describe("The two-letter US state abbreviation (e.g., 'TX', 'CA')."),
});



const FindHighPotentialAreasSchema = z.object({
  regions: z
    .array(z.string().length(2))
    .min(1)
    .describe(
      "An array of two-letter US state abbreviations to analyze (e.g., ['TX', 'CA', 'FL'])."
    ),
  includeHourlyAnalysis: z
    .boolean()
    .default(false)
    .describe(
      "Whether to include hourly demand analysis (if available). This provides more accurate grid stability metrics but may slow down the analysis."
    ),
});

// =============== New Tool Schemas (Phase 1) ===============
const StateOnlySchema = z.object({
  region: z
    .string()
    .length(2, { message: "Region must be a two-letter state abbreviation (e.g., 'TX')." })
    .describe("The two-letter US state abbreviation (e.g., 'TX', 'CA')."),
});

const CompareRetailPricesSchema = z.object({
  regions: z
    .array(z.string().length(2))
    .min(2)
    .describe("Two-letter US state abbreviations to compare (min 2)."),
  months: z
    .number()
    .int()
    .min(3)
    .max(12)
    .default(12)
    .describe("Number of most recent monthly observations to analyze (3–12, default 12)."),
});

const DiscoverRouteMetadataSchema = z.object({
  route: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.enum([
      "retail-sales",
      "electric-power-operational-data",
      "operating-generator-capacity",
      "state-electricity-profiles/summary",
      "rto/region-data",
    ] as const)
  ).describe(
    "Electricity route to inspect for metadata or facet options. Allowed: 'retail-sales' | 'electric-power-operational-data' | 'operating-generator-capacity' | 'state-electricity-profiles/summary' | 'rto/region-data'."
  ),
  facetId: z.preprocess(
    (v) => (v === undefined ? undefined : String(v).trim()),
    z.string().optional()
  ).describe("Optional facet identifier to list options for (e.g., 'sectorid', 'stateid', 'fueltypeid', 'respondent', etc. — verify via route metadata)."),
});

// =============== Phase 2 Schema (no new endpoints; reuses existing repo) ===============
const RTODemandSnapshotSchema = z.object({
  region: z
    .string()
    .length(2, { message: "Region must be a two-letter state abbreviation (e.g., 'TX')." })
    .describe("Two-letter US state abbreviation (e.g., 'TX', 'CA'). Used to infer respondent if not provided."),
  respondent: z
    .string()
    .optional()
    .describe("Optional RTO respondent code (e.g., 'CISO', 'ERCO', 'NYIS', 'MISO', 'PJM', 'ISNE', 'SWPP'). If omitted, the server attempts to map from the region. Use discoverElectricityRouteMetadata with route 'rto/region-data' and facetId 'respondent' to list valid codes."),
  type: z
    .enum(["D", "NG", "DF"])
    .default("D")
    .describe("Series type: 'D' = Demand (default), 'NG' = Net Generation, 'DF' = Demand Forecast (where available)."),
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe("Number of most recent days to analyze from available hourly RTO demand (1–30, default 7)."),
});

server.addTool({
  name: "findHighPotentialEnergyStorageAreas",
  description:
    "Analyzes multiple states to identify regions with high potential for energy storage deployment based on grid capacity, renewable integration needs, demand patterns, and economic factors.\n\nExpected input (JSON):\n{\n  \"regions\": [\"TX\", \"CA\", \"FL\"],\n  \"includeHourlyAnalysis\": false\n}\n- regions: array of two-letter state codes (min 1)\n- includeHourlyAnalysis: optional boolean (default false). When true, tool includes RTO hourly demand where available (TX, CA, NY, IL, PA).",
  parameters: FindHighPotentialAreasSchema,
  execute: async (args, context) => {
    logger.info(
      `Executing 'findHighPotentialEnergyStorageAreas' for regions: ${args.regions.join(
        ", "
      )}`
    );
    
    const { apiKey: extraArgsApiKey } =
      (context.extraArgs as { apiKey?: string }) || {};
    const eiaApiKey = extraArgsApiKey || config.eiaApiKey;
    
    if (!eiaApiKey) {
      logger.error(
        `'findHighPotentialEnergyStorageAreas' failed: EIA API key missing.`
      );
      throw new UserError(apiKeyErrorMessage);
    }

    try {
      const apiClient = await resourceManager.getResource<EiaApiClient>(
        eiaApiKey,
        "EiaApiClient",
        async (key) => new EiaApiClient(key, config.eiaApiTimeout),
        async () => {}
      );
      
      const electricityRepo = new ElectricityRepository(apiClient);

      const results = await Promise.all(
        args.regions.map(async (region) => {
          try {
            logger.info(`Analyzing energy storage opportunities for ${region}`);
            
            // Fetch all required data in parallel
            const [
              capacityData,
              generationData,
              priceData,
              demandData
            ] = await Promise.all([
              electricityRepo.getCapacityByFuelType(region),
              electricityRepo.getGenerationByFuelType(region),
              electricityRepo.getRetailPrices(region),
              args.includeHourlyAnalysis 
                ? electricityRepo.getRTODemandData(region)
                : Promise.resolve([])
            ]);

            if (capacityData.length === 0) {
              return { region, error: "No capacity data found" };
            }

            // Analyze storage opportunities
            const metrics = await EnergyStorageAnalyzer.analyzeStorageOpportunity(
              region,
              capacityData,
              demandData,
              generationData,
              priceData
            );

            return {
              region,
              metrics
            };
          } catch (error: any) {
            logger.warn(
              `Analysis for region ${region} failed: ${error.message}`
            );
            return { region, error: error.message };
          }
        })
      );

      // Separate successful and failed analyses
      const successfulAnalyses = results.filter(
        (r): r is { region: string; metrics: EnergyStorageOpportunityMetrics } =>
          "metrics" in r && r.metrics !== undefined
      );
      
      const failedAnalyses = results.filter((r) => "error" in r);

      // Sort by overall opportunity score
      const sortedResults = successfulAnalyses.sort(
        (a, b) => (b.metrics?.storageOpportunityScore.overall ?? 0) - (a.metrics?.storageOpportunityScore.overall ?? 0)
      );

      // Create summary
      const summary = {
        analysisDate: new Date().toISOString(),
        regionsAnalyzed: args.regions.length,
        successfulAnalyses: successfulAnalyses.length,
        topOpportunities: sortedResults.slice(0, 3).map(r => ({
          region: r.region,
          overallScore: r.metrics?.storageOpportunityScore.overall,
          primaryDriver: identifyPrimaryDriver(r.metrics.storageOpportunityScore)
        }))
      };

      return JSON.stringify(
        {
          summary,
          detailedResults: sortedResults.map(r => r.metrics),
          failedRegions: failedAnalyses
        },
        null,
        2
      );
    } catch (error: any) {
      logger.error(
        `'findHighPotentialEnergyStorageAreas' tool failed: ${error.message}`,
        error
      );
      if (error instanceof UserError) throw error;
      throw new UserError(
        `Could not complete energy storage opportunity analysis. Reason: ${error.message}`
      );
    }
  },
});

function identifyPrimaryDriver(scores: EnergyStorageOpportunityMetrics['storageOpportunityScore']): string {
  const drivers = [
    { name: "Peak Shaving", score: scores.peakShavingScore },
    { name: "Renewable Integration", score: scores.renewableIntegrationScore },
    { name: "Grid Services", score: scores.gridServicesScore },
    { name: "Economic Arbitrage", score: scores.economicScore }
  ];
  
  return drivers.reduce((prev, current) => 
    current.score > prev.score ? current : prev
  ).name;
}

// =============================================================================
// New Tools (Phase 1)
// =============================================================================

// Helper: resolve API key and instantiate repository
async function getElectricityRepository(context: any): Promise<ElectricityRepository> {
  const { apiKey: extraArgsApiKey } = (context.extraArgs as { apiKey?: string }) || {};
  const eiaApiKey = extraArgsApiKey || config.eiaApiKey;

  if (!eiaApiKey) {
    logger.error(`Tool execution failed: EIA API key missing.`);
    throw new UserError(apiKeyErrorMessage);
  }

  const apiClient = await resourceManager.getResource<EiaApiClient>(
    eiaApiKey,
    "EiaApiClient",
    async (key) => new EiaApiClient(key, config.eiaApiTimeout),
    async () => {}
  );

  return new ElectricityRepository(apiClient);
}

function getTrend(latest: number | null | undefined, previous: number | null | undefined): "up" | "down" | "flat" {
  const l = typeof latest === "number" ? latest : 0;
  const p = typeof previous === "number" ? previous : 0;
  const absPrev = Math.abs(p);
  const delta = l - p;
  const threshold = absPrev > 0 ? absPrev * 0.01 : 1; // ~1% or absolute 1 unit fallback
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "flat";
}

function basicStats(values: number[]): { avg: number; stddev: number; cov: number } {
  if (!values.length) return { avg: 0, stddev: 0, cov: 0 };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  const cov = avg !== 0 ? stddev / avg : 0;
  return { avg, stddev, cov };
}

// 1) getStateElectricityProfileSummary
server.addTool({
  name: "getStateElectricityProfileSummary",
  description: "Returns a concise 5-year summary for a state's electricity profile with YoY deltas and trends.\n\nExpected input (JSON):\n{\n  \"region\": \"TX\"\n}",
  parameters: StateOnlySchema,
  execute: async (args, context) => {
    const region = args.region;
    logger.info(`Executing 'getStateElectricityProfileSummary' for region: ${region}`);
    try {
      const repo = await getElectricityRepository(context);
      const data = await repo.getStateElectricityProfile(region); // sorted desc, length 5

      // Expect most recent first
      const years: string[] = data.map(d => d.period);
      const [latest, previous] = [data[0], data[1]];

      const metrics = {
        "net-generation": {
          latest: latest?.["net-generation"] ?? null,
          yoyDelta: (latest?.["net-generation"] ?? 0) - (previous?.["net-generation"] ?? 0),
          trend: getTrend(latest?.["net-generation"] ?? null, previous?.["net-generation"] ?? null),
        },
        "total-retail-sales": {
          latest: latest?.["total-retail-sales"] ?? null,
          yoyDelta: (latest?.["total-retail-sales"] ?? 0) - (previous?.["total-retail-sales"] ?? 0),
          trend: getTrend(latest?.["total-retail-sales"] ?? null, previous?.["total-retail-sales"] ?? null),
        },
        "average-retail-price": {
          latest: latest?.["average-retail-price"] ?? null,
          yoyDelta: (latest?.["average-retail-price"] ?? 0) - (previous?.["average-retail-price"] ?? 0),
          trend: getTrend(latest?.["average-retail-price"] ?? null, previous?.["average-retail-price"] ?? null),
        },
      };

      return JSON.stringify(
        {
          region,
          analysisDate: new Date().toISOString(),
          years,
          metrics,
        },
        null,
        2
      );
    } catch (error: any) {
      logger.error(`'getStateElectricityProfileSummary' failed: ${error.message}`, error);
      if (error instanceof UserError) throw error;
      throw new UserError(`Failed to get state electricity profile summary for ${region}: ${error.message}`);
    }
  },
});

// 2) getGenerationMixByState
server.addTool({
  name: "getGenerationMixByState",
  description: "Summarizes the latest-period net generation by fuel type and shares (%) for a state.",
  parameters: StateOnlySchema,
  execute: async (args, context) => {
    const region = args.region;
    logger.info(`Executing 'getGenerationMixByState' for region: ${region}`);
    try {
      const repo = await getElectricityRepository(context);
      const generationData = await repo.getGenerationByFuelType(region);

      const period = generationData[0]?.period ?? "N/A";
      const summary = ProfileAnalyzer.summarizeGeneration(generationData);

      const totalNetGenerationGWh = Object.values(summary).reduce((sum, v) => sum + v.netGenerationGWh, 0);
      const byFuel: Record<string, { netGenerationGWh: number; sharePct: number; reportingUnits: number; description?: string }> = {};
      for (const [fuel, info] of Object.entries(summary)) {
        const sharePct = totalNetGenerationGWh > 0 ? parseFloat(((info.netGenerationGWh / totalNetGenerationGWh) * 100).toFixed(1)) : 0;
        byFuel[fuel] = {
          netGenerationGWh: info.netGenerationGWh,
          sharePct,
          reportingUnits: info.reportingUnits,
          description: (info as any).description,
        };
      }
      const dominantFuel = Object.entries(byFuel)
        .sort((a, b) => b[1].sharePct - a[1].sharePct)[0] || ["N/A", { sharePct: 0 } as any];

      return JSON.stringify(
        {
          region,
          period,
          totalNetGenerationGWh: parseFloat(totalNetGenerationGWh.toFixed(3)),
          byFuel,
          dominantFuel: { fuelType: dominantFuel[0], sharePct: dominantFuel[1].sharePct },
        },
        null,
        2
      );
    } catch (error: any) {
      logger.error(`'getGenerationMixByState' failed: ${error.message}`, error);
      if (error instanceof UserError) throw error;
      throw new UserError(`Failed to get generation mix for ${region}: ${error.message}`);
    }
  },
});

// 3) getCapacityAndUtilizationByState
server.addTool({
  name: "getCapacityAndUtilizationByState",
  description: "Reports aggregate summer/winter capacity and estimates recent capacity utilization using generation data.",
  parameters: StateOnlySchema,
  execute: async (args, context) => {
    const region = args.region;
    logger.info(`Executing 'getCapacityAndUtilizationByState' for region: ${region}`);
    try {
      const repo = await getElectricityRepository(context);
      const [capacityData, generationData] = await Promise.all([
        repo.getOperatingCapacityByState(region),
        repo.getGenerationByFuelType(region),
      ]);

      const capacityMetrics = CapacityAnalyzer.calculateRegionalMetrics(region, capacityData);
      const util = CapacityAnalyzer.calculateCapacityUtilization(capacityMetrics, generationData);

      return JSON.stringify(
        {
          region,
          latestPeriod: capacityMetrics.latestPeriod,
          totalSummerCapacityMW: capacityMetrics.totalSummerCapacityMW,
          totalWinterCapacityMW: capacityMetrics.totalWinterCapacityMW,
          utilization: {
            ratio: util.utilization,
            totalGenerationGWh: util.totalGenerationGWh,
            totalConsumptionGWh: util.totalConsumptionGWh,
          },
        },
        null,
        2
      );
    } catch (error: any) {
      logger.error(`'getCapacityAndUtilizationByState' failed: ${error.message}`, error);
      if (error instanceof UserError) throw error;
      throw new UserError(`Failed to get capacity/utilization for ${region}: ${error.message}`);
    }
  },
});

// 4) compareRetailElectricityPrices
server.addTool({
  name: "compareRetailElectricityPrices",
  description: "Compares most recent N monthly average retail electricity prices across states (sector ALL), with volatility and trend.",
  parameters: CompareRetailPricesSchema,
  execute: async (args, context) => {
    const regions = args.regions;
    logger.info(`Executing 'compareRetailElectricityPrices' for regions: ${regions.join(", ")}, months=${args.months}`);
    try {
      const repo = await getElectricityRepository(context);

      const results = await Promise.all(
        regions.map(async (region) => {
          try {
            const priceData = await repo.getRetailPrices(region); // last 12 months (sector ALL)
            const sliced = priceData.slice(0, args.months);
            if (!sliced.length) {
              return { region, error: "No price data" };
            }
            const prices = sliced.map(p => p.price ?? 0);
            const { avg, cov } = basicStats(prices);
            const latest = prices[0] ?? 0;
            const oldest = prices[prices.length - 1] ?? 0;
            const delta = latest - oldest;
            const deadband = 0.1; // cents/kWh
            const trend = delta > deadband ? "rising" : delta < -deadband ? "falling" : "flat";
            return {
              region,
              avgPriceCentsPerKWh: parseFloat(avg.toFixed(2)),
              volatilityIndex: parseFloat(cov.toFixed(3)),
              trend,
            };
          } catch (e: any) {
            logger.warn(`Price comparison for ${region} failed: ${e.message}`);
            return { region, error: e.message };
          }
        })
      );

      const ok = results.filter(r => !(r as any).error) as Array<{
        region: string; avgPriceCentsPerKWh: number; volatilityIndex: number; trend: string;
      }>;
      const failed = results.filter(r => (r as any).error);

      const rankings = ok.sort((a, b) => b.avgPriceCentsPerKWh - a.avgPriceCentsPerKWh);
      const top5 = rankings.slice(0, 5);

      return JSON.stringify(
        {
          analysisDate: new Date().toISOString(),
          monthsAnalyzed: args.months,
          rankings,
          top5,
          failedRegions: failed,
          notes: "Sector = ALL. Using the most recent N monthly observations returned by EIA.",
        },
        null,
        2
      );
    } catch (error: any) {
      logger.error(`'compareRetailElectricityPrices' failed: ${error.message}`, error);
      if (error instanceof UserError) throw error;
      throw new UserError(`Failed to compare retail electricity prices: ${error.message}`);
    }
  },
});

// 5) discoverElectricityRouteMetadata
server.addTool({
  name: "discoverElectricityRouteMetadata",
  description: "Discovers route metadata (frequencies, facets, data columns, date range) or facet options for a given electricity route.\n\nParameters (JSON):\n{\n  \"route\": \"retail-sales\" | \"electric-power-operational-data\" | \"operating-generator-capacity\" | \"state-electricity-profiles/summary\" | \"rto/region-data\",\n  \"facetId\"?: string // optional facet to enumerate (e.g., \"sectorid\", \"stateid\", etc.)\n}\n\nExamples:\n1) Get route metadata (structure, facets, date range):\n{\n  \"route\": \"retail-sales\"\n}\n\n2) List allowed values for a facet under a route:\n{\n  \"route\": \"retail-sales\",\n  \"facetId\": \"sectorid\"\n}\n\n3) Inspect generation operational dataset to understand available facets/data:\n{\n  \"route\": \"electric-power-operational-data\"\n}\n\n4) Inspect the generator capacity dataset:\n{\n  \"route\": \"operating-generator-capacity\"\n}\n\nNotes:\n- Provide EIA API key via extraArgs.apiKey or environment variable EIA_API_KEY.\n- Without facetId, returns metadata for the route (frequencies, facets, data, startPeriod, endPeriod).\n- With facetId, returns concrete facet options (codes and names) for that route.\n",
  parameters: DiscoverRouteMetadataSchema,
  execute: async (args, context) => {
    logger.info(`Executing 'discoverElectricityRouteMetadata' for route: ${args.route}${args.facetId ? `, facetId=${args.facetId}` : ""}`);
    try {
      // Resolve API key and create a raw client (no repository needed)
      const { apiKey: extraArgsApiKey } = (context.extraArgs as { apiKey?: string }) || {};
      const eiaApiKey = extraArgsApiKey || config.eiaApiKey;
      if (!eiaApiKey) {
        logger.error(`'discoverElectricityRouteMetadata' failed: EIA API key missing.`);
        throw new UserError(apiKeyErrorMessage);
      }
      const apiClient = await resourceManager.getResource<EiaApiClient>(
        eiaApiKey,
        "EiaApiClient",
        async (key) => new EiaApiClient(key, config.eiaApiTimeout),
        async () => {}
      );

      const basePath = (() => {
        switch (args.route) {
          case "retail-sales":
            return "/v2/electricity/retail-sales" as const;
          case "electric-power-operational-data":
            return "/v2/electricity/electric-power-operational-data" as const;
          case "operating-generator-capacity":
            return "/v2/electricity/operating-generator-capacity" as const;
          case "state-electricity-profiles/summary":
            return "/v2/electricity/state-electricity-profiles/summary" as const;
          case "rto/region-data":
            return "/v2/electricity/rto/region-data" as const;
          default:
            throw new UserError(`Unsupported route: ${args.route}`);
        }
      })();

      if (args.facetId) {
        const facetPath = `${basePath}/facet/${args.facetId}` as any;
        const facetResp = (await apiClient.get(facetPath)) as any;
        return JSON.stringify(
          {
            route: args.route,
            facetId: args.facetId,
            response: facetResp?.response ?? facetResp,
          },
          null,
          2
        );
      } else {
        const metaResp = (await apiClient.get(basePath as any)) as any;
        return JSON.stringify(
          {
            route: args.route,
            response: metaResp?.response ?? metaResp,
          },
          null,
          2
        );
      }
    } catch (error: any) {
      logger.error(`'discoverElectricityRouteMetadata' failed: ${error.message}`, error);
      if (error instanceof UserError) throw error;
      throw new UserError(`Failed to discover route metadata: ${error.message}`);
    }
  },
});

/**
 * Phase 2: getRTODemandSnapshot
 * Uses ElectricityRepository.getRTODemandData (hourly, last 30 days capped) and computes basic window statistics.
 */
// server.addTool({
//   name: "getRTODemandSnapshot",
//   description: "Computes recent RTO demand metrics over a lookback window (avg, peak/min, load factor, max hourly ramp, ramp frequency).\n\nParameters (JSON):\n{\n  \"region\": \"TX\",            // required two-letter state code\n  \"respondent\"?: \"ERCO\",      // optional respondent (e.g., CISO, ERCO, NYIS, MISO, PJM, ISNE, SWPP)\n  \"type\"?: \"D\",               // optional series type: 'D' (Demand, default), 'NG' (Net Generation), 'DF' (Day-ahead Demand Forecast)\n  \"days\"?: 7                    // optional window (1–30), default 7\n}\n\nExamples (verified against EIA facets):\n1) Region-only (auto-map respondent):\n{\n  \"region\": \"CA\",\n  \"days\": 7\n}\n\n2) Explicit respondent (ERCOT), Demand over 14 days:\n{\n  \"region\": \"TX\",\n  \"respondent\": \"ERCO\",\n  \"type\": \"D\",\n  \"days\": 14\n}\n\n3) Explicit respondent (CAISO), Net Generation (fallback if Demand sparse):\n{\n  \"region\": \"CA\",\n  \"respondent\": \"CISO\",\n  \"type\": \"NG\",\n  \"days\": 7\n}\n\n4) Explicit respondent (PJM), Demand over 7 days:\n{\n  \"region\": \"PA\",\n  \"respondent\": \"PJM\",\n  \"type\": \"D\",\n  \"days\": 7\n}\n\nNotes:\n- Enumerate valid respondents and types first via discoverElectricityRouteMetadata with route 'rto/region-data' and facetId 'respondent' or 'type'.\n- If type 'D' returns sparse/empty data for a window, try 'NG' or increase 'days' up to 30. Results include a clarifying note when numeric hourly values are unavailable.",
//   parameters: RTODemandSnapshotSchema,
//   execute: async (args, context) => {
//     logger.info(`Executing 'getRTODemandSnapshot' for region: ${args.region}, respondent=${args.respondent ?? 'auto'}, days=${args.days}`);
//     try {
//       const repo = await getElectricityRepository(context);
//       const data = await repo.getRTODemandData(args.region, args.respondent, args.type ?? "D"); // sorted by period desc, length <= 720

//       if (!data.length) {
//         return JSON.stringify(
//           {
//             region: args.region,
//             respondent: args.respondent ?? null,
//             windowDays: args.days,
//             note: "No RTO mapping (for region-only) or no demand data available for this selection. Use discoverElectricityRouteMetadata (route: 'rto/region-data', facetId: 'respondent') to list valid respondents.",
//           },
//           null,
//           2
//         );
//       }

//       const rto = data[0]?.respondent ?? args.respondent ?? null;

//       // Take most recent N days in hours (approx by count; data is desc)
//       const count = Math.min(args.days * 24, data.length);
//       const window = data.slice(0, count);

//       // Build numeric series (filter out nulls / non-finite)
//       const series = window
//         .map((d) => (typeof d.value === "number" && Number.isFinite(d.value) ? d.value : null))
//         .filter((v): v is number => v !== null);

//       if (series.length < 2) {
//         return JSON.stringify(
//           {
//             region: args.region,
//             respondent: rto,
//             windowDays: args.days,
//             note: "No numeric hourly demand values available for the selected window. Try a different respondent or a larger 'days' window.",
//           },
//           null,
//           2
//         );
//       }

//       const avg = series.reduce((a, b) => a + b, 0) / series.length;
//       const peak = Math.max(...series);
//       const min = Math.min(...series);
//       const loadFactor = peak > 0 ? avg / peak : 0;

//       // Hourly ramps
//       const ramps: number[] = [];
//       for (let i = 1; i < series.length; i++) {
//         ramps.push(Math.abs(series[i] - series[i - 1]));
//       }
//       const maxHourlyRamp = ramps.length ? Math.max(...ramps) : 0;

//       const threshold = avg * 0.05; // significant ramp >5% of average
//       const significantRamps = ramps.filter((r) => r > threshold).length;
//       const rampingFrequencyPerDay = (significantRamps / series.length) * 24;

//       return JSON.stringify(
//         {
//           region: args.region,
//           respondent: rto,
//           windowDays: args.days,
//           metrics: {
//             avgDemandMW: Math.round(avg),
//             dailyPeakMW: Math.round(peak),
//             dailyMinMW: Math.round(min),
//             loadFactor: parseFloat(loadFactor.toFixed(3)),
//             maxHourlyRampMW: Math.round(maxHourlyRamp),
//             rampingFrequencyPerDay: parseFloat(rampingFrequencyPerDay.toFixed(2)),
//           },
//         },
//         null,
//         2
//       );
//     } catch (error: any) {
//       logger.error(`'getRTODemandSnapshot' failed: ${error.message}`, error);
//       if (error instanceof UserError) throw error;
//       throw new UserError(`Failed to compute RTO demand snapshot for ${args.region}: ${error.message}`);
//     }
//   },
// });

// =============================================================================
// Server Lifecycle and Event Handling
// =============================================================================

// Define event types based on FastMCPEvents and our SessionAuthType
// The event parameter for connect/disconnect is { session: FastMCPSession<ErCOTMCPSessionAuth> }

server.on('connect', (event: { session: FastMCPSession<any> }) => {
  // clientId is not directly available on the event object or session as per FastMCP.ts definition.
  // If needed, it would have to be part of ErCOTMCPSessionAuth and accessed via event.session.auth.
  // Since ErCOTMCPSessionAuth is undefined, clientId cannot be accessed this way.
  // The FastMCPSession.server object (from @modelcontextprotocol/sdk) also does not have a public 'sessionId' property.
  logger.info(`Client connected. Session object available.`)
  // Example: logger.info(`Client connected. Session Auth: ${JSON.stringify(event.session.auth)}`)
})

server.on('disconnect', (event: { session: FastMCPSession<any> }) => {
  // Similar to 'connect', clientId is not directly available.
  // The FastMCPSession.server object also does not have a public 'sessionId' property.
  logger.info(`Client disconnected. Session object available.`)
})

// The FastMCP class itself does not emit an 'error' event in FastMCPEvents.
// Individual FastMCPSession objects emit 'error' events.
// To handle errors from the main server instance, a different mechanism or library modification would be needed.
// Commenting out this handler as it's incompatible with the strict event typing of FastMCP.
/*
server.on('error', (error: Error) => {
  logger.error('FastMCP Server error:', error)
})
*/

const cleanup = () => {
  logger.info("Shutting down server and cleaning up resources...");
  resourceManager.destroyAllNow();
  logger.info("Resource cleanup complete.");
};

process.on("SIGINT", () => {
  logger.info("Received SIGINT signal.");
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM signal.");
  cleanup();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  logger.error("UNCAUGHT EXCEPTION:", error);
  cleanup();
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("UNHANDLED REJECTION:", reason);
  cleanup();
  process.exit(1);
});

// =============================================================================
// Start the Server
// =============================================================================

server
  .start({
    transportType: "stdio",
  })
  .then(() => {
    logger.info(
      `🚀 ${server.options.name} v${server.options.version} started successfully on stdio.`
    );
  })
  .catch((error) => {
    logger.error("❌ Failed to start MCP server:", error);
    process.exit(1);
  });
