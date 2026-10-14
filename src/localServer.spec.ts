import { request, type Server } from 'http';
import { createLocalPrintServer, LOCAL_PRINT_SERVER_PORT } from './localServer';
import type { Printer } from './printer';

const BASE_URL = `http://127.0.0.1:${LOCAL_PRINT_SERVER_PORT}`;
const API_KEY = 'chave-do-restaurante';

describe('createLocalPrintServer (specs/0147-impressao-manual-direta-bridge)', () => {
  let server: Server;
  let printer: jest.Mocked<Printer>;
  let log: jest.Mock;

  beforeEach((done) => {
    printer = { print: jest.fn().mockResolvedValue(undefined) };
    log = jest.fn();
    server = createLocalPrintServer(printer, API_KEY, log);
    server.on('listening', done);
  });

  afterEach((done) => {
    server.close(() => done());
  });

  it('REQ-5: responde o preflight OPTIONS liberando uma origem permitida, com o header de Private Network Access', async () => {
    const response = await fetch(`${BASE_URL}/print-now`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://bsdelivery.com.br' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://bsdelivery.com.br');
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('REQ-5/AC-3: não libera uma origem fora da lista permitida', async () => {
    const response = await fetch(`${BASE_URL}/print-now`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://site-qualquer.com' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('REQ-4: imprime as linhas recebidas e devolve 200 (sem chave de API enviada)', async () => {
    const response = await fetch(`${BASE_URL}/print-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: [{ text: 'ID PEDIDO: 38' }] }),
    });

    expect(response.status).toBe(200);
    expect(printer.print).toHaveBeenCalledWith([{ text: 'ID PEDIDO: 38' }]);
  });

  it('REQ-6: com a chave de API certa, imprime normalmente', async () => {
    const response = await fetch(`${BASE_URL}/print-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Print-Api-Key': API_KEY },
      body: JSON.stringify({ lines: [{ text: 'ID PEDIDO: 38' }] }),
    });

    expect(response.status).toBe(200);
    expect(printer.print).toHaveBeenCalled();
  });

  it('REQ-6/AC-4: rejeita (401) quando a chave de API vem errada, sem imprimir', async () => {
    const response = await fetch(`${BASE_URL}/print-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Print-Api-Key': 'chave-errada' },
      body: JSON.stringify({ lines: [{ text: 'ID PEDIDO: 38' }] }),
    });

    expect(response.status).toBe(401);
    expect(printer.print).not.toHaveBeenCalled();
  });

  it('devolve 404 pra rota/método diferente de POST /print-now', async () => {
    const response = await fetch(`${BASE_URL}/outra-rota`, { method: 'POST' });

    expect(response.status).toBe(404);
  });

  it('devolve 500 com o motivo quando a impressão falha, sem derrubar o servidor', async () => {
    printer.print.mockRejectedValueOnce(new Error('Impressora não encontrada'));

    const response = await fetch(`${BASE_URL}/print-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: [] }),
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe('Impressora não encontrada');
  });

  // specs/0152-dedup-impressao-manual-automatica REQ-1 — cliente desiste antes do corpo da
  // requisição terminar de chegar (nunca fecha a conexão): o servidor nem deve chegar a chamar
  // `printer.print`, já que o pedido de impressão em si nunca terminou de ser recebido.
  it('REQ-1/AC-1: não imprime quando o cliente destrói a conexão antes do corpo terminar de chegar', async () => {
    await new Promise<void>((resolve) => {
      const clientRequest = request({
        hostname: '127.0.0.1',
        port: LOCAL_PRINT_SERVER_PORT,
        path: '/print-now',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      clientRequest.on('error', () => { /* esperado ao destruir a conexão no meio */ });
      // Manda só uma parte do JSON (nunca chama `.end()`) — o servidor fica esperando o resto.
      clientRequest.write('{"lines":[');

      setTimeout(() => {
        clientRequest.destroy();
        setTimeout(() => {
          expect(printer.print).not.toHaveBeenCalled();
          resolve();
        }, 150);
      }, 50);
    });
  });
});
