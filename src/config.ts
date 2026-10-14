export interface Config {
  bffUrl: string;
  apiKey: string;
  /** `node-thermal-printer` — `tcp://host:port`, `printer:NomeDaImpressora` (fila do SO,
   * recomendado no Windows) ou um caminho de dispositivo USB (`/dev/usb/lp0` no Linux). */
  printerInterface: string;
  printerType: 'epson' | 'star';
  /** specs/0147-impressao-manual-direta-bridge — porta do servidor local de impressão manual
   * direta. Padrão `48201`; só precisa mudar em caso raro de conflito de porta na máquina (não é
   * perguntado no setup interativo, `specs/0141`). */
  localPrintServerPort: number;
}

/** specs/0139-impressao-automatica-bridge — variáveis obrigatórias lidas de `.env` (ver
 * `.env.example`). Falha cedo (processo não sobe) se faltar alguma — rodar sem configurar direito
 * silenciosamente nunca imprimiria nada, pior que travar na inicialização com um erro claro. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const bffUrl = env.BFF_URL?.trim();
  const apiKey = env.PRINT_API_KEY?.trim();
  const printerInterface = env.PRINTER_INTERFACE?.trim();
  const printerType = (env.PRINTER_TYPE?.trim().toLowerCase() || 'epson') as Config['printerType'];
  const localPrintServerPort = Number(env.LOCAL_PRINT_SERVER_PORT?.trim() || 48201);

  const missing: string[] = [];
  if (!bffUrl) missing.push('BFF_URL');
  if (!apiKey) missing.push('PRINT_API_KEY');
  if (!printerInterface) missing.push('PRINTER_INTERFACE');
  if (missing.length > 0) {
    throw new Error(`Configuração incompleta no .env — faltando: ${missing.join(', ')}. Veja .env.example.`);
  }
  if (printerType !== 'epson' && printerType !== 'star') {
    throw new Error(`PRINTER_TYPE inválido ("${printerType}") — use "epson" ou "star".`);
  }
  if (!Number.isInteger(localPrintServerPort) || localPrintServerPort <= 0) {
    throw new Error(`LOCAL_PRINT_SERVER_PORT inválido ("${env.LOCAL_PRINT_SERVER_PORT}") — use um número de porta válido.`);
  }

  return { bffUrl: bffUrl!, apiKey: apiKey!, printerInterface: printerInterface!, printerType, localPrintServerPort };
}
