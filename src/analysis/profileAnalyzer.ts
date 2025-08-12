import type { GenerationData } from '../validation/electricity.schemas.js';

export interface GenerationSummary {
  [fuelType: string]: {
    netGenerationGWh: number;
    reportingUnits: number;
    description?: string;
  };
}

export class ProfileAnalyzer {
  public static summarizeGeneration(generationData: GenerationData[]): GenerationSummary {
    const summary: GenerationSummary = {};

    if (!generationData || generationData.length === 0) {
      return summary;
    }

    const latestPeriod = generationData[0].period;
    const latestData = generationData.filter(d => d.period === latestPeriod);

    for (const item of latestData) {
      // Prefer EIA's canonical key for this dataset: fueltypeid, with fallbacks
      const fuelType =
        (item as any).fueltypeid ??
        (item as any)['fuel-type'] ??
        (item as any).fueltype ??
        'UNKNOWN';

      // Convert reported generation to GWh based on units
      const genVal = item.generation ?? 0;
      const genUnits = (item as any)['generation-units'] as string | undefined;

      let generationGWh = 0;
      if (typeof genVal === 'number' && genVal > 0) {
        const units = (genUnits || '').toLowerCase();
        if (units.includes('thousand megawatthours')) {
          // Already in thousand MWh == GWh
          generationGWh = genVal;
        } else if (units.includes('megawatthours')) {
          // MWh -> GWh
          generationGWh = genVal / 1000;
        } else if (units.includes('gigawatthours') || units.includes('gwh')) {
          // Already GWh
          generationGWh = genVal;
        } else {
          // Unknown units: assume MWh as a conservative default
          generationGWh = genVal / 1000;
        }
      }

      if (generationGWh === 0) {
        continue; // Skip zero or negative generation entries
      }

      if (!summary[fuelType]) {
        summary[fuelType] = {
          netGenerationGWh: 0,
          reportingUnits: 0,
          description: (item as any).fuelTypeDescription,
        };
      } else if (!summary[fuelType].description && (item as any).fuelTypeDescription) {
        summary[fuelType].description = (item as any).fuelTypeDescription;
      }

      summary[fuelType].netGenerationGWh += generationGWh;
      summary[fuelType].reportingUnits += 1;
    }
    
    // Round the results for cleaner output and remove entries that round to zero
    for (const fuelType in summary) {
        const roundedValue = parseFloat(summary[fuelType].netGenerationGWh.toFixed(3));
        if (roundedValue === 0 && summary[fuelType].netGenerationGWh !== 0) {
            // Keep very small values if they are not exactly zero
            summary[fuelType].netGenerationGWh = summary[fuelType].netGenerationGWh;
        } else if (roundedValue === 0) {
            delete summary[fuelType];
        }
        else {
            summary[fuelType].netGenerationGWh = roundedValue;
        }
    }

    return summary;
  }
}
