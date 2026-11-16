/** Espelha `ReceiptLine` do BFF (`mobbs-delivery-bff/src/modules/auto-print/domain/build-receipt-lines.ts`). */
export interface ReceiptLine {
  text: string;
  bold?: boolean;
  /** Pedido explícito do usuário (16/11/2026) — presente só no cupom fiscal simplificado: imprime
   * este conteúdo como QR code em vez de texto. */
  qr?: string;
  /** Pedido explícito do usuário (16/11/2026) — quando presente (`text` fica vazio, ignorado),
   * desenha uma linha tracejada usando `drawLine()` da própria `node-thermal-printer` (largura
   * exata configurada na impressora, nunca um número fixo adivinhado pelo BFF). */
  divider?: boolean;
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
