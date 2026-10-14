import { loadConfig } from './config';
import { BffClient } from './bffClient';
import { createPrinter } from './printer';
import { runPollCycle } from './pollCycle';

/**
 * specs/0139-impressao-automatica-bridge REQ-8 — roda em segundo plano, consultando o BFF no
 * intervalo configurado na retaguarda (`pollIntervalSeconds` devolvido a cada ciclo, REQ-5 —
 * mudar o intervalo na web passa a valer no próximo ciclo, sem reiniciar o processo). `setTimeout`
 * recursivo (não `setInterval`) — um ciclo nunca começa antes do anterior terminar, mesmo se a
 * consulta/impressão demorar mais que o intervalo configurado.
 */
async function main() {
  const config = loadConfig();
  const bffClient = new BffClient(config);
  const printer = createPrinter(config);

  console.log('Serviço mobbs-delivery-print iniciado. Monitorando impressora e BFF...');

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
