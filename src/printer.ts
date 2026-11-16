import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { windowsPrinterDriver, getLastPrinterDriverError } from './windowsPrinterDriver';
import type { Config } from './config';
import type { ReceiptLine } from './types';

export interface Printer {
  print(lines: ReceiptLine[]): Promise<void>;
}

/**
 * specs/0139-impressao-automatica-bridge REQ-9/REQ-11 — imprime cada linha já pronta vinda do BFF
 * (`buildReceiptLines`, mesmo layout do botão "Imprimir" da retaguarda): não decide formatação
 * nenhuma aqui, só itera `lines` e manda pra impressora térmica via ESC/POS
 * (`node-thermal-printer`, Windows e Linux — `PRINTER_INTERFACE` no `.env` escolhe USB/fila do
 * SO/rede, ver `.env.example`).
 *
 * specs/0144-driver-nativo-impressao-bridge REQ-1 — `printer:Nome` (impressora instalada no
 * Windows) exige um "driver" (ver `windowsPrinterDriver.ts`) pra imprimir ESC/POS cru de verdade
 * — sem ele a lib lança "No driver set!" assim que tenta imprimir. Interface de rede (`tcp://...`)
 * não usa driver nenhum.
 */
function resolvePrinterDriver(printerInterface: string): object | undefined {
  return printerInterface.startsWith('printer:') ? windowsPrinterDriver : undefined;
}

export function createPrinter(config: Pick<Config, 'printerInterface' | 'printerType'>): Printer {
  const thermalPrinter = new ThermalPrinter({
    type: config.printerType === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: config.printerInterface,
    driver: resolvePrinterDriver(config.printerInterface),
  });

  return {
    async print(lines: ReceiptLine[]): Promise<void> {
      /**
       * specs/0146-robustez-driver-powershell — `isPrinterConnected()` da lib ora resolve `false`,
       * ora rejeita com o valor `false` (comportamento interno dela, não documentado de forma
       * confiável) — o try/catch trata os dois casos igual, e anexa o motivo real do PowerShell
       * (`getLastPrinterDriverError`) quando disponível, em vez de só um "não encontrada" genérico.
       */
      let isConnected: boolean;
      try {
        isConnected = await thermalPrinter.isPrinterConnected();
      } catch {
        isConnected = false;
      }
      if (!isConnected) {
        const detail = getLastPrinterDriverError();
        throw new Error(
          `Impressora não encontrada em "${config.printerInterface}" — confira PRINTER_INTERFACE no .env e se a impressora está ligada.` +
            (detail ? ` Detalhe do PowerShell: ${detail}` : ''),
        );
      }

      thermalPrinter.clear();
      thermalPrinter.alignLeft();
      for (const line of lines) {
        // Pedido explícito do usuário (16/11/2026) — linha de QR code (só no cupom fiscal
        // simplificado): imprime o código em vez do texto, centralizado, e volta pro
        // alinhamento normal em seguida.
        if (line.qr) {
          thermalPrinter.alignCenter();
          thermalPrinter.printQR(line.qr);
          thermalPrinter.alignLeft();
          continue;
        }
        // Pedido explícito do usuário (16/11/2026) — achado real: o BFF não sabe a largura de
        // verdade configurada na impressora; `drawLine()` da própria lib desenha a linha na
        // largura exata do `config.width` (48 por padrão, já que `createPrinter` abaixo nunca
        // sobrescreve), em vez de um número de traços fixo que ficava curto.
        if (line.divider) {
          thermalPrinter.drawLine();
          continue;
        }
        // Pedido explícito do usuário (16/11/2026) — bloco "consulte pela chave de acesso"
        // centralizado, igual o DANFCE real.
        if (line.center) thermalPrinter.alignCenter();
        // Pedido explícito do usuário (16/11/2026) — Fonte B (condensada) só pra chave de acesso
        // da NFCe: cabe mais caracteres na mesma largura física do papel do que a Fonte A normal.
        if (line.small) thermalPrinter.setTypeFontB();
        if (line.bold) thermalPrinter.bold(true);
        if (line.text === '') {
          thermalPrinter.newLine();
        } else if (line.small || line.noWrap) {
          // Pedido explícito do usuário (16/11/2026) — achado real: `println()` da própria lib
          // sempre quebra o texto em `config.width` (48, fixo desde a construção), mesmo quando a
          // linha (ex. protocolo + data/hora) só ultrapassa esse limite em caracteres normais, sem
          // nenhuma fonte condensada envolvida — `_fold()` em `core.js` corta cru em 48, ignorando
          // Font A/B. `append()` (também pública na lib) bypassa esse fold e manda o texto cru numa
          // linha só. `small` (Fonte B) usa isso pra caber a chave de acesso; `noWrap` é o mesmo
          // bypass sem trocar de fonte, pra linhas que só excedem 48 caracteres em Fonte A mesmo.
          thermalPrinter.append(line.text);
          thermalPrinter.append('\n');
        } else {
          thermalPrinter.println(line.text);
        }
        if (line.bold) thermalPrinter.bold(false);
        if (line.small) thermalPrinter.setTypeFontA();
        if (line.center) thermalPrinter.alignLeft();
      }
      thermalPrinter.cut();
      await thermalPrinter.execute();
    },
  };
}
