import { ensureConfigured, normalizePrinterInterface, SetupIO } from './setup';

function buildIO(answers: string[]): SetupIO & { questions: string[]; logs: string[]; closed: boolean } {
  const questions: string[] = [];
  const logs: string[] = [];
  let i = 0;
  return {
    questions,
    logs,
    closed: false,
    question: async (prompt: string) => {
      questions.push(prompt);
      const answer = answers[i];
      i += 1;
      return answer ?? '';
    },
    log: (message: string) => logs.push(message),
    close() {
      this.closed = true;
    },
  };
}

describe('ensureConfigured', () => {
  it('não pergunta nada quando o .env já existe', async () => {
    const io = buildIO([]);
    const exists = jest.fn().mockReturnValue(true);
    const write = jest.fn();

    await ensureConfigured('/configs', io, exists, write);

    expect(exists).toHaveBeenCalledWith('/configs/.env');
    expect(io.questions).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('pergunta tudo e grava o .env quando ele não existe', async () => {
    const io = buildIO(['', 'minha-chave', 'printer:POS-80', '']);
    const exists = jest.fn().mockReturnValue(false);
    const write = jest.fn().mockResolvedValue(undefined);

    await ensureConfigured('/configs', io, exists, write);

    expect(io.questions).toHaveLength(4);
    expect(write).toHaveBeenCalledWith(
      '/configs/.env',
      [
        'BFF_URL=https://api.bsdelivery.com.br',
        'PRINT_API_KEY=minha-chave',
        'PRINTER_INTERFACE=printer:POS-80',
        'PRINTER_TYPE=epson',
        '',
      ].join('\n'),
    );
    expect(io.closed).toBe(true);
  });

  it('repete a pergunta quando a Chave de API vem em branco', async () => {
    const io = buildIO(['', '', '', 'chave-valida', 'printer:POS-80', 'star']);
    const exists = jest.fn().mockReturnValue(false);
    const write = jest.fn().mockResolvedValue(undefined);

    await ensureConfigured('/configs', io, exists, write);

    expect(io.logs).toContain('Esse campo é obrigatório.');
    expect(write).toHaveBeenCalledWith(
      '/configs/.env',
      expect.stringContaining('PRINT_API_KEY=chave-valida'),
    );
    expect(write).toHaveBeenCalledWith('/configs/.env', expect.stringContaining('PRINTER_TYPE=star'));
  });

  it('repete a pergunta quando o tipo da impressora é inválido', async () => {
    const io = buildIO(['', 'chave', 'printer:POS-80', 'zebra', 'epson']);
    const exists = jest.fn().mockReturnValue(false);
    const write = jest.fn().mockResolvedValue(undefined);

    await ensureConfigured('/configs', io, exists, write);

    expect(io.logs).toContain('Digite "epson" ou "star".');
    expect(write).toHaveBeenCalledWith('/configs/.env', expect.stringContaining('PRINTER_TYPE=epson'));
  });

  it('fecha a interface de I/O mesmo se a escrita falhar', async () => {
    const io = buildIO(['', 'chave', 'printer:POS-80', '']);
    const exists = jest.fn().mockReturnValue(false);
    const write = jest.fn().mockRejectedValue(new Error('disco cheio'));

    await expect(ensureConfigured('/configs', io, exists, write)).rejects.toThrow('disco cheio');
    expect(io.closed).toBe(true);
  });

  // specs/0149-prefixo-interface-impressora — achado com um usuário real: digitar só o nome da
  // impressora (sem "printer:") faz a lib tratar como caminho de arquivo, nunca encontra a
  // impressora de verdade.
  it('completa "printer:" sozinho quando o usuário digita só o nome da impressora', async () => {
    const io = buildIO(['', 'chave', 'MP-4200', '']);
    const exists = jest.fn().mockReturnValue(false);
    const write = jest.fn().mockResolvedValue(undefined);

    await ensureConfigured('/configs', io, exists, write);

    expect(write).toHaveBeenCalledWith('/configs/.env', expect.stringContaining('PRINTER_INTERFACE=printer:MP-4200'));
  });
});

describe('normalizePrinterInterface', () => {
  it('completa "printer:" quando a resposta não tem nenhum prefixo reconhecido', () => {
    expect(normalizePrinterInterface('MP-4200')).toBe('printer:MP-4200');
    expect(normalizePrinterInterface('MP-4200 TH')).toBe('printer:MP-4200 TH');
  });

  it('não mexe quando já tem o prefixo "printer:"', () => {
    expect(normalizePrinterInterface('printer:MP-4200')).toBe('printer:MP-4200');
  });

  it('não mexe numa interface de rede (tcp://...)', () => {
    expect(normalizePrinterInterface('tcp://192.168.0.100')).toBe('tcp://192.168.0.100');
  });

  it('não mexe num caminho de dispositivo absoluto (Linux/Windows)', () => {
    expect(normalizePrinterInterface('/dev/usb/lp0')).toBe('/dev/usb/lp0');
    expect(normalizePrinterInterface('\\\\.\\COM1')).toBe('\\\\.\\COM1');
  });
});
