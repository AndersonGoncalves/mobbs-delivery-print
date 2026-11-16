import type { BffClient } from './bffClient';
import type { Printer } from './printer';

export interface PollCycleResult {
  pollIntervalSeconds: number;
  printedCount: number;
  failedCount: number;
}

/**
 * specs/0139-impressao-automatica-bridge REQ-9/REQ-10 — um ciclo de consulta: busca os pedidos
 * pendentes, imprime cada um e só confirma ao BFF (`markPrinted`) depois da impressão ter
 * sucesso. Pedido que falha (impressora desconectada, etc.) fica pendente — tentado de novo no
 * próximo ciclo (REQ-10) — e não interrompe os demais pedidos do mesmo ciclo.
 */
/**
 * Pedido explícito do usuário (16/11/2026) — depois do ticket normal, imprime também o cupom
 * fiscal simplificado pendente (fila separada, `fetchPendingFiscalReceipts`): dois papéis
 * distintos, um atrás do outro, nunca combinados num só. Falha num pedido de uma fila nunca afeta
 * a outra — mesmo racional de isolamento por pedido já usado no loop do ticket normal.
 */
export async function runPollCycle(bffClient: BffClient, printer: Printer, log: (message: string) => void = console.log): Promise<PollCycleResult> {
  const { pollIntervalSeconds, orders } = await bffClient.fetchPendingOrders();

  let printedCount = 0;
  let failedCount = 0;
  for (const order of orders) {
    try {
      await printer.print(order.lines);
      await bffClient.markPrinted(order.orderId);
      printedCount += 1;
      log(`Pedido ${order.orderId} impresso e confirmado.`);
    } catch (error) {
      failedCount += 1;
      log(`Erro ao imprimir o pedido ${order.orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const { orders: fiscalOrders } = await bffClient.fetchPendingFiscalReceipts();
  for (const order of fiscalOrders) {
    try {
      await printer.print(order.lines);
      await bffClient.markFiscalPrinted(order.orderId);
      printedCount += 1;
      log(`Cupom fiscal do pedido ${order.orderId} impresso e confirmado.`);
    } catch (error) {
      failedCount += 1;
      log(`Erro ao imprimir o cupom fiscal do pedido ${order.orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { pollIntervalSeconds, printedCount, failedCount };
}
