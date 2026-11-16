/** Espelha `ReceiptLine` do BFF (`mobbs-delivery-bff/src/modules/auto-print/domain/build-receipt-lines.ts`). */
export interface ReceiptLine {
  text: string;
  bold?: boolean;
  /** Pedido explícito do usuário (16/11/2026) — presente só no cupom fiscal simplificado: imprime
   * este conteúdo como QR code em vez de texto. */
  qr?: string;
}

export interface PendingOrder {
  orderId: string;
  lines: ReceiptLine[];
}

export interface PendingOrdersResponse {
  pollIntervalSeconds: number;
  orders: PendingOrder[];
}

/** Pedido explícito do usuário (16/11/2026) — fila separada do cupom fiscal simplificado, sem
 * `pollIntervalSeconds` próprio (reaproveita o intervalo já configurado pro ticket normal). */
export interface PendingFiscalReceiptsResponse {
  orders: PendingOrder[];
}
