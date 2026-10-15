// Mesmo contrato do Santa Fé (`lib/acao-resultado.ts`): a ação devolve o erro
// como dado e a tela o transforma de volta em erro com a mensagem original.
export type ErroAcao = { erroAcao: string };

export function exigirResultado<T>(resultado: T | ErroAcao): T {
  if (resultado && typeof resultado === "object" && "erroAcao" in resultado) throw new Error(resultado.erroAcao);
  return resultado as T;
}
