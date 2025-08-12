import axios, { type AxiosInstance } from 'axios';
import type { paths } from '../types/eia-api.d.ts';
import { logger } from '../logger.js';

// This generic type extracts the query parameters type for a given API path.
type EiaApiParams<T extends keyof paths> = paths[T] extends {
  get: { parameters?: { query?: infer Q } };
}
  ? Q
  : never;

export class EiaApiClient {
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  constructor(apiKey: string, timeout: number = 30000) {
    if (!apiKey) {
      throw new Error('EIA API key is required for EiaApiClient.');
    }
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.eia.gov',
      timeout
      // Parameters are now constructed per-request to include the API key.
    });
  }

  public async get<T extends keyof paths>(
    path: T,
    params?: EiaApiParams<T>,
  ): Promise<unknown> {
    try {
      // Combine provided params with the mandatory api_key
      const requestParams = { ...(params as object), api_key: this.apiKey };
      
      // Log the full request URL for debugging
      const fullUrl = this.client.getUri({ url: path as string, params: requestParams });
      logger.info(`EIA API Request URL: ${fullUrl}`);

      const response = await this.client.get(path as string, { params: requestParams });
      return response.data;
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) ? error.message : String(error);
      logger.error(`EIA API request to ${path as string} failed: ${errorMessage}`, error);
      // Re-throw a more specific error to be handled by the caller.
      throw new Error(`Failed to fetch data from EIA endpoint: ${path as string}. Reason: ${errorMessage}`);
    }
  }
}
