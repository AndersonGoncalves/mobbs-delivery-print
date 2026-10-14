const execFileSync = jest.fn();
jest.mock('child_process', () => ({ execFileSync: (...args: unknown[]) => execFileSync(...args) }));

const writeFileSync = jest.fn();
const unlinkSync = jest.fn();
const rmdirSync = jest.fn();
jest.mock('fs', () => ({
  mkdtempSync: jest.fn(() => '/tmp/mobbs-delivery-print-fake'),
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
  unlinkSync: (...args: unknown[]) => unlinkSync(...args),
  rmdirSync: (...args: unknown[]) => rmdirSync(...args),
}));

import { windowsPrinterDriver } from './windowsPrinterDriver';

describe('windowsPrinterDriver (specs/0144-driver-nativo-impressao-bridge)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getPrinters() devolve lista vazia (nunca usado — seleção sempre por nome explícito)', () => {
    expect(windowsPrinterDriver.getPrinters()).toEqual([]);
  });

  it('getPrinter(nome) devolve status OK quando o PowerShell encontra a impressora', () => {
    execFileSync.mockReturnValue(Buffer.from(''));

    const result = windowsPrinterDriver.getPrinter('MP-4200 TH');

    expect(result).toEqual({ status: ['OK'] });
    expect(execFileSync).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining([expect.stringContaining("Get-Printer -Name 'MP-4200 TH'")]),
      expect.any(Object),
    );
  });

  it('getPrinter(nome) devolve null quando o PowerShell não encontra a impressora', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('printer not found');
    });

    expect(windowsPrinterDriver.getPrinter('Inexistente')).toBeNull();
  });

  it('getPrinter escapa aspas simples no nome (evita quebrar o comando PowerShell)', () => {
    execFileSync.mockReturnValue(Buffer.from(''));

    windowsPrinterDriver.getPrinter("Minha's Printer");

    expect(execFileSync).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining([expect.stringContaining("Minha''s Printer")]),
      expect.any(Object),
    );
  });

  it('printDirect: grava o script e os bytes, manda pro PowerShell, e chama success', () => {
    execFileSync.mockReturnValue(Buffer.from(''));
    const success = jest.fn();
    const error = jest.fn();
    const data = Buffer.from('ESC/POS bytes');

    windowsPrinterDriver.printDirect({ data, printer: 'MP-4200 TH', success, error });

    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('raw-print.ps1'), expect.any(String), 'utf-8');
    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('job.bin'), data);
    expect(execFileSync).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-File', expect.stringContaining('raw-print.ps1'), '-PrinterName', 'MP-4200 TH']),
      expect.any(Object),
    );
    expect(success).toHaveBeenCalledWith('ok');
    expect(error).not.toHaveBeenCalled();
    // limpeza best-effort dos arquivos temporários, mesmo em caso de sucesso.
    expect(unlinkSync).toHaveBeenCalledTimes(2);
  });

  it('printDirect: chama error quando o PowerShell falha, sem derrubar o processo', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('WritePrinter falhou');
    });
    const success = jest.fn();
    const error = jest.fn();

    windowsPrinterDriver.printDirect({ data: Buffer.from('x'), printer: 'MP-4200 TH', success, error });

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'WritePrinter falhou' }));
    // limpeza acontece mesmo quando o PowerShell falha.
    expect(unlinkSync).toHaveBeenCalledTimes(2);
  });
});
