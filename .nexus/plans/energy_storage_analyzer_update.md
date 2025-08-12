# Comprehensive Plan: Energy Storage Opportunity Analyzer Update

## Overview
Transform the current `findHighPotentialEnergyStorageAreas` tool from a simple capacity utilization calculator to a comprehensive energy storage opportunity analyzer that provides meaningful metrics for identifying regions with high potential for energy storage deployment.

## Architecture Design

### 1. New Data Structures

**File:** `src/types/energyStorage.types.ts`

```typescript
// src/types/energyStorage.types.ts
export interface EnergyStorageOpportunityMetrics {
  region: string;
  analysisDate: string;
  
  // Grid Capacity Metrics
  gridCapacity: {
    totalCapacityMW: number;
    renewableCapacityMW: number;
    fossilCapacityMW: number;
    renewablePenetration: number; // percentage
  };
  
  // Demand & Supply Patterns
  demandSupplyMetrics: {
    averageDemandMW: number;
    peakDemandMW: number;
    minimumDemandMW: number;
    loadFactor: number; // avg/peak ratio
    demandVariabilityIndex: number; // coefficient of variation
  };
  
  // Renewable Integration Metrics
  renewableIntegration: {
    solarCapacityMW: number;
    windCapacityMW: number;
    estimatedCurtailmentMWh: number;
    renewableVariabilityIndex: number;
    duckCurveSeverity: number; // 0-1 scale
  };
  
  // Grid Stability Indicators
  gridStability: {
    maxHourlyRampMW: number;
    rampingFrequency: number; // ramps per day
    frequencyRegulationNeed: number; // MW of regulation needed
    spinningReserveRequirement: number; // MW
  };
  
  // Economic Indicators
  economicOpportunity: {
    averageRetailPriceCentsPerKWh: number;
    priceVolatilityIndex: number;
    peakOffPeakSpread: number; // $/MWh
    estimatedArbitrageRevenue: number; // $/MW-year
  };
  
  // Storage Opportunity Score
  storageOpportunityScore: {
    overall: number; // 0-100
    peakShavingScore: number; // 0-100
    renewableIntegrationScore: number; // 0-100
    gridServicesScore: number; // 0-100
    economicScore: number; // 0-100
  };
}

export interface RegionalAnalysisResult {
  region: string;
  metrics?: EnergyStorageOpportunityMetrics;
  error?: string;
}
```

### 2. New Repository Methods

**File:** `src/repositories/electricityRepository.ts`

```typescript
// Add to src/repositories/electricityRepository.ts

// Get state electricity profile summary data
public async getStateElectricityProfile(stateId: string): Promise<StateProfileData[]> {
  const endpoint = "/v2/electricity/state-electricity-profiles/summary/data" as const;
  
  const response = await this.apiClient.get(endpoint, {
    frequency: "annual",
    facets: {
      stateid: [stateId],
    },
    data: ["total-electric-power-industry", "total-consumption", "net-interstate-flow-of-electricity"],
    sort: [{ column: "period", direction: "desc" }],
    length: 5,
  });
  
  return this.parseAndValidate(
    response,
    StateProfileResponseSchema,
    "getStateElectricityProfile"
  );
}

// Get hourly demand data from RTO if available
public async getRTODemandData(stateId: string): Promise<RTODemandData[]> {
  const endpoint = "/v2/electricity/rto/region-data/data" as const;
  
  // Map state to RTO region (this mapping needs to be maintained)
  const rtoRegion = this.mapStateToRTO(stateId);
  if (!rtoRegion) return [];
  
  const response = await this.apiClient.get(endpoint, {
    frequency: "hourly",
    facets: {
      respondent: [rtoRegion],
      type: ["D"], // Demand
    },
    start: this.getStartDate(30), // Last 30 days
    sort: [{ column: "period", direction: "desc" }],
    length: 720, // 30 days * 24 hours
  });
  
  return this.parseAndValidate(
    response,
    RTODemandResponseSchema,
    "getRTODemandData"
  );
}

// Get capacity by fuel type for renewable analysis
public async getCapacityByFuelType(stateId: string): Promise<CapacityByFuelData[]> {
  const endpoint = "/v2/electricity/operating-generator-capacity/data" as const;
  
  const response = await this.apiClient.get(endpoint, {
    frequency: "annual",
    facets: {
      stateid: [stateId],
    },
    data: ["net-summer-capacity-mw", "net-winter-capacity-mw"],
    sort: [{ column: "period", direction: "desc" }],
    length: 5000,
  });
  
  // The API returns plant-level data, so we need to aggregate it
  const plantData = this.parseAndValidate(
    response,
    OperatingCapacityResponseSchema,
    "getCapacityByFuelType"
  );

  // Aggregate by energy_source_code
  const capacityByFuel: Record<string, CapacityByFuelData> = {};
  for (const plant of plantData) {
    const fuelType = plant.energy_source_code;
    if (!capacityByFuel[fuelType]) {
      capacityByFuel[fuelType] = {
        period: plant.period.substring(0, 4), // Annual
        stateid: plant.stateid,
        energy_source_code: fuelType,
        "net-summer-capacity-mw": 0,
        "net-winter-capacity-mw": 0,
      };
    }
    capacityByFuel[fuelType]["net-summer-capacity-mw"]! += plant["net-summer-capacity-mw"] || 0;
    capacityByFuel[fuelType]["net-winter-capacity-mw"]! += plant["net-winter-capacity-mw"] || 0;
  }

  return Object.values(capacityByFuel);
}

// Get retail electricity prices
public async getRetailPrices(stateId: string): Promise<RetailPriceData[]> {
  const endpoint = "/v2/electricity/retail-sales/data" as const;
  
  const response = await this.apiClient.get(endpoint, {
    frequency: "monthly",
    facets: {
      stateid: [stateId],
      sectorid: ["ALL"], // All sectors
    },
    data: ["price", "sales"],
    sort: [{ column: "period", direction: "desc" }],
    length: 12, // Last 12 months
  });
  
  return this.parseAndValidate(
    response,
    RetailPriceResponseSchema,
    "getRetailPrices"
  );
}

// Helper method to map states to RTO regions
private mapStateToRTO(stateId: string): string | null {
  const stateToRTO: Record<string, string> = {
    "TX": "ERC", // ERCOT
    "CA": "CAL", // CAISO
    "NY": "NYIS", // NYISO
    "IL": "MIDA", // MISO
    "PA": "PJM", // PJM
    // Add more mappings as needed
  };
  return stateToRTO[stateId] || null;
}

private getStartDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}
```

### 3. New Analyzer Classes

**File:** `src/analysis/energyStorageAnalyzer.ts`

```typescript
// src/analysis/energyStorageAnalyzer.ts
import { logger } from '../logger.js';
import type { 
  EnergyStorageOpportunityMetrics,
  GridCapacityMetrics,
  DemandSupplyMetrics,
  RenewableIntegrationMetrics,
  GridStabilityMetrics,
  EconomicMetrics,
  StorageOpportunityScore
} from '../types/energyStorage.types.js';

export class EnergyStorageAnalyzer {
  
  public static async analyzeStorageOpportunity(
    region: string,
    capacityData: CapacityData[],
    demandData: DemandData[],
    generationData: GenerationData[],
    priceData: PriceData[]
  ): Promise<EnergyStorageOpportunityMetrics> {
    
    // Calculate individual metric categories
    const gridCapacity = this.calculateGridCapacityMetrics(capacityData);
    const demandSupply = this.calculateDemandSupplyMetrics(demandData, generationData);
    const renewableIntegration = this.calculateRenewableMetrics(capacityData, generationData);
    const gridStability = this.calculateGridStabilityMetrics(demandData);
    const economicOpportunity = this.calculateEconomicMetrics(priceData, demandSupply);
    
    // Calculate composite scores
    const storageOpportunityScore = this.calculateOpportunityScores(
      gridCapacity,
      demandSupply,
      renewableIntegration,
      gridStability,
      economicOpportunity
    );
    
    return {
      region,
      analysisDate: new Date().toISOString(),
      gridCapacity,
      demandSupplyMetrics: demandSupply,
      renewableIntegration,
      gridStability,
      economicOpportunity,
      storageOpportunityScore
    };
  }
  
  private static calculateGridCapacityMetrics(capacityData: CapacityData[]): GridCapacityMetrics {
    const renewableSources = ['SUN', 'WND', 'HYD', 'GEO', 'BIO', 'WAS'];
    const fossilSources = ['NG', 'COL', 'PET', 'OTH'];
    
    let totalCapacity = 0;
    let renewableCapacity = 0;
    let fossilCapacity = 0;
    
    // Group by fuel type and sum capacities
    const latestPeriod = capacityData[0]?.period;
    const latestData = capacityData.filter(d => d.period === latestPeriod);
    
    for (const record of latestData) {
      const capacity = record['net-summer-capacity-mw'] || 0;
      totalCapacity += capacity;
      
      if (renewableSources.includes(record.energy_source_code)) {
        renewableCapacity += capacity;
      } else if (fossilSources.includes(record.energy_source_code)) {
        fossilCapacity += capacity;
      }
    }
    
    return {
      totalCapacityMW: Math.round(totalCapacity),
      renewableCapacityMW: Math.round(renewableCapacity),
      fossilCapacityMW: Math.round(fossilCapacity),
      renewablePenetration: totalCapacity > 0 ? 
        Math.round((renewableCapacity / totalCapacity) * 100) : 0
    };
  }
  
  private static calculateDemandSupplyMetrics(
    demandData: DemandData[],
    generationData: GenerationData[]
  ): DemandSupplyMetrics {
    if (!demandData.length) {
      // Fallback to generation data if no demand data
      const totalGen = generationData.reduce((sum, g) => sum + (g.generation || 0), 0);
      const avgGen = totalGen / generationData.length;
      
      return {
        averageDemandMW: Math.round(avgGen),
        peakDemandMW: Math.round(avgGen * 1.2), // Estimate
        minimumDemandMW: Math.round(avgGen * 0.6), // Estimate
        loadFactor: 0.7, // Typical value
        demandVariabilityIndex: 0.15 // Typical value
      };
    }
    
    const demands = demandData.map(d => d.value);
    const avgDemand = demands.reduce((a, b) => a + b, 0) / demands.length;
    const peakDemand = Math.max(...demands);
    const minDemand = Math.min(...demands);
    
    // Calculate standard deviation for variability
    const variance = demands.reduce((sum, d) => sum + Math.pow(d - avgDemand, 2), 0) / demands.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / avgDemand;
    
    return {
      averageDemandMW: Math.round(avgDemand),
      peakDemandMW: Math.round(peakDemand),
      minimumDemandMW: Math.round(minDemand),
      loadFactor: parseFloat((avgDemand / peakDemand).toFixed(3)),
      demandVariabilityIndex: parseFloat(coefficientOfVariation.toFixed(3))
    };
  }
  
  private static calculateRenewableMetrics(
    capacityData: CapacityData[],
    generationData: GenerationData[]
  ): RenewableIntegrationMetrics {
    const latestPeriod = capacityData[0]?.period;
    const latestCapacity = capacityData.filter(d => d.period === latestPeriod);
    
    const solarCapacity = latestCapacity
      .filter(d => d.energy_source_code === 'SUN')
      .reduce((sum, d) => sum + (d['net-summer-capacity-mw'] || 0), 0);
      
    const windCapacity = latestCapacity
      .filter(d => d.energy_source_code === 'WND')
      .reduce((sum, d) => sum + (d['net-summer-capacity-mw'] || 0), 0);
    
    // Estimate curtailment based on renewable capacity and typical curtailment rates
    const totalRenewableCapacity = solarCapacity + windCapacity;
    const estimatedCurtailmentRate = 0.03; // 3% typical curtailment
    const hoursPerYear = 8760;
    const capacityFactor = 0.35; // Typical renewable capacity factor
    const estimatedCurtailment = totalRenewableCapacity * hoursPerYear * capacityFactor * estimatedCurtailmentRate;
    
    // Calculate duck curve severity (0-1 scale)
    // Higher solar penetration = more severe duck curve
    const solarPenetration = solarCapacity / (solarCapacity + windCapacity + 1); // Avoid division by zero
    const duckCurveSeverity = Math.min(solarPenetration * 2, 1); // Scale up and cap at 1
    
    return {
      solarCapacityMW: Math.round(solarCapacity),
      windCapacityMW: Math.round(windCapacity),
      estimatedCurtailmentMWh: Math.round(estimatedCurtailment),
      renewableVariabilityIndex: parseFloat((0.4 + solarPenetration * 0.3).toFixed(3)), // Higher for solar
      duckCurveSeverity: parseFloat(duckCurveSeverity.toFixed(3))
    };
  }
  
  private static calculateGridStabilityMetrics(demandData: DemandData[]): GridStabilityMetrics {
    if (!demandData.length || demandData.length < 2) {
      // Return typical values if no hourly data
      return {
        maxHourlyRampMW: 500,
        rampingFrequency: 4,
        frequencyRegulationNeed: 100,
        spinningReserveRequirement: 300
      };
    }
    
    // Calculate hourly ramps
    const ramps: number[] = [];
    for (let i = 1; i < demandData.length; i++) {
      const ramp = Math.abs(demandData[i].value - demandData[i-1].value);
      ramps.push(ramp);
    }
    
    const maxRamp = Math.max(...ramps);
    const avgDemand = demandData.reduce((sum, d) => sum + d.value, 0) / demandData.length;
    
    // Count significant ramps (> 5% of average demand)
    const significantRampThreshold = avgDemand * 0.05;
    const significantRamps = ramps.filter(r => r > significantRampThreshold).length;
    const rampingFrequency = (significantRamps / demandData.length) * 24; // Ramps per day
    
    // Estimate regulation and reserve needs
    const frequencyRegulation = avgDemand * 0.01; // 1% of average demand
    const spinningReserve = maxRamp * 0.5; // 50% of max ramp
    
    return {
      maxHourlyRampMW: Math.round(maxRamp),
      rampingFrequency: parseFloat(rampingFrequency.toFixed(1)),
      frequencyRegulationNeed: Math.round(frequencyRegulation),
      spinningReserveRequirement: Math.round(spinningReserve)
    };
  }
  
  private static calculateEconomicMetrics(
    priceData: PriceData[],
    demandSupply: DemandSupplyMetrics
  ): EconomicMetrics {
    if (!priceData.length) {
      return {
        averageRetailPriceCentsPerKWh: 10, // Default US average
        priceVolatilityIndex: 0.15,
        peakOffPeakSpread: 50,
        estimatedArbitrageRevenue: 50000
      };
    }
    
    const prices = priceData.map(p => p.price);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    // Calculate price volatility
    const priceVariance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
    const priceStdDev = Math.sqrt(priceVariance);
    const priceVolatility = priceStdDev / avgPrice;
    
    // Estimate peak/off-peak spread (simplified)
    const peakOffPeakSpread = avgPrice * 0.5 * 10; // Convert to $/MWh and apply typical spread
    
    // Estimate arbitrage revenue (simplified model)
    // Assume 4-hour storage, 1 cycle per day, 85% efficiency
    const storageMW = 100; // Base calculation on 100MW system
    const storageHours = 4;
    const cyclesPerYear = 300; // Account for maintenance
    const efficiency = 0.85;
    const arbitrageRevenue = peakOffPeakSpread * storageHours * cyclesPerYear * efficiency;
    
    return {
      averageRetailPriceCentsPerKWh: parseFloat(avgPrice.toFixed(2)),
      priceVolatilityIndex: parseFloat(priceVolatility.toFixed(3)),
      peakOffPeakSpread: Math.round(peakOffPeakSpread),
      estimatedArbitrageRevenue: Math.round(arbitrageRevenue)
    };
  }
  
  private static calculateOpportunityScores(
    gridCapacity: GridCapacityMetrics,
    demandSupply: DemandSupplyMetrics,
    renewable: RenewableIntegrationMetrics,
    stability: GridStabilityMetrics,
    economic: EconomicMetrics
  ): StorageOpportunityScore {
    
    // Peak Shaving Score (0-100)
    // Based on load factor and demand variability
    const peakShavingScore = Math.round(
      (1 - demandSupply.loadFactor) * 50 + // Lower load factor = higher score
      demandSupply.demandVariabilityIndex * 200 // Higher variability = higher score
    );
    
    // Renewable Integration Score (0-100)
    // Based on renewable penetration, curtailment, and duck curve
    const renewableScore = Math.round(
      gridCapacity.renewablePenetration * 0.5 + // Higher penetration = higher score
      renewable.duckCurveSeverity * 30 + // Severe duck curve = higher score
      Math.min(renewable.estimatedCurtailmentMWh / 10000, 1) * 20 // More curtailment = higher score
    );
    
    // Grid Services Score (0-100)
    // Based on ramping needs and stability requirements
    const gridServicesScore = Math.round(
      Math.min(stability.maxHourlyRampMW / 1000, 1) * 40 + // Higher ramps = higher score
      Math.min(stability.rampingFrequency / 10, 1) * 30 + // More frequent ramps = higher score
      Math.min(stability.frequencyRegulationNeed / 500, 1) * 30 // Higher regulation need = higher score
    );
    
    // Economic Score (0-100)
    // Based on price levels, volatility, and arbitrage opportunity
    const economicScore = Math.round(
      Math.min(economic.averageRetailPriceCentsPerKWh / 20, 1) * 30 + // Higher prices = higher score
      economic.priceVolatilityIndex * 100 + // Higher volatility = higher score
      Math.min(economic.estimatedArbitrageRevenue / 100000, 1) * 40 // Higher revenue = higher score
    );
    
    // Overall Score (weighted average)
    const overallScore = Math.round(
      peakShavingScore * 0.25 +
      renewableScore * 0.35 + // Renewable integration weighted highest
      gridServicesScore * 0.20 +
      economicScore * 0.20
    );
    
    return {
      overall: Math.min(Math.max(overallScore, 0), 100),
      peakShavingScore: Math.min(Math.max(peakShavingScore, 0), 100),
      renewableIntegrationScore: Math.min(Math.max(renewableScore, 0), 100),
      gridServicesScore: Math.min(Math.max(gridServicesScore, 0), 100),
      economicScore: Math.min(Math.max(economicScore, 0), 100)
    };
  }
}
```

### 4. Updated Tool Implementation

**File:** `src/index.ts`

```typescript
// Update in src/index.ts

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

server.addTool({
  name: "findHighPotentialEnergyStorageAreas",
  description:
    "Analyzes multiple states to identify regions with high potential for energy storage deployment based on grid capacity, renewable integration needs, demand patterns, and economic factors.",
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
      const analyzer = new EnergyStorageAnalyzer();

      const results = await Promise.all(
        args.regions.map(async (region) => {
          try {
            logger.info(`Analyzing energy storage opportunities for ${region}`);
            
            // Fetch all required data in parallel
            const [
              capacityData,
              generationData,
              priceData,
              profileData,
              demandData
            ] = await Promise.all([
              electricityRepo.getCapacityByFuelType(region),
              electricityRepo.getGenerationByFuelType(region),
              electricityRepo.getRetailPrices(region),
              electricityRepo.getStateElectricityProfile(region),
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
          !("error" in r)
      );
      
      const failedAnalyses = results.filter((r) => "error" in r);

      // Sort by overall opportunity score
      const sortedResults = successfulAnalyses.sort(
        (a, b) => b.metrics.storageOpportunityScore.overall - a.metrics.storageOpportunityScore.overall
      );

      // Create summary
      const summary = {
        analysisDate: new Date().toISOString(),
        regionsAnalyzed: args.regions.length,
        successfulAnalyses: successfulAnalyses.length,
        topOpportunities: sortedResults.slice(0, 3).map(r => ({
          region: r.region,
          overallScore: r.metrics.storageOpportunityScore.overall,
          primaryDriver: this.identifyPrimaryDriver(r.metrics.storageOpportunityScore)
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

// Helper method to identify primary driver
private identifyPrimaryDriver(scores: StorageOpportunityScore): string {
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
```

### 5. New Validation Schemas

**File:** `src/validation/electricity.schemas.ts`

```typescript
// Add to src/validation/electricity.schemas.ts

export const StateProfileDataSchema = z.object({
  period: z.string(),
  stateid: z.string(),
  "total-electric-power-industry": z.coerce.number().nullable(),
  "total-consumption": z.coerce.number().nullable(),
  "net-interstate-flow-of-electricity": z.coerce.number().nullable(),
});

export const RTODemandDataSchema = z.object({
  period: z.string(),
  respondent: z.string(),
  type: z.string(),
  value: z.coerce.number(),
  "value-units": z.string(),
});

export const CapacityByFuelDataSchema = z.object({
  period: z.string(),
  stateid: z.string(),
  energy_source_code: z.string(),
  "net-summer-capacity-mw": z.coerce.number().nullable(),
  "net-winter-capacity-mw": z.coerce.number().nullable(),
});

export const RetailPriceDataSchema = z.object({
  period: z.string(),
  stateid: z.string(),
  sectorid: z.string(),
  price: z.coerce.number().nullable(),
  sales: z.coerce.number().nullable(),
});

// Export types
export type StateProfileData = z.infer<typeof StateProfileDataSchema>;
export type RTODemandData = z.infer<typeof RTODemandDataSchema>;
export type CapacityByFuelData = z.infer<typeof CapacityByFuelDataSchema>;
export type RetailPriceData = z.infer<typeof RetailPriceDataSchema>;
```

## Implementation Steps

1. **Create new type definitions file** (`src/types/energyStorage.types.ts`)
2. **Update validation schemas** in `src/validation/electricity.schemas.ts`
3. **Add new repository methods** to `src/repositories/electricityRepository.ts`
4. **Create the new analyzer class** (`src/analysis/energyStorageAnalyzer.ts`)
5. **Update the tool implementation** in `src/index.ts`
6. **Test with various regions** to ensure data availability and accuracy

## Expected Output Example

```json
{
  "summary": {
    "analysisDate": "2025-01-11T06:45:00Z",
    "regionsAnalyzed": 3,
    "successfulAnalyses": 3,
    "topOpportunities": [
      {
        "region": "CA",
        "overallScore": 85,
        "primaryDriver": "Renewable Integration"
      },
      {
        "region": "TX",
        "overallScore": 78,
        "primaryDriver": "Grid Services"
      },
      {
        "region": "NY",
        "overallScore": 72,
        "primaryDriver": "Economic Arbitrage"
      }
    ]
  },
  "detailedResults": [
    {
      "region": "CA",
      "analysisDate": "2025-01-11T06:45:00Z",
      "gridCapacity": {
        "totalCapacityMW": 85000,
        "renewableCapacityMW": 35000,
        "fossilCapacityMW": 45000,
        "renewablePenetration": 41
      },
      "demandSupplyMetrics": {
        "averageDemandMW": 32000,
        "peakDemandMW": 48000,
        "minimumDemandMW": 22000,
        "loadFactor": 0.667,
        "demandVariabilityIndex": 0.25
      },
      "renewableIntegration": {
        "solarCapacityMW": 18000,
        "windCapacityMW": 8000,
        "estimatedCurtailmentMWh": 680000,
        "renewableVariabilityIndex": 0.62,
        "duckCurveSeverity": 0.85
      },
      "gridStability": {
        "maxHourlyRampMW": 8000,
        "rampingFrequency": 6.5,
        "frequencyRegulationNeed": 320,
        "spinningReserveRequirement": 4000
      },
      "economicOpportunity": {
        "averageRetailPriceCentsPerKWh": 18.5,
        "priceVolatilityIndex": 0.35,
        "peakOffPeakSpread": 120,
        "estimatedArbitrageRevenue": 122400
      },
      "storageOpportunityScore": {
        "overall": 85,
        "peakShavingScore": 78,
        "renewableIntegrationScore": 92,
        "gridServicesScore": 88,
        "economicScore": 81
      }
    }
  ],
  "failedRegions": []
}
