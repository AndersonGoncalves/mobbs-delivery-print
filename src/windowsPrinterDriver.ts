import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

/**
 * specs/0144-driver-nativo-impressao-bridge REQ-1 — `node-thermal-printer`'s `printer:Nome`
 * exige um "driver" (objeto com `getPrinters`/`getPrinter`/`printDirect`, ver seu próprio README
 * "Use a custom printer driver"). Em vez de depender de um módulo nativo do npm (testado e
 * descartado — pacote quebrado, não instala/compila de forma confiável, ver `plan.md`), este
 * driver manda os bytes crus (ESC/POS) direto pra fila RAW da impressora via PowerShell + P/Invoke
 * de `winspool.drv` (técnica padrão da própria Microsoft pra impressão RAW em .NET/Windows — já
 * vem em qualquer Windows, sem instalar nada a mais, sem compilar nada no nosso lado).
 *
 * specs/0146-robustez-driver-powershell — sempre via `-EncodedCommand` (script inteiro em
 * UTF-16LE/base64), nunca `-Command` com string solta: evita um problema clássico de escape de
 * argumento do Windows (nome de impressora com espaço, ex. "MP-4200 TH", podia sair mal formado
 * ao atravessar `child_process` -> linha de comando do `powershell.exe` -> parser do PowerShell —
 * `Get-Printer "MP-4200 TH"` funcionava rodado à mão, mas falhava vindo do bridge). Com
 * `-EncodedCommand`, nada disso é interpretado por quebra de argumento — só o PowerShell decodifica
 * e interpreta o script.
 */

/**
 * specs/0150-cache-assembly-driver-powershell — `Add-Type -TypeDefinition` recompila o C# do
 * zero a cada chamada (invoca o compilador, ~1-3s+) — lento o bastante pra estourar o tempo de
 * espera curto que a impressão manual direta usa antes de cair pro fallback do navegador
 * (`specs/0147`), mesmo a impressão em si tendo sucesso (só demorada). Em vez disso, compila UMA
 * vez só (`ensureAssemblyCompiled`, cacheada em disco entre reinicializações do bridge) e reusa
 * via `Add-Type -Path` (carrega o assembly já pronto, sem recompilar) em toda chamada seguinte —
 * ordens de grandeza mais rápido.
 */
const ASSEMBLY_PATH = join(tmpdir(), 'mobbs-delivery-print-raw-printer-helper.dll');

// RawPrinterHelper — adaptação do exemplo oficial da Microsoft (KB322090, "How to send raw data
// to a printer"). `winspool.drv` é a API nativa do Windows pra fila de impressão;
// `StartDocPrinter`/`WritePrinter` com `pDataType = "RAW"` envia os bytes sem nenhum
// processamento/paginação do driver gráfico — exatamente o modo ESC/POS espera.
const RAW_PRINTER_HELPER_CSHARP = `
using System;
using System.Runtime.InteropServices;
public class MobbsRawPrinterHelper {
    [StructLayout(LayoutKind.Sequential)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes, out string errorMessage) {
        errorMessage = "";
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "mobbs-delivery comanda";
        di.pDataType = "RAW";
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            errorMessage = "OpenPrinter falhou (codigo " + Marshal.GetLastWin32Error() + ")";
            return false;
        }
        try {
            if (!StartDocPrinter(hPrinter, 1, di)) {
                errorMessage = "StartDocPrinter falhou (codigo " + Marshal.GetLastWin32Error() + ")";
                return false;
            }
            try {
                if (!StartPagePrinter(hPrinter)) {
                    errorMessage = "StartPagePrinter falhou (codigo " + Marshal.GetLastWin32Error() + ")";
                    return false;
                }
                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                try {
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written)) {
                        errorMessage = "WritePrinter falhou (codigo " + Marshal.GetLastWin32Error() + ")";
                        return false;
                    }
                } finally {
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }
                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
        return true;
    }
}
`;

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildEncodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'];

/** Síncrono/bloqueante — só pra operações rápidas (`getPrinter`, compilar o assembly uma vez).
 * `node-thermal-printer` chama `driver.getPrinter(...)` sem `await` (ver `interfaces/printer.js`
 * da lib), então essa função precisa ser síncrona por contrato — não dá pra trocar por async ali. */
function runPowerShellScript(script: string): void {
  execFileSync('powershell.exe', [...POWERSHELL_ARGS, buildEncodedCommand(script)], { windowsHide: true, encoding: 'utf-8' });
}

/**
 * specs/0152-dedup-impressao-manual-automatica REQ-1 — assíncrono/não-bloqueante, ao contrário de
 * `runPowerShellScript`. `execFileSync` trava o processo Node inteiro (single-thread) enquanto o
 * PowerShell roda — durante uma impressão do ciclo automático, isso deixava o servidor HTTP local
 * (impressão manual, `specs/0147`) sem conseguir nem começar a atender uma requisição nova até o
 * `execFileSync` anterior voltar, o que podia sozinho estourar o tempo de espera do navegador.
 * `printDirect` (a operação lenta de verdade, mandar os bytes pra impressora) usa esta versão.
 */
async function runPowerShellScriptAsync(script: string): Promise<void> {
  await execFileAsync('powershell.exe', [...POWERSHELL_ARGS, buildEncodedCommand(script)], { windowsHide: true, encoding: 'utf-8' });
}

/** specs/0150-cache-assembly-driver-powershell — compila o helper C# uma vez só, cacheado em
 * disco (`ASSEMBLY_PATH`) entre reinicializações do bridge. Chamado proativamente ao iniciar
 * (`index.ts`) e, de qualquer forma, de novo (idempotente — `existsSync` primeiro) antes de cada
 * impressão, caso o cache tenha sido apagado ou o processo não tenha chamado o warm-up. */
export function ensureAssemblyCompiled(): void {
  if (existsSync(ASSEMBLY_PATH)) return;
  const compileScript = `
Add-Type -OutputAssembly ${psQuote(ASSEMBLY_PATH)} -OutputType Library -TypeDefinition @"
${RAW_PRINTER_HELPER_CSHARP}
"@
`;
  runPowerShellScript(compileScript);
}

/** specs/0146 — mensagem real do PowerShell (via stderr), pra não esconder o motivo de verdade
 * atrás de um "impressora não encontrada" genérico quando o problema é outro (nome inválido,
 * driver sem suporte a RAW, permissão, etc.). */
function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr?: string | Buffer }).stderr;
    const text = stderr ? stderr.toString().trim() : '';
    if (text) return text;
  }
  return err instanceof Error ? err.message : String(err);
}

let lastDriverError: string | undefined;

/** Último erro real reportado pelo PowerShell — `printer.ts` usa isso pra compor uma mensagem de
 * log útil em vez do genérico "impressora não encontrada". */
export function getLastPrinterDriverError(): string | undefined {
  return lastDriverError;
}

// Achado da auditoria pré-produção (31/10/2026) — "checagem de impressora ainda é síncrona e
// bloqueia o servidor de impressão manual": `undefined` = ainda não checou nenhuma vez desde que
// o bridge subiu; depois da primeira checagem, sempre um valor concreto (`{status}` ou `null`),
// atualizado só em segundo plano a partir daí — `getPrinter()` abaixo nunca mais paga o custo
// síncrono de novo.
let cachedPrinterStatus: { status: string[] } | null | undefined;
let refreshInFlight: Promise<void> | null = null;

function applyPrinterCheckResult(ok: boolean, err?: unknown): void {
  if (ok) {
    cachedPrinterStatus = { status: ['OK'] };
    lastDriverError = undefined;
  } else {
    cachedPrinterStatus = null;
    lastDriverError = describeError(err);
  }
}

/** Mesma checagem de sempre (`Get-Printer`), só que via PowerShell assíncrono — nunca bloqueia o
 * processo Node enquanto roda. `refreshInFlight` evita disparar duas checagens em paralelo se
 * chegar mais de uma impressão antes da anterior terminar. */
function refreshPrinterStatusAsync(name: string): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runPowerShellScriptAsync(`Get-Printer -Name ${psQuote(name)} | Out-Null`)
    .then(() => applyPrinterCheckResult(true))
    .catch((err: unknown) => applyPrinterCheckResult(false, err))
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Chamado proativamente em `index.ts`, mesmo padrão de `ensureAssemblyCompiled` — dispara a
 * primeira checagem de conectividade já na inicialização, em segundo plano (sem bloquear a subida
 * do bridge), pra que o cache já esteja preenchido quando a primeira impressão de verdade chegar
 * e `getPrinter()` nunca precise cair no fallback síncrono abaixo. */
export function warmUpPrinterConnectivity(name: string): void {
  void refreshPrinterStatusAsync(name);
}

/** Só para testes — o cache é módulo-level (sobrevive entre `it()` do mesmo arquivo); cada
 * cenário de `getPrinter()` espera uma checagem síncrona fresca, não o resultado de um teste
 * anterior. */
export function resetPrinterConnectivityCacheForTests(): void {
  cachedPrinterStatus = undefined;
  refreshInFlight = null;
}

async function sendRawBytes(printerName: string, data: Buffer): Promise<void> {
  ensureAssemblyCompiled();
  const dir = mkdtempSync(join(tmpdir(), 'mobbs-delivery-print-'));
  const dataPath = join(dir, 'job.bin');
  try {
    writeFileSync(dataPath, data);
    const script = `
Add-Type -Path ${psQuote(ASSEMBLY_PATH)}
$bytes = [System.IO.File]::ReadAllBytes(${psQuote(dataPath)})
$errorMessage = ""
$ok = [MobbsRawPrinterHelper]::SendBytesToPrinter(${psQuote(printerName)}, $bytes, [ref]$errorMessage)
if (-not $ok) {
    Write-Error $errorMessage
    exit 1
}
exit 0
`;
    await runPowerShellScriptAsync(script);
  } finally {
    try {
      unlinkSync(dataPath);
      rmdirSync(dir);
    } catch {
      // best-effort cleanup — não falha a impressão por causa disso.
    }
  }
}

export interface PrintDirectOptions {
  data: Buffer;
  printer: string;
  success: (jobId: string) => void;
  error: (err: Error) => void;
}

/** Formato de "driver" que `node-thermal-printer` espera (ver seu README, "Use a custom printer
 * driver") — `getPrinters`/`getPrinter` usados por `isPrinterConnected()`, `printDirect` por
 * `execute()`. */
export const windowsPrinterDriver = {
  // specs/0144 — não usamos seleção automática (`printer:auto`), só nome explícito; getPrinters()
  // só precisa existir pra satisfazer a interface, nunca é chamado de verdade.
  getPrinters(): { name: string; attributes: string[] }[] {
    return [];
  },
  getPrinter(name: string): { status: string[] } | null {
    // Achado da auditoria pré-produção (31/10/2026) — item 1 "checagem de impressora ainda é
    // síncrona e bloqueia o servidor de impressão manual": contrato da lib exige retorno
    // síncrono aqui (`node-thermal-printer` chama `driver.getPrinter(...)` sem `await`, ver
    // `interfaces/printer.js`), então a checagem de verdade sempre roda em segundo plano
    // (`refreshPrinterStatusAsync`, via PowerShell assíncrono) — esta função só lê o último
    // resultado já conhecido, nunca bloqueia o processo esperando o PowerShell responder.
    if (cachedPrinterStatus === undefined) {
      // Única situação em que ainda paga o custo síncrono de verdade: a primeiríssima checagem
      // desde que o bridge subiu, se o warm-up de `index.ts` ainda não tiver terminado (ou não
      // tiver rodado — melhor-esforço, mesmo padrão de `ensureAssemblyCompiled`).
      try {
        runPowerShellScript(`Get-Printer -Name ${psQuote(name)} | Out-Null`);
        applyPrinterCheckResult(true);
      } catch (err) {
        applyPrinterCheckResult(false, err);
      }
    } else {
      // Já tem cache — responde na hora e dispara uma atualização em paralelo, sem esperar por
      // ela; a próxima chamada já vê o resultado mais recente.
      void refreshPrinterStatusAsync(name);
    }
    return cachedPrinterStatus ?? null;
  },
  printDirect(options: PrintDirectOptions): void {
    // specs/0152 REQ-1 — `sendRawBytes` é assíncrona agora; `printDirect` não pode ser `async`
    // (contrato da lib é `success`/`error` por callback, não uma Promise retornada), então só
    // dispara e resolve via esses callbacks quando terminar — sem bloquear o processo enquanto
    // isso roda, diferente de antes.
    sendRawBytes(options.printer, options.data).then(
      () => {
        lastDriverError = undefined;
        options.success('ok');
      },
      (err: unknown) => {
        const message = describeError(err);
        lastDriverError = message;
        options.error(new Error(message));
      },
    );
  },
};
