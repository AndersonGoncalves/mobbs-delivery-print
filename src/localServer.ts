import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import type { Printer } from './printer';
import type { ReceiptLine } from './types';

/**
 * specs/0147-impressao-manual-direta-bridge REQ-4/REQ-5/REQ-6/REQ-7 — servidor HTTP local (só
 * `127.0.0.1`, nunca `0.0.0.0`) que deixa o botão "Imprimir" manual da retaguarda imprimir na hora
 * (ESC/POS cru, sem diálogo), em vez de esperar o próximo ciclo de consulta ao BFF. Roda em
 * paralelo ao polling já existente — os dois nunca se atrapalham (`http.Server` é orientado a
 * evento).
 */

export const LOCAL_PRINT_SERVER_PORT = 48201;

/** Só a origem de produção da retaguarda e os endereços de dev local do Vite — nenhum outro site
 * recebe os cabeçalhos de CORS necessários pra completar a chamada. */
const ALLOWED_ORIGINS = new Set(['https://bsdelivery.com.br', 'http://localhost:5173', 'http://127.0.0.1:5173']);

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Print-Api-Key');
  // Chrome Private Network Access — exigido pra uma página pública (https://bsdelivery.com.br)
  // conseguir chamar um endereço local (127.0.0.1), mesmo com a origem já liberada acima.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createLocalPrintServer(
  printer: Printer,
  apiKey: string,
  log: (message: string) => void = console.log,
  port: number = LOCAL_PRINT_SERVER_PORT,
): Server {
  const server = createServer((req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/print-now') {
      sendJson(res, 404, { message: 'Rota não encontrada' });
      return;
    }

    // REQ-6 — só rejeita quando a chave vem preenchida e não bate; não é obrigatória (a defesa
    // principal é CORS + o servidor só escutar em 127.0.0.1, ver topo do arquivo).
    const providedKey = req.headers['x-print-api-key'];
    if (providedKey && providedKey !== apiKey) {
      sendJson(res, 401, { message: 'Chave de API inválida' });
      return;
    }

    void (async () => {
      try {
        const body = await readBody(req);
        const { lines } = JSON.parse(body) as { lines: ReceiptLine[] };
        await printer.print(lines);
        sendJson(res, 200, { ok: true });
        log('Impressão direta (manual) concluída.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Erro na impressão direta (manual): ${message}`);
        sendJson(res, 500, { message });
      }
    })();
  });

  server.listen(port, '127.0.0.1');
  return server;
}
