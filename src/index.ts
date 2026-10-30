import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { loadConfig } from './config';
import { resolveConfigDir, ensureConfigured } from './setup';
import { BffClient } from './bffClient';
import { createPrinter } from './printer';
import { runPollCycle } from './pollCycle';
import { createLocalPrintServer } from './localServer';
import { ensureAssemblyCompiled } from './windowsPrinterDriver';
import { BUILD_COMMIT, BUILD_DATE, BUILD_VERSION } from './buildInfo';

/**
 * specs/0139-impressao-automatica-bridge REQ-8 — roda em segundo plano, consultando o BFF no
 * intervalo configurado na retaguarda (`pollIntervalSeconds` devolvido a cada ciclo, REQ-5 —
 * mudar o intervalo na web passa a valer no próximo ciclo, sem reiniciar o processo). `setTimeout`
 * recursivo (não `setInterval`) — um ciclo nunca começa antes do anterior terminar, mesmo se a
 * consulta/impressão demorar mais que o intervalo configurado.
 */
async function main() {
  /** specs/0148-versao-visivel-bridge REQ-1 — primeira linha, sempre: deixa claro se um `.exe`
   * baixado é a versão mais recente ou uma cópia antiga em cache do navegador.
   * specs/0200-build-number-automatico-deploy — BUILD_VERSION (X.Y.Z+contagem de commits) junto. */
  console.log(`Versão: ${BUILD_VERSION} — ${BUILD_COMMIT} (${BUILD_DATE})`);

  /** specs/0141-instalador-bridge-impressao REQ-4/REQ-5 — primeiro uso sem `.env` ao lado do
   * executável pergunta a configuração sozinho; com `.env` já presente, segue direto. */
  const configDir = resolveConfigDir();
  await ensureConfigured(configDir);
  loadDotenv({ path: join(configDir, '.env') });

  const config = loadConfig();
  const bffClient = new BffClient(config);
  const printer = createPrinter(config);

  /** specs/0150-cache-assembly-driver-powershell REQ-2 — compila o driver de impressão (Windows)
   * uma vez já na inicialização, pra a primeira impressão de verdade (manual ou automática) já
   * ser rápida, sem esperar a primeira chamada pagar o custo de compilação. Só faz sentido pra
   * `printer:...` (impressora instalada no Windows) — `tcp://...` não usa esse driver. Melhor-
   * esforço: se falhar aqui (ex. PowerShell indisponível), não derruba o processo — a tentativa
   * de novo (e o erro de verdade, se persistir) acontece na primeira impressão mesmo. */
  if (config.printerInterface.startsWith('printer:')) {
    try {
      ensureAssemblyCompiled();
    } catch (error) {
      console.error(`Aviso: não foi possível preparar o driver de impressão de antemão (${error instanceof Error ? error.message : String(error)}) — vai tentar de novo na primeira impressão.`);
    }
  }

  /** specs/0147-impressao-manual-direta-bridge REQ-7 — roda em paralelo ao ciclo de consulta
   * abaixo; o botão "Imprimir" manual da retaguarda chama isso direto, sem esperar o próximo
   * ciclo automático. */
  createLocalPrintServer(printer, config.apiKey, console.log, config.localPrintServerPort);

  console.log('Serviço mobbs-delivery-print iniciado. Monitorando impressora e BFF...');
  console.log(`Servidor local de impressão manual ouvindo em http://127.0.0.1:${config.localPrintServerPort}`);

  let intervalSeconds = 10;
  async function tick() {
    try {
      const result = await runPollCycle(bffClient, printer);
      intervalSeconds = result.pollIntervalSeconds;
    } catch (error) {
      console.error(`Erro inesperado consultando o BFF: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(tick, intervalSeconds * 1000);
    }
  }

  await tick();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
