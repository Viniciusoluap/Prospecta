// EPIC-027 C2 (portão de QA, achado 2) — códigos do Postgres para o código novo tolerar a ordem da publicação (código antes da 0142).
const codigo = (e: unknown): unknown => {
  const c = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return c?.code ?? c?.cause?.code;
};
/** Tabela inexistente (42P01). */
export const ehTabelaInexistente = (e: unknown) => codigo(e) === "42P01";
/** Coluna inexistente (42703). */
export const ehColunaInexistente = (e: unknown) => codigo(e) === "42703";
