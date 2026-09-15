// Funcao pura que decide se um JWT ja emitido ainda e valido, comparando com o
// estado atual do usuario no banco (createContext ja recarrega o usuario por ID
// em toda requisicao - ver server/_core/context.ts). Sem essa checagem, um token
// emitido no login continuaria valido ate expirar (30 dias) mesmo apos a senha
// ser redefinida (server/configuracoes-router.ts, resetPassword).
export function sessaoAindaValida(
  usuarioAtual: { active: boolean; sessionVersion: number } | null | undefined,
  sessionVersionDoToken: number | undefined,
): boolean {
  if (!usuarioAtual || !usuarioAtual.active) return false;
  return usuarioAtual.sessionVersion === sessionVersionDoToken;
}
