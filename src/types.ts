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
  /** Pedido explícito do usuário (16/11/2026) — imprime com a Fonte B (condensada) da impressora,
   * que cabe mais caracteres na mesma largura física — usado só pra chave de acesso da NFCe. */
  small?: boolean;
  /** Pedido explícito do usuário (16/11/2026) — centraliza a linha (`alignCenter()` antes de
   * imprimir, `alignLeft()` depois) — usado só no bloco "consulte pela chave de acesso" e no
   * rótulo do QR code do cupom fiscal. */
  center?: boolean;
  /** Pedido explícito do usuário (16/11/2026) — bypassa o fold de 48 colunas da própria lib
   * (`append()` em vez de `println()`), sem trocar de fonte (diferente de `small`) — usado na
   * linha "Protocolo de autorizacao: {protocolo}  {data}", que ultrapassa 48 caracteres em Fonte A
   * normal mesmo. */
  noWrap?: boolean;
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
