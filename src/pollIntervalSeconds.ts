// Mesmo intervalo válido (5-120s) já documentado/clampado na retaguarda web
// (`AutoPrintSettingsPage.handleIntervalBlur`, specs/0139-impressao-automatica-bridge REQ-6).
export const MIN_POLL_INTERVAL_SECONDS = 5;
export const MAX_POLL_INTERVAL_SECONDS = 120;

/**
 * Achado de auditoria pré-produção (01/11/2026) — "pollIntervalSeconds vindo do BFF não é
 * validado": `index.ts` usava `result.pollIntervalSeconds` direto no `setTimeout` do próximo
 * ciclo sem checar nada — um valor malformado (0, negativo, NaN, ou um restaurante antigo sem o
 * campo configurado) fazia o bridge martelar o BFF sem nenhuma pausa entre tentativas. Sem
 * `Number.isFinite`/limite, mantém o último intervalo válido conhecido (`fallback`) em vez de
 * aceitar o valor recebido.
 */
export function sanitizePollIntervalSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_POLL_INTERVAL_SECONDS, Math.max(MIN_POLL_INTERVAL_SECONDS, value));
}
