import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { windowsPrinterDriver } from './windowsPrinterDriver';
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
      const isConnected = await thermalPrinter.isPrinterConnected();
      if (!isConnected) {
        throw new Error(`Impressora não encontrada em "${config.printerInterface}" — confira PRINTER_INTERFACE no .env e se a impressora está ligada.`);
      }

      thermalPrinter.clear();
      thermalPrinter.alignLeft();
      for (const line of lines) {
        if (line.bold) thermalPrinter.bold(true);
        if (line.text === '') {
          thermalPrinter.newLine();
        } else {
          thermalPrinter.println(line.text);
        }
        if (line.bold) thermalPrinter.bold(false);
      }
      thermalPrinter.cut();
      await thermalPrinter.execute();
    },
  };
}
