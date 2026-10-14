import axios, { type AxiosInstance } from 'axios';
import type { Config } from './config';
import type { PendingOrdersResponse } from './types';

export class BffClient {
  private readonly http: AxiosInstance;

  constructor(config: Pick<Config, 'bffUrl' | 'apiKey'>) {
    this.http = axios.create({
      baseURL: config.bffUrl,
      headers: { 'X-Print-Api-Key': config.apiKey },
      timeout: 15000,
    });
  }

  /** specs/0139-impressao-automatica-bridge REQ-2/REQ-4. */
  async fetchPendingOrders(): Promise<PendingOrdersResponse> {
    const { data } = await this.http.get<PendingOrdersResponse>('/restaurants/me/print-queue/pending');
    return data;
  }

  /** REQ-3 — idempotente no BFF: chamar de novo pro mesmo pedido não dá erro. */
  async markPrinted(orderId: string): Promise<void> {
    await this.http.post(`/restaurants/me/print-queue/${orderId}/printed`);
  }
}
