/** Espelha `ReceiptLine` do BFF (`mobbs-delivery-bff/src/modules/auto-print/domain/build-receipt-lines.ts`). */
export interface ReceiptLine {
  text: string;
  bold?: boolean;
}

export interface PendingOrder {
  orderId: string;
  lines: ReceiptLine[];
}

export interface PendingOrdersResponse {
  pollIntervalSeconds: number;
  orders: PendingOrder[];
}
