import { sanitizePollIntervalSeconds } from './pollIntervalSeconds';

describe('sanitizePollIntervalSeconds (achado de auditoria pré-produção, 01/11/2026)', () => {
  it('valor dentro do intervalo válido (5-120) passa direto', () => {
    expect(sanitizePollIntervalSeconds(15, 10)).toBe(15);
  });

  it('0 — martelaria o BFF sem pausa — é limitado ao mínimo (5)', () => {
    expect(sanitizePollIntervalSeconds(0, 10)).toBe(5);
  });

  it('negativo cai pro mínimo (5)', () => {
    expect(sanitizePollIntervalSeconds(-3, 10)).toBe(5);
  });

  it('acima do máximo documentado (120) é limitado a 120', () => {
    expect(sanitizePollIntervalSeconds(999, 10)).toBe(120);
  });

  it('NaN mantém o último intervalo válido conhecido (fallback), não um valor fixo arbitrário', () => {
    expect(sanitizePollIntervalSeconds(NaN, 15)).toBe(15);
  });

  it('Infinity mantém o fallback', () => {
    expect(sanitizePollIntervalSeconds(Infinity, 15)).toBe(15);
  });
});
