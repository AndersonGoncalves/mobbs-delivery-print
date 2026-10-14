import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

// RawPrinterHelper — adaptação do exemplo oficial da Microsoft (KB322090, "How to send raw data
// to a printer"), definido uma vez via `Add-Type` dentro do script de cada chamada.
// `winspool.drv` é a API nativa do Windows pra fila de impressão; `StartDocPrinter`/`WritePrinter`
// com `pDataType = "RAW"` envia os bytes sem nenhum processamento/paginação do driver gráfico —
// exatamente o modo ESC/POS espera.
const RAW_PRINTER_HELPER_TYPE_DEF = `
Add-Type -TypeDefinition @"
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
"@
`;

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildEncodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShellScript(script: string): void {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', buildEncodedCommand(script)],
    { windowsHide: true, encoding: 'utf-8' },
  );
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

function sendRawBytes(printerName: string, data: Buffer): void {
  const dir = mkdtempSync(join(tmpdir(), 'mobbs-delivery-print-'));
  const dataPath = join(dir, 'job.bin');
  try {
    writeFileSync(dataPath, data);
    const script = `
${RAW_PRINTER_HELPER_TYPE_DEF}
$bytes = [System.IO.File]::ReadAllBytes(${psQuote(dataPath)})
$errorMessage = ""
$ok = [MobbsRawPrinterHelper]::SendBytesToPrinter(${psQuote(printerName)}, $bytes, [ref]$errorMessage)
if (-not $ok) {
    Write-Error $errorMessage
    exit 1
}
exit 0
`;
    runPowerShellScript(script);
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
    try {
      runPowerShellScript(`Get-Printer -Name ${psQuote(name)} | Out-Null`);
      lastDriverError = undefined;
      return { status: ['OK'] };
    } catch (err) {
      lastDriverError = describeError(err);
      return null;
    }
  },
  printDirect(options: PrintDirectOptions): void {
    try {
      sendRawBytes(options.printer, options.data);
      lastDriverError = undefined;
      options.success('ok');
    } catch (err) {
      const message = describeError(err);
      lastDriverError = message;
      options.error(new Error(message));
    }
  },
};
