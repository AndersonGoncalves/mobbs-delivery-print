import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { join } from 'path';

const DEFAULT_BFF_URL = 'https://api.bsdelivery.com.br';
const DEFAULT_PRINTER_TYPE = 'epson';

export interface SetupIO {
  question(prompt: string): Promise<string>;
  log(message: string): void;
  close(): void;
}

function buildReadlineIO(): SetupIO {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: (prompt: string) => rl.question(prompt),
    log: (message: string) => console.log(message),
    close: () => rl.close(),
  };
}

/** pkg define `process.pkg` quando o código roda dentro do executável empacotado — nesse caso o
 * `.env` deve ficar ao lado do `.exe`, não da pasta de onde o processo foi iniciado. Em
 * desenvolvimento (`node dist/index.js`/`ts-node-dev`), `process.pkg` não existe e mantemos o
 * comportamento de sempre: `.env` na pasta atual. */
export function resolveConfigDir(): string {
  if ('pkg' in process) {
    return join(process.execPath, '..');
  }
  return process.cwd();
}

async function askRequired(io: SetupIO, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await io.question(prompt)).trim();
    if (answer) return answer;
    io.log('Esse campo é obrigatório.');
  }
}

async function askPrinterType(io: SetupIO): Promise<'epson' | 'star'> {
  for (;;) {
    const answer = (await io.question(`Tipo da impressora (epson/star) [${DEFAULT_PRINTER_TYPE}]: `))
      .trim()
      .toLowerCase();
    if (!answer) return DEFAULT_PRINTER_TYPE;
    if (answer === 'epson' || answer === 'star') return answer;
    io.log('Digite "epson" ou "star".');
  }
}

function buildEnvFileContents(values: {
  bffUrl: string;
  apiKey: string;
  printerInterface: string;
  printerType: string;
}): string {
  return [
    `BFF_URL=${values.bffUrl}`,
    `PRINT_API_KEY=${values.apiKey}`,
    `PRINTER_INTERFACE=${values.printerInterface}`,
    `PRINTER_TYPE=${values.printerType}`,
    '',
  ].join('\n');
}

/** specs/0141-instalador-bridge-impressao REQ-4/REQ-5/REQ-6 — primeira execução sem `.env` ao
 * lado do executável pergunta a configuração interativamente e grava o `.env`; com `.env` já
 * presente, não pergunta nada (comportamento de sempre). */
export async function ensureConfigured(
  configDir: string,
  io: SetupIO = buildReadlineIO(),
  exists: (path: string) => boolean = existsSync,
  write: (path: string, contents: string) => Promise<void> = (path, contents) => writeFile(path, contents, 'utf-8'),
): Promise<void> {
  const envPath = join(configDir, '.env');
  if (exists(envPath)) return;

  io.log('Primeira execução — configurando o mobbs-delivery-print.');
  try {
    const bffUrlAnswer = (await io.question(`URL do BFF [${DEFAULT_BFF_URL}]: `)).trim();
    const bffUrl = bffUrlAnswer || DEFAULT_BFF_URL;
    const apiKey = await askRequired(
      io,
      'Chave de API (copie em "Impressão automática" na retaguarda web): ',
    );
    const printerInterface = await askRequired(
      io,
      'Interface da impressora (ex.: printer:NomeDaImpressora ou tcp://192.168.0.100): ',
    );
    const printerType = await askPrinterType(io);

    await write(envPath, buildEnvFileContents({ bffUrl, apiKey, printerInterface, printerType }));
    io.log(`Configuração salva em ${envPath}.`);
  } finally {
    io.close();
  }
}
