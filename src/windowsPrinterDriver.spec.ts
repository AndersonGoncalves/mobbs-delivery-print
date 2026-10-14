const execFileSync = jest.fn();
const execFile = jest.fn();
jest.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSync(...args),
  execFile: (...args: unknown[]) => execFile(...args),
}));

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
function decodeScript(args: string[]): string {
  const encodedIndex = args.indexOf('-EncodedCommand');
  return Buffer.from(args[encodedIndex + 1], 'base64').toString('utf16le');
}

function decodedSyncScriptFromCall(callIndex = 0): string {
  return decodeScript(execFileSync.mock.calls[callIndex][1] as string[]);
}

function decodedAsyncScriptFromCall(callIndex = 0): string {
  return decodeScript(execFile.mock.calls[callIndex][1] as string[]);
}

/** Simula o `execFile` (callback) por trás de `util.promisify` — sucesso por padrão; testes de
 * falha chamam `execFile.mockImplementation` com outro comportamento. */
function mockExecFileSuccess() {
  execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (err: unknown, stdout: string, stderr: string) => void) => {
    callback(null, '', '');
  });
}

function mockExecFileFailure(err: unknown) {
  execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (err: unknown, stdout: string, stderr: string) => void) => {
    callback(err, '', '');
  });
}

/** `printDirect` não devolve Promise (contrato de callback da lib) — espera o resultado via
 * `success`/`error` em vez de `await` direto na chamada. */
function runPrintDirect(data: Buffer, printer: string): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    windowsPrinterDriver.printDirect({
      data,
      printer,
      success: () => resolve({ ok: true }),
      error: (err) => resolve({ ok: false, message: err.message }),
    });
  });
}

describe('windowsPrinterDriver (specs/0144-driver-nativo-impressao-bridge, specs/0146-robustez-driver-powershell, specs/0152-dedup-impressao-manual-automatica)', () => {
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
    expect(decodedSyncScriptFromCall()).toContain("Get-Printer -Name 'MP-4200 TH'");
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

    expect(decodedSyncScriptFromCall()).toContain("Minha''s Printer");
  });

  it('printDirect: grava os bytes, manda pro PowerShell via -EncodedCommand (assíncrono), e chama success', async () => {
    mockExecFileSuccess();
    const data = Buffer.from('ESC/POS bytes');

    const result = await runPrintDirect(data, 'MP-4200 TH');

    expect(result).toEqual({ ok: true });
    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('job.bin'), data);
    expect(execFile).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-EncodedCommand']), expect.any(Object), expect.any(Function));
    // specs/0152 REQ-1 — via execFile (assíncrono), não execFileSync (bloqueante).
    expect(execFileSync).not.toHaveBeenCalled();
    // specs/0150 — carrega o assembly já compilado (`Add-Type -Path`), não recompila o C# do zero.
    const script = decodedAsyncScriptFromCall();
    expect(script).toContain('Add-Type -Path');
    expect(script).not.toContain('OutputAssembly');
    expect(script).toContain("SendBytesToPrinter('MP-4200 TH'");
    expect(script).toContain('job.bin');
    // limpeza best-effort do arquivo temporário de dados, mesmo em caso de sucesso.
    expect(unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('printDirect: chama error com o motivo real quando o PowerShell falha, sem derrubar o processo', async () => {
    mockExecFileFailure(Object.assign(new Error('comando falhou'), { stderr: 'WritePrinter falhou (codigo 1801)' }));

    const result = await runPrintDirect(Buffer.from('x'), 'MP-4200 TH');

    expect(result).toEqual({ ok: false, message: 'WritePrinter falhou (codigo 1801)' });
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
    const script = decodedSyncScriptFromCall();
    expect(script).toContain('Add-Type -OutputAssembly');
    expect(script).toContain('MobbsRawPrinterHelper');
  });

  it('não chama o PowerShell quando o assembly já existe (cache)', () => {
    existsSync.mockReturnValue(true);

    ensureAssemblyCompiled();

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('printDirect compila primeiro (se preciso, via execFileSync) e só depois imprime (via execFile), quando o assembly ainda não existe', async () => {
    existsSync.mockReturnValue(false);
    execFileSync.mockReturnValue('');
    mockExecFileSuccess();

    const result = await runPrintDirect(Buffer.from('x'), 'MP-4200 TH');

    expect(result).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(decodedSyncScriptFromCall(0)).toContain('Add-Type -OutputAssembly');
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(decodedAsyncScriptFromCall(0)).toContain('Add-Type -Path');
  });
});
