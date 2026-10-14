import { runPollCycle } from './pollCycle';
import type { BffClient } from './bffClient';
import type { Printer } from './printer';

function buildBffClient(overrides: Partial<BffClient> = {}): BffClient {
  return {
    fetchPendingOrders: jest.fn().mockResolvedValue({
      pollIntervalSeconds: 10,
      orders: [
        { orderId: 'o-1', lines: [{ text: 'ID PEDIDO: 1' }] },
        { orderId: 'o-2', lines: [{ text: 'ID PEDIDO: 2' }] },
      ],
    }),
    markPrinted: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as BffClient;
}

function buildPrinter(overrides: Partial<Printer> = {}): Printer {
  return { print: jest.fn().mockResolvedValue(undefined), ...overrides };
}

describe('runPollCycle (specs/0139-impressao-automatica-bridge REQ-9/REQ-10)', () => {
  it('imprime cada pedido pendente e só confirma depois da impressão ter sucesso', async () => {
    const bffClient = buildBffClient();
    const printer = buildPrinter();

    const result = await runPollCycle(bffClient, printer, () => undefined);

    expect(printer.print).toHaveBeenCalledTimes(2);
    expect(printer.print).toHaveBeenCalledWith([{ text: 'ID PEDIDO: 1' }]);
    expect(bffClient.markPrinted).toHaveBeenCalledWith('o-1');
    expect(bffClient.markPrinted).toHaveBeenCalledWith('o-2');
    expect(result).toEqual({ pollIntervalSeconds: 10, printedCount: 2, failedCount: 0 });
  });

  it('REQ-10 — pedido que falha ao imprimir não é confirmado, mas não trava os demais do ciclo', async () => {
    const bffClient = buildBffClient();
    const printer = buildPrinter({
      print: jest
        .fn()
        .mockRejectedValueOnce(new Error('impressora desconectada'))
        .mockResolvedValueOnce(undefined),
    });

    const result = await runPollCycle(bffClient, printer, () => undefined);

    expect(bffClient.markPrinted).toHaveBeenCalledTimes(1);
    expect(bffClient.markPrinted).toHaveBeenCalledWith('o-2');
    expect(bffClient.markPrinted).not.toHaveBeenCalledWith('o-1');
    expect(result).toEqual({ pollIntervalSeconds: 10, printedCount: 1, failedCount: 1 });
  });

  it('sem pedidos pendentes, não chama a impressora', async () => {
    const bffClient = buildBffClient({
      fetchPendingOrders: jest.fn().mockResolvedValue({ pollIntervalSeconds: 15, orders: [] }),
    });
    const printer = buildPrinter();

    const result = await runPollCycle(bffClient, printer, () => undefined);

    expect(printer.print).not.toHaveBeenCalled();
    expect(result).toEqual({ pollIntervalSeconds: 15, printedCount: 0, failedCount: 0 });
  });
});
