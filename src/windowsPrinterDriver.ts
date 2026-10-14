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
 */

// RawPrinterHelper — adaptação do exemplo oficial da Microsoft (KB322090, "How to send raw data
// to a printer") pra PowerShell via `Add-Type`. `winspool.drv` é a API nativa do Windows pra fila
// de impressão; `StartDocPrinter`/`WritePrinter` com `pDataType = "RAW"` envia os bytes sem
// nenhum processamento/paginação do driver gráfico — exatamente o modo ESC/POS espera.
const RAW_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)
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

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$errorMessage = ""
$ok = [MobbsRawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes, [ref]$errorMessage)
if (-not $ok) {
    Write-Error $errorMessage
    exit 1
}
exit 0
`;

function runPowerShell(args: string[]): void {
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true });
}

function sendRawBytes(printerName: string, data: Buffer): void {
  const dir = mkdtempSync(join(tmpdir(), 'mobbs-delivery-print-'));
  const scriptPath = join(dir, 'raw-print.ps1');
  const dataPath = join(dir, 'job.bin');
  try {
    writeFileSync(scriptPath, RAW_PRINT_SCRIPT, 'utf-8');
    writeFileSync(dataPath, data);
    runPowerShell(['-File', scriptPath, '-PrinterName', printerName, '-FilePath', dataPath]);
  } finally {
    try {
      unlinkSync(scriptPath);
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
      runPowerShell(['-Command', `Get-Printer -Name '${name.replace(/'/g, "''")}' | Out-Null`]);
      return { status: ['OK'] };
    } catch {
      return null;
    }
  },
  printDirect(options: PrintDirectOptions): void {
    try {
      sendRawBytes(options.printer, options.data);
      options.success('ok');
    } catch (err) {
      options.error(err instanceof Error ? err : new Error(String(err)));
    }
  },
};
