// EPIC-025 (Dolores) — mensagem de erro segura para LOG e auditoria (QA achado 7 da etapa 2). O Drizzle embrulha o
// erro do banco como "Failed query: <SQL>\nparams: <valores>" — e os valores podem ser o comando do dono, o texto da
// resposta ou um número de telefone. Aqui sai só a causa do banco, sem a consulta, sem os parâmetros, sem valores entre
// aspas (o Postgres cita o valor recusado: invalid input syntax … "xxx"), sem chave/token e com o filtro de dados pessoais.
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";

const TAMANHO_MAXIMO = 200;
/** Identificador entre aspas (nome de tabela, coluna, restrição) pode ficar; qualquer outro valor citado sai. */
const IDENTIFICADOR = /^[a-z_][a-z0-9_]{0,62}$/;

export function erroParaLog(e: unknown): string {
  const causa = e instanceof Error && e.cause instanceof Error ? e.cause.message : null;
  let texto = causa ?? (e instanceof Error ? e.message : String(e ?? "erro"));
  // a consulta e os parâmetros nunca saem (mesmo quando não há causa separada)
  if (/failed query/i.test(texto)) texto = texto.replace(/failed query[\s\S]*$/i, "falha na consulta ao banco");
  texto = texto.replace(/\bparams?\s*:[\s\S]*$/i, "").trim() || "falha na consulta ao banco";
  texto = texto
    .replace(/"([^"]*)"/g, (m, dentro: string) => (IDENTIFICADOR.test(dentro) ? m : "\"…\""))
    .replace(/'([^']*)'/g, (m, dentro: string) => (IDENTIFICADOR.test(dentro) ? m : "'…'"))
    .replace(/sk-ant-[\w-]*/g, "sk-ant-…")
    .replace(/Bearer\s+\S+/gi, "Bearer [omitido]");
  // log e auditoria: sempre com o mascaramento ligado, qualquer que seja DOLORES_MASCARAR_DADOS_PESSOAIS
  return sanitizarTexto(texto, FILTRO_DO_REGISTRO).replace(/\s+/g, " ").slice(0, TAMANHO_MAXIMO);
}
