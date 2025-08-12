import { z } from 'zod';

export const OperatingCapacityDataSchema = z.object({
  period: z.string().describe("The time period for the data, e.g., '2023-12'"),
  plantid: z.coerce.number().describe('EIA-assigned plant code'),
  plantName: z.string().describe('Plant name'),
  stateid: z.string().describe('Two-letter state abbreviation'),
  sectorName: z.string().nullable().describe('Name of the sector'),
  energy_source_code: z.string().describe('Fuel type identifier'),
  'net-summer-capacity-mw': z.coerce.number().nullable().describe('Net summer capacity in Megawatts'),
  'net-winter-capacity-mw': z.coerce.number().nullable().describe('Net winter capacity in Megawatts'),
});

export const OperatingCapacityResponseSchema = z.array(OperatingCapacityDataSchema);
export type OperatingCapacity = z.infer<typeof OperatingCapacityDataSchema>;

// Schema for /v2/electricity/electric-power-operational-data/data
export const GenerationDataSchema = z.object({
  period: z.string(),
  stateid: z.string().optional(),
  "fuel-type": z.string().optional(),
  fueltype: z.string().optional(),
  fueltypeid: z.string().optional(),
  fuelTypeDescription: z.string().optional(),
  generation: z.coerce.number().nullable(),
  "generation-units": z.string().optional(),
  "total-consumption": z.coerce.number().nullable(),
  "total-consumption-units": z.string().optional(),
});
export const GenerationResponseSchema = z.array(GenerationDataSchema);
export type GenerationData = z.infer<typeof GenerationDataSchema>;

// Schema for /v2/electricity/retail-sales/data
export const RetailSalesDataSchema = z.object({
  period: z.string(),
  stateid: z.string(),
  sectorid: z.string(),
  sectorName: z.string(),
  sales: z.coerce.number().nullable().describe("Megawatthours Sold"),
  price: z.coerce.number().nullable().describe("Cents per kilowatthour"),
  revenue: z.coerce.number().nullable().describe("Million dollars"),
});
export const RetailSalesResponseSchema = z.array(RetailSalesDataSchema);
export type RetailSalesData = z.infer<typeof RetailSalesDataSchema>;

export const StateProfileDataSchema = z.object({
  period: z.string(),
  stateID: z.string().optional(),
  stateid: z.string().optional(),
  "net-generation": z.coerce.number().nullable().optional(),
  "total-retail-sales": z.coerce.number().nullable().optional(),
  "average-retail-price": z.coerce.number().nullable().optional(),
});
export const StateProfileResponseSchema = z.array(StateProfileDataSchema);
export type StateProfileData = z.infer<typeof StateProfileDataSchema>;

export const RTODemandDataSchema = z.object({
  period: z.string(),
  respondent: z.string(),
  type: z.string(),
  value: z.preprocess((v) => {
    const n = Number(v as any);
    return Number.isFinite(n) ? n : null;
  }, z.number().nullable()),
  "value-units": z.string().optional(),
});
export const RTODemandResponseSchema = z.array(RTODemandDataSchema);
export type RTODemandData = z.infer<typeof RTODemandDataSchema>;

export const CapacityByFuelDataSchema = z.object({
  period: z.string(),
  stateid: z.string(),
  energy_source_code: z.string(),
  "net-summer-capacity-mw": z.coerce.number().nullable(),
  "net-winter-capacity-mw": z.coerce.number().nullable(),
});
export const CapacityByFuelResponseSchema = z.array(CapacityByFuelDataSchema);
export type CapacityByFuelData = z.infer<typeof CapacityByFuelDataSchema>;

export const RetailPriceDataSchema = z.object({
  period: z.string(),
  stateid: z.string(),
  sectorid: z.string(),
  price: z.coerce.number().nullable(),
  sales: z.coerce.number().nullable(),
});
export const RetailPriceResponseSchema = z.array(RetailPriceDataSchema);
export type RetailPriceData = z.infer<typeof RetailPriceDataSchema>;
