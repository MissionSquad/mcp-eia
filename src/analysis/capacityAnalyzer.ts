import type { OperatingCapacity } from '../validation/electricity.schemas.js';

export interface RegionalCapacityMetrics {
  region: string;
  latestPeriod: string;
  totalSummerCapacityMW: number;
  totalWinterCapacityMW: number;
}

import type { GenerationData } from '../validation/electricity.schemas.js';

export class CapacityAnalyzer {
  public static calculateRegionalMetrics(region: string, capacityData: OperatingCapacity[]): RegionalCapacityMetrics {
    const latestPeriod = capacityData[0]?.period;
    if (!latestPeriod) {
      return { region, latestPeriod: 'N/A', totalSummerCapacityMW: 0, totalWinterCapacityMW: 0 };
    }

    const latestPeriodData = capacityData.filter(d => d.period === latestPeriod);
    const totalSummerCapacityMW = latestPeriodData.reduce((sum, gen) => sum + (gen['net-summer-capacity-mw'] ?? 0), 0);
    const totalWinterCapacityMW = latestPeriodData.reduce((sum, gen) => sum + (gen['net-winter-capacity-mw'] ?? 0), 0);

    return { region, latestPeriod, totalSummerCapacityMW, totalWinterCapacityMW };
  }

  public static calculateCapacityUtilization(
    capacityMetrics: RegionalCapacityMetrics,
    generationData: GenerationData[]
  ): {
    utilization: number | null;
    totalGenerationGWh: number;
    totalConsumptionGWh: number;
  } {
    if (
      !generationData ||
      generationData.length === 0 ||
      capacityMetrics.totalSummerCapacityMW <= 0
    ) {
      return { utilization: null, totalGenerationGWh: 0, totalConsumptionGWh: 0 };
    }

    const latestGenerationPeriod = generationData[0]?.period;
    const latestGenerationData = generationData.filter(
      (d) => d.period === latestGenerationPeriod
    );

    const totalGenerationMWh = latestGenerationData.reduce(
      (sum, gen) => sum + (gen.generation ?? 0),
      0
    );

    const totalConsumptionMWh = latestGenerationData.reduce(
      (sum, gen) => sum + (gen["total-consumption"] ?? 0),
      0
    );

    // Average hours in a month (365.25 / 12 * 24)
    const totalHoursInMonth = 30.4375 * 24;
    const potentialGenerationMWh =
      capacityMetrics.totalSummerCapacityMW * totalHoursInMonth;

    const utilization =
      potentialGenerationMWh > 0
        ? totalGenerationMWh / potentialGenerationMWh
        : null;

    return {
      utilization: utilization ? parseFloat(utilization.toFixed(4)) : null,
      totalGenerationGWh: parseFloat((totalGenerationMWh / 1000).toFixed(3)),
      totalConsumptionGWh: parseFloat(
        (totalConsumptionMWh / 1000).toFixed(3)
      ),
    };
  }
}
