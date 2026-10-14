import { loadConfig } from './config';

function buildEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    BFF_URL: 'https://api.bsdelivery.com.br',
    PRINT_API_KEY: 'key-123',
    PRINTER_INTERFACE: 'printer:POS-80',
    PRINTER_TYPE: 'epson',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('carrega a configuração completa', () => {
    const config = loadConfig(buildEnv());

    expect(config).toEqual({
      bffUrl: 'https://api.bsdelivery.com.br',
      apiKey: 'key-123',
      printerInterface: 'printer:POS-80',
      printerType: 'epson',
      localPrintServerPort: 48201,
    });
  });

  it('PRINTER_TYPE em branco assume "epson" por padrão', () => {
    const config = loadConfig(buildEnv({ PRINTER_TYPE: undefined }));

    expect(config.printerType).toBe('epson');
  });

  it.each(['BFF_URL', 'PRINT_API_KEY', 'PRINTER_INTERFACE'])('lança erro claro sem %s', (key) => {
    expect(() => loadConfig(buildEnv({ [key]: undefined }))).toThrow(key);
  });

  it('lança erro com PRINTER_TYPE inválido', () => {
    expect(() => loadConfig(buildEnv({ PRINTER_TYPE: 'zebra' }))).toThrow('PRINTER_TYPE');
  });

  // specs/0147-impressao-manual-direta-bridge — LOCAL_PRINT_SERVER_PORT opcional, padrão 48201.
  it('LOCAL_PRINT_SERVER_PORT em branco assume 48201 por padrão', () => {
    const config = loadConfig(buildEnv({ LOCAL_PRINT_SERVER_PORT: undefined }));

    expect(config.localPrintServerPort).toBe(48201);
  });

  it('aceita LOCAL_PRINT_SERVER_PORT customizado', () => {
    const config = loadConfig(buildEnv({ LOCAL_PRINT_SERVER_PORT: '9000' }));

    expect(config.localPrintServerPort).toBe(9000);
  });

  it('lança erro com LOCAL_PRINT_SERVER_PORT inválido', () => {
    expect(() => loadConfig(buildEnv({ LOCAL_PRINT_SERVER_PORT: 'abc' }))).toThrow('LOCAL_PRINT_SERVER_PORT');
  });
});
