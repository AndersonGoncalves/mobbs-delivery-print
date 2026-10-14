const execFileSync = jest.fn();
jest.mock('child_process', () => ({ execFileSync: (...args: unknown[]) => execFileSync(...args) }));

const writeFileSync = jest.fn();
const unlinkSync = jest.fn();
const rmdirSync = jest.fn();
const existsSync = jest.fn();
jest.mock('fs', () => ({
  mkdtempSync: jest.fn(() => '/tmp/mobbs-delivery-print-fake'),
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
  unlinkSync: (...args: unknown[]) => unlinkSync(...args),
  rmdirSync: (...args: unknown[]) => rmdirSync(...args),
  existsSync: (...args: unknown[]) => existsSync(...args),
}));

import { windowsPrinterDriver, getLastPrinterDriverError, ensureAssemblyCompiled } from './windowsPrinterDriver';

/** As chamadas reais vão todas via `-EncodedCommand` (specs/0146) — decodifica o argumento pra
 * conseguir inspecionar o script PowerShell de verdade nos testes. */
function decodedScriptFromCall(callIndex = 0): string {
  const args = execFileSync.mock.calls[callIndex][1] as string[];
  const encodedIndex = args.indexOf('-EncodedCommand');
  return Buffer.from(args[encodedIndex + 1], 'base64').toString('utf16le');
}

describe('windowsPrinterDriver (specs/0144-driver-nativo-impressao-bridge, specs/0146-robustez-driver-powershell)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // specs/0150-cache-assembly-driver-powershell — por padrão, assembly já compilado (cenário
    // comum após o warm-up na inicialização); testes específicos de `ensureAssemblyCompiled`
    // sobrescrevem isso.
    existsSync.mockReturnValue(true);
  });

  it('getPrinters() devolve lista vazia (nunca usado — seleção sempre por nome explícito)', () => {
    expect(windowsPrinterDriver.getPrinters()).toEqual([]);
  });

  it('getPrinter(nome) devolve status OK quando o PowerShell encontra a impressora', () => {
    execFileSync.mockReturnValue('');

    const result = windowsPrinterDriver.getPrinter('MP-4200 TH');

    expect(result).toEqual({ status: ['OK'] });
    expect(execFileSync).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-EncodedCommand']), expect.any(Object));
    expect(decodedScriptFromCall()).toContain("Get-Printer -Name 'MP-4200 TH'");
    expect(getLastPrinterDriverError()).toBeUndefined();
  });

  it('getPrinter(nome) devolve null e guarda o motivo real quando o PowerShell falha', () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error('comando falhou'), { stderr: 'Get-Printer : No matching printers were found.' });
    });

    expect(windowsPrinterDriver.getPrinter('Inexistente')).toBeNull();
    expect(getLastPrinterDriverError()).toBe('Get-Printer : No matching printers were found.');
  });

  it('getPrinter cai pra err.message quando não há stderr', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('ENOENT: powershell.exe not found');
    });

    windowsPrinterDriver.getPrinter('Qualquer');

    expect(getLastPrinterDriverError()).toBe('ENOENT: powershell.exe not found');
  });

  it('getPrinter escapa aspas simples no nome (evita quebrar o script PowerShell)', () => {
    execFileSync.mockReturnValue('');

    windowsPrinterDriver.getPrinter("Minha's Printer");

    expect(decodedScriptFromCall()).toContain("Minha''s Printer");
  });

  it('printDirect: grava os bytes, manda pro PowerShell via -EncodedCommand, e chama success', () => {
    execFileSync.mockReturnValue('');
    const success = jest.fn();
    const error = jest.fn();
    const data = Buffer.from('ESC/POS bytes');

    windowsPrinterDriver.printDirect({ data, printer: 'MP-4200 TH', success, error });

    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('job.bin'), data);
    expect(execFileSync).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-EncodedCommand']), expect.any(Object));
    // specs/0150 — carrega o assembly já compilado (`Add-Type -Path`), não recompila o C# do zero.
    const script = decodedScriptFromCall();
    expect(script).toContain('Add-Type -Path');
    expect(script).not.toContain('OutputAssembly');
    expect(script).toContain("SendBytesToPrinter('MP-4200 TH'");
    expect(script).toContain('job.bin');
    expect(success).toHaveBeenCalledWith('ok');
    expect(error).not.toHaveBeenCalled();
    // limpeza best-effort do arquivo temporário de dados, mesmo em caso de sucesso.
    expect(unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('printDirect: chama error com o motivo real quando o PowerShell falha, sem derrubar o processo', () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error('comando falhou'), { stderr: 'WritePrinter falhou (codigo 1801)' });
    });
    const success = jest.fn();
    const error = jest.fn();

    windowsPrinterDriver.printDirect({ data: Buffer.from('x'), printer: 'MP-4200 TH', success, error });

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'WritePrinter falhou (codigo 1801)' }));
    expect(getLastPrinterDriverError()).toBe('WritePrinter falhou (codigo 1801)');
    // limpeza acontece mesmo quando o PowerShell falha.
    expect(unlinkSync).toHaveBeenCalledTimes(1);
  });
});

describe('ensureAssemblyCompiled (specs/0150-cache-assembly-driver-powershell)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('compila (uma vez) quando o assembly ainda não existe em disco', () => {
    existsSync.mockReturnValue(false);
    execFileSync.mockReturnValue('');

    ensureAssemblyCompiled();

    expect(execFileSync).toHaveBeenCalledTimes(1);
    const script = decodedScriptFromCall();
    expect(script).toContain('Add-Type -OutputAssembly');
    expect(script).toContain('MobbsRawPrinterHelper');
  });

  it('não chama o PowerShell quando o assembly já existe (cache)', () => {
    existsSync.mockReturnValue(true);

    ensureAssemblyCompiled();

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('printDirect compila primeiro (se preciso) e só depois imprime, quando o assembly ainda não existe', () => {
    existsSync.mockReturnValue(false);
    execFileSync.mockReturnValue('');
    const success = jest.fn();

    windowsPrinterDriver.printDirect({ data: Buffer.from('x'), printer: 'MP-4200 TH', success, error: jest.fn() });

    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(decodedScriptFromCall(0)).toContain('Add-Type -OutputAssembly');
    expect(decodedScriptFromCall(1)).toContain('Add-Type -Path');
    expect(success).toHaveBeenCalledWith('ok');
  });
});
