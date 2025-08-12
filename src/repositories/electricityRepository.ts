import { EiaApiClient } from "../services/eiaClient.js";
import {
  OperatingCapacityResponseSchema,
  type OperatingCapacity,
  GenerationResponseSchema,
  type GenerationData,
  RetailSalesResponseSchema,
  type RetailSalesData,
  StateProfileResponseSchema,
  RTODemandResponseSchema,
  CapacityByFuelResponseSchema,
  RetailPriceResponseSchema,
  type StateProfileData,
  type RTODemandData,
  type CapacityByFuelData,
  type RetailPriceData,
} from "../validation/electricity.schemas.js";
import { ZodError, ZodSchema, ZodTypeAny } from "zod";
import { logger } from "../logger.js";

export class ElectricityRepository {
  constructor(private readonly apiClient: EiaApiClient) {}

  private parseAndValidate<T>(
    response: unknown,
    schema: ZodTypeAny,
    context: string
  ): T {
    const apiResponse = response as {
      response: {
        data: unknown;
      };
    };

    if (!apiResponse?.response?.data) {
      logger.error(`Invalid response structure from EIA API for ${context}`);
      throw new Error(
        `Invalid response structure from EIA API for ${context}.`
      );
    }

    const validationResult = schema.safeParse(apiResponse.response.data);
    if (!validationResult.success) {
      logger.error(
        `Zod validation failed for ${context} response`,
        validationResult.error
      );
      throw new ZodError(validationResult.error.issues);
    }
    return validationResult.data as T;
  }

  public async getOperatingCapacityByState(
    stateId: string
  ): Promise<OperatingCapacity[]> {
    const endpoint =
      "/v2/electricity/operating-generator-capacity/data" as const;

    const response = await this.apiClient.get(endpoint, {
      frequency: "monthly",
      facets: {
        stateid: [stateId],
      },
      data: ["net-summer-capacity-mw", "net-winter-capacity-mw"],
      sort: [{ column: "period", direction: "desc" }],
      length: 5000,
    });

    return this.parseAndValidate(
      response,
      OperatingCapacityResponseSchema,
      "getOperatingCapacityByState"
    );
  }

  public async getGenerationByFuelType(
    stateId: string
  ): Promise<GenerationData[]> {
    const endpoint =
      "/v2/electricity/electric-power-operational-data/data" as const;

    const response = await this.apiClient.get(endpoint, {
      frequency: "monthly",
      facets: {
        location: [stateId],
      },
      data: ["generation", "total-consumption"],
      sort: [{ column: "period", direction: "desc" }],
      length: 5000,
    });

    return this.parseAndValidate(
      response,
      GenerationResponseSchema,
      "getGenerationByFuelType"
    );
  }

  public async getRetailSales(stateId: string): Promise<RetailSalesData[]> {
    const endpoint = "/v2/electricity/retail-sales/data" as const;

    const response = await this.apiClient.get(endpoint, {
      frequency: "monthly",
      facets: {
        stateid: [stateId],
      },
      data: ["sales", "price", "revenue"],
      sort: [{ column: "period", direction: "desc" }],
      length: 1000,
    });

    return this.parseAndValidate(
      response,
      RetailSalesResponseSchema,
      "getRetailSales"
    );
  }

  public async getStateElectricityProfile(stateId: string): Promise<StateProfileData[]> {
    const endpoint = "/v2/electricity/state-electricity-profiles/summary/data" as const;
    
    const response = await this.apiClient.get(endpoint, {
      frequency: "annual",
      facets: {
        stateID: [stateId],
      },
      data: ["net-generation", "total-retail-sales", "average-retail-price"],
      sort: [{ column: "period", direction: "desc" }],
      length: 5,
    });
    
    return this.parseAndValidate(
      response,
      StateProfileResponseSchema,
      "getStateElectricityProfile"
    );
  }

  public async getRTODemandData(stateId: string, respondentOverride?: string, typeOverride: "D" | "NG" | "DF" = "D"): Promise<RTODemandData[]> {
    const endpoint = "/v2/electricity/rto/region-data/data" as const;

    const rtoRegion = respondentOverride ?? this.mapStateToRTO(stateId);
    if (!rtoRegion) return [];

    const response = await this.apiClient.get(endpoint, {
      frequency: "hourly",
      facets: {
        respondent: [rtoRegion],
        type: [typeOverride], // D=Demand, NG=Net Generation, DF=Demand Forecast (where available)
      },
      start: this.getStartDate(30), // Last 30 days
      sort: [{ column: "period", direction: "desc" }],
      length: 720, // 30 days * 24 hours
    });

    return this.parseAndValidate<RTODemandData[]>(
      response,
      RTODemandResponseSchema,
      "getRTODemandData"
    );
  }

  public async getCapacityByFuelType(stateId: string): Promise<CapacityByFuelData[]> {
    const endpoint = "/v2/electricity/operating-generator-capacity/data" as const;
    
    const response = await this.apiClient.get(endpoint, {
      frequency: "monthly",
      facets: {
        stateid: [stateId],
      },
      data: ["net-summer-capacity-mw", "net-winter-capacity-mw"],
      sort: [{ column: "period", direction: "desc" }],
      length: 5000,
    });
    
    const plantData = this.parseAndValidate<OperatingCapacity[]>(
      response,
      OperatingCapacityResponseSchema,
      "getCapacityByFuelType"
    );

    const capacityByFuel: Record<string, CapacityByFuelData> = {};
    for (const plant of plantData) {
      const fuelType = plant.energy_source_code;
      if (!fuelType) continue;

      if (!capacityByFuel[fuelType]) {
        capacityByFuel[fuelType] = {
          period: plant.period.substring(0, 4),
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

  private mapStateToRTO(stateId: string): string | null {
    // Operator respondents (as returned by rto/region-data facet 'respondent')
    const stateToRTO: Record<string, string> = {
      TX: "ERCO",  // ERCOT
      CA: "CISO",  // CAISO
      NY: "NYIS",  // NYISO
      IL: "MISO",  // Midcontinent ISO
      PA: "PJM",   // PJM
      MA: "ISNE",  // ISO-NE
      OK: "SWPP",  // Southwest Power Pool
    };
    return stateToRTO[stateId] ?? null;
  }

  private getStartDate(daysAgo: number): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().split('T')[0];
  }
}
