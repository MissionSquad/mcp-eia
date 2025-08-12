// src/types/energyStorage.types.ts
export interface GridCapacityMetrics {
  totalCapacityMW: number;
  renewableCapacityMW: number;
  fossilCapacityMW: number;
  renewablePenetration: number; // percentage
}

export interface DemandSupplyMetrics {
  averageDemandMW: number;
  peakDemandMW: number;
  minimumDemandMW: number;
  loadFactor: number; // avg/peak ratio
  demandVariabilityIndex: number; // coefficient of variation
}

export interface RenewableIntegrationMetrics {
  solarCapacityMW: number;
  windCapacityMW: number;
  estimatedCurtailmentMWh: number;
  renewableVariabilityIndex: number;
  duckCurveSeverity: number; // 0-1 scale
}

export interface GridStabilityMetrics {
  maxHourlyRampMW: number;
  rampingFrequency: number; // ramps per day
  frequencyRegulationNeed: number; // MW of regulation needed
  spinningReserveRequirement: number; // MW
}

export interface EconomicMetrics {
  averageRetailPriceCentsPerKWh: number;
  priceVolatilityIndex: number;
  peakOffPeakSpread: number; // $/MWh
  estimatedArbitrageRevenue: number; // $/MW-year
}

export interface StorageOpportunityScore {
  overall: number; // 0-100
  peakShavingScore: number; // 0-100
  renewableIntegrationScore: number; // 0-100
  gridServicesScore: number; // 0-100
  economicScore: number; // 0-100
}

export interface EnergyStorageOpportunityMetrics {
  region: string;
  analysisDate: string;
  gridCapacity: GridCapacityMetrics;
  demandSupplyMetrics: DemandSupplyMetrics;
  renewableIntegration: RenewableIntegrationMetrics;
  gridStability: GridStabilityMetrics;
  economicOpportunity: EconomicMetrics;
  storageOpportunityScore: StorageOpportunityScore;
}

export interface RegionalAnalysisResult {
  region: string;
  metrics?: EnergyStorageOpportunityMetrics;
  error?: string;
}
