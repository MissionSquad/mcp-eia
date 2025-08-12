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
import {
  CapacityByFuelData,
  GenerationData,
  RTODemandData,
  RetailPriceData,
} from "../validation/electricity.schemas.js";

export class EnergyStorageAnalyzer {
  
  public static async analyzeStorageOpportunity(
    region: string,
    capacityData: CapacityByFuelData[],
    demandData: RTODemandData[],
    generationData: GenerationData[],
    priceData: RetailPriceData[]
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
  
  private static calculateGridCapacityMetrics(capacityData: CapacityByFuelData[]): GridCapacityMetrics {
    const renewableSources = ['SUN', 'WND', 'HYD', 'GEO', 'BIO', 'WAS'];
    const fossilSources = ['NG', 'COL', 'PET', 'OTH'];
    
    let totalCapacity = 0;
    let renewableCapacity = 0;
    let fossilCapacity = 0;
    
    for (const record of capacityData) {
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
    demandData: RTODemandData[],
    generationData: GenerationData[]
  ): DemandSupplyMetrics {
    if (!demandData.length) {
      // Fallback to generation data if no demand data
      const totalGen = generationData.reduce((sum, g) => sum + (g.generation || 0), 0);
      const denom = generationData.length || 1;
      const avgGen = totalGen / denom;
      
      return {
        averageDemandMW: Math.round(avgGen),
        peakDemandMW: Math.round(avgGen * 1.2), // Estimate
        minimumDemandMW: Math.round(avgGen * 0.6), // Estimate
        loadFactor: 0.7, // Typical value
        demandVariabilityIndex: 0.15 // Typical value
      };
    }
    
    // Use only finite numeric values; tolerate nulls/missing values
    const series = demandData
      .map((d) => (typeof d.value === "number" && Number.isFinite(d.value) ? d.value : null))
      .filter((v): v is number => v !== null);

    if (series.length === 0) {
      // Fallback to generation-based estimate (same as no-demand branch)
      const totalGen = generationData.reduce((sum, g) => sum + (g.generation || 0), 0);
      const avgGen = totalGen / (generationData.length || 1);

      return {
        averageDemandMW: Math.round(avgGen),
        peakDemandMW: Math.round(avgGen * 1.2),
        minimumDemandMW: Math.round(avgGen * 0.6),
        loadFactor: 0.7,
        demandVariabilityIndex: 0.15
      };
    }

    const avgDemand = series.reduce((a, b) => a + b, 0) / series.length;
    const peakDemand = Math.max(...series);
    const minDemand = Math.min(...series);

    // Calculate standard deviation for variability
    const variance =
      series.reduce((sum, d) => sum + Math.pow(d - avgDemand, 2), 0) / series.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avgDemand !== 0 ? stdDev / avgDemand : 0;

    return {
      averageDemandMW: Math.round(avgDemand),
      peakDemandMW: Math.round(peakDemand),
      minimumDemandMW: Math.round(minDemand),
      loadFactor: parseFloat((avgDemand / (peakDemand || 1)).toFixed(3)),
      demandVariabilityIndex: parseFloat(coefficientOfVariation.toFixed(3))
    };
  }
  
  private static calculateRenewableMetrics(
    capacityData: CapacityByFuelData[],
    generationData: GenerationData[]
  ): RenewableIntegrationMetrics {
    const solarCapacity = capacityData
      .filter(d => d.energy_source_code === 'SUN')
      .reduce((sum, d) => sum + (d['net-summer-capacity-mw'] || 0), 0);
      
    const windCapacity = capacityData
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
  
  private static calculateGridStabilityMetrics(demandData: RTODemandData[]): GridStabilityMetrics {
    // Normalize to a numeric series (filter out nulls)
    const series = demandData
      .map((d) => (typeof d.value === "number" && Number.isFinite(d.value) ? d.value : null))
      .filter((v): v is number => v !== null);

    if (series.length < 2) {
      // Return typical values if insufficient hourly data
      return {
        maxHourlyRampMW: 500,
        rampingFrequency: 4,
        frequencyRegulationNeed: 100,
        spinningReserveRequirement: 300
      };
    }

    // Calculate hourly ramps over numeric series
    const ramps: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const ramp = Math.abs(series[i] - series[i - 1]);
      ramps.push(ramp);
    }

    const maxRamp = ramps.length ? Math.max(...ramps) : 0;
    const avgDemand = series.reduce((sum, v) => sum + v, 0) / series.length;

    // Count significant ramps (> 5% of average demand)
    const significantRampThreshold = avgDemand * 0.05;
    const significantRamps = ramps.filter((r) => r > significantRampThreshold).length;
    const rampingFrequency = (significantRamps / series.length) * 24; // Ramps per day

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
    priceData: RetailPriceData[],
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
    
    const prices = priceData.map(p => p.price || 0);
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
