import axios from 'axios';
import { BffClient } from './bffClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BffClient (specs/0139-impressao-automatica-bridge)', () => {
  const http = { get: jest.fn(), post: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(http as never);
  });

  it('autentica com o header X-Print-Api-Key e consulta a fila', async () => {
    const client = new BffClient({ bffUrl: 'https://api.bsdelivery.com.br', apiKey: 'key-123' });
    http.get.mockResolvedValue({ data: { pollIntervalSeconds: 10, orders: [] } });

    const result = await client.fetchPendingOrders();

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.bsdelivery.com.br', headers: { 'X-Print-Api-Key': 'key-123' } }),
    );
    expect(http.get).toHaveBeenCalledWith('/restaurants/me/print-queue/pending');
    expect(result).toEqual({ pollIntervalSeconds: 10, orders: [] });
  });

  it('confirma a impressão de um pedido', async () => {
    const client = new BffClient({ bffUrl: 'https://api.bsdelivery.com.br', apiKey: 'key-123' });
    http.post.mockResolvedValue({});

    await client.markPrinted('o-1');

    expect(http.post).toHaveBeenCalledWith('/restaurants/me/print-queue/o-1/printed');
  });
});
