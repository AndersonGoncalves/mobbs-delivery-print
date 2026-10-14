const mockPrinter = {
  isPrinterConnected: jest.fn(),
  clear: jest.fn(),
  alignLeft: jest.fn(),
  bold: jest.fn(),
  println: jest.fn(),
  newLine: jest.fn(),
  cut: jest.fn(),
  execute: jest.fn(),
};

const thermalPrinterConstructor = jest.fn().mockImplementation(() => mockPrinter);

jest.mock('node-thermal-printer', () => ({
  printer: thermalPrinterConstructor,
  types: { EPSON: 'epson', STAR: 'star' },
}));

const fakeWindowsPrinterDriver = { name: 'fake-windows-driver' };
const getLastPrinterDriverErrorMock = jest.fn<string | undefined, []>();
jest.mock('./windowsPrinterDriver', () => ({
  windowsPrinterDriver: fakeWindowsPrinterDriver,
  getLastPrinterDriverError: () => getLastPrinterDriverErrorMock(),
}));

import { createPrinter } from './printer';

describe('createPrinter (specs/0139-impressao-automatica-bridge REQ-9/REQ-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrinter.isPrinterConnected.mockResolvedValue(true);
    getLastPrinterDriverErrorMock.mockReturnValue(undefined);
  });

  it('imprime cada linha, em negrito quando bold, e corta o papel no fim', async () => {
    const printer = createPrinter({ printerInterface: 'printer:POS-80', printerType: 'epson' });

    await printer.print([
      { text: 'EXCELENTISSIMO', bold: true },
      { text: 'ID PEDIDO: 38' },
      { text: '' },
      { text: 'TOTAL: R$84,00', bold: true },
    ]);

    expect(mockPrinter.clear).toHaveBeenCalled();
    expect(mockPrinter.println).toHaveBeenCalledWith('EXCELENTISSIMO');
    expect(mockPrinter.println).toHaveBeenCalledWith('ID PEDIDO: 38');
    expect(mockPrinter.println).toHaveBeenCalledWith('TOTAL: R$84,00');
    expect(mockPrinter.newLine).toHaveBeenCalledTimes(1);
    // bold(true) antes da linha em negrito, bold(false) depois — 2 linhas em negrito = 2 pares.
    expect(mockPrinter.bold).toHaveBeenCalledTimes(4);
    expect(mockPrinter.cut).toHaveBeenCalled();
    expect(mockPrinter.execute).toHaveBeenCalled();
  });

  it('REQ-10 — lança erro claro quando a impressora não está conectada (resolve false), sem imprimir nada', async () => {
    mockPrinter.isPrinterConnected.mockResolvedValue(false);
    const printer = createPrinter({ printerInterface: 'printer:POS-80', printerType: 'epson' });

    await expect(printer.print([{ text: 'ID PEDIDO: 38' }])).rejects.toThrow('printer:POS-80');
    expect(mockPrinter.println).not.toHaveBeenCalled();
    expect(mockPrinter.execute).not.toHaveBeenCalled();
  });

  it('specs/0146 — também lança erro claro quando isPrinterConnected rejeita (comportamento observado da lib, ver interfaces/printer.js)', async () => {
    mockPrinter.isPrinterConnected.mockRejectedValue(false);
    const printer = createPrinter({ printerInterface: 'printer:POS-80', printerType: 'epson' });

    await expect(printer.print([{ text: 'ID PEDIDO: 38' }])).rejects.toThrow('printer:POS-80');
  });

  it('specs/0146 — anexa o motivo real do PowerShell quando disponível, em vez de só a mensagem genérica', async () => {
    mockPrinter.isPrinterConnected.mockResolvedValue(false);
    getLastPrinterDriverErrorMock.mockReturnValue('Get-Printer: No matching printers found.');
    const printer = createPrinter({ printerInterface: 'printer:POS-80', printerType: 'epson' });

    await expect(printer.print([{ text: 'ID PEDIDO: 38' }])).rejects.toThrow('Get-Printer: No matching printers found.');
  });
});

describe('createPrinter — driver (specs/0144-driver-nativo-impressao-bridge REQ-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passa o driver do Windows (PowerShell/winspool) quando a interface é "printer:..."', () => {
    createPrinter({ printerInterface: 'printer:POS-80', printerType: 'epson' });

    expect(thermalPrinterConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ interface: 'printer:POS-80', driver: fakeWindowsPrinterDriver }),
    );
  });

  it('não usa driver nenhum quando a interface é de rede (tcp://...)', () => {
    createPrinter({ printerInterface: 'tcp://192.168.0.100', printerType: 'epson' });

    expect(thermalPrinterConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ interface: 'tcp://192.168.0.100', driver: undefined }),
    );
  });
});
