// EPIC-025 E11 (conversa direta) — a CONFERÊNCIA, no servidor, de que uma ação reversível pedida pelo dono pode rodar sem o "pode":
// os ALVOS (grupo e cliente/obra) saíram das palavras que ELE digitou, por código — nunca de um texto lido (documento, conversa de
// cliente, nome de terceiro) nem da opinião do modelo. Regras puras em shared/dolores/ordem-direta.ts.
//
// Como um alvo fica "provado" (todas as consultas são SOMENTE LEITURA):
// - grupo: o CÓDIGO dele está na mensagem do dono, ou as palavras dele apontam UM só grupo pelo nome (empate → não provado). Para
//   aceitar grupo (outra pessoa a colocou), só o código.
// - cliente: "cliente N"/"nº N" na mensagem, ou as palavras dele apontam UM só cliente ativo, ou o cliente é o ÚNICO cujo nome está
//   no nome do grupo (regra do dono de 19/11, `descobrirTipoDoGrupo`, por código).
// - obra (engenharia): "obra N" na mensagem, ou as palavras apontam UMA obra pelo título; sem obra, só o grupo.
// - e a mensagem tem o verbo da função (`intencaoDaFuncao`) e o tipo é o que ele disse (`tipoDitoPeloDono`).
// Faltou qualquer coisa → { ok: false } e a ação segue o caminho de sempre (UMA confirmação). Falha de banco → não provado.
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { descobrirTipoDoGrupo, type ClienteParaTipo } from "../../shared/dolores/grupos-tipo.js";
import {
  codigoCitado, escolherPorNome, exigeCodigoDigitado, intencaoDaFuncao, numeroCitado, palavrasQueIdentificam, podeExecutarPorOrdemDireta, tipoDitoPeloDono,
} from "../../shared/dolores/ordem-direta.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { erroParaLog } from "./erro-seguro.js";
import { bancoDaLeitura } from "./somente-leitura.js";

/** Teto das leituras (as tabelas são pequenas; o teto só garante que a conferência é barata). */
export const MAX_GRUPOS_CONFERIDOS = 2_000;
export const MAX_CLIENTES_CONFERIDOS = 20_000;
export const MAX_CANDIDATOS_POR_PALAVRA = 300;

const SEM_ACENTO_DE = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO_PARA = "aaaaaeeeeiiiiooooouuuucn";
/** Nome normalizado no SQL (minúsculo, sem acento) contém a palavra. A palavra já vem normalizada (só a-z0-9). */
const contem = (coluna: SQL | typeof leads.name, palavra: string) =>
  sql`translate(lower(${coluna}), ${SEM_ACENTO_DE}, ${SEM_ACENTO_PARA}) LIKE ${`%${palavra.replace(/[^a-z0-9]/g, "")}%`}`;

/** Clientes ativos cujo nome contém alguma das palavras (para escolher UM pelas palavras do dono). */
export async function clientesPelasPalavras(palavras: readonly string[]): Promise<ClienteParaTipo[]> {
  const ps = Array.from(new Set(palavras)).slice(0, 8);
  if (!ps.length) return [];
  return bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads)
    .where(and(isNull(leads.deletedAt), or(...ps.map(p => contem(leads.name, p))))).limit(MAX_CANDIDATOS_POR_PALAVRA);
}

async function clientesAtivos(): Promise<ClienteParaTipo[]> {
  return bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads).where(isNull(leads.deletedAt)).limit(MAX_CLIENTES_CONFERIDOS);
}

/**
 * O cliente do grupo pelo NOME do grupo (regra do dono de 19/11, `descobrirTipoDoGrupo`, com o nível nome + sobrenome da E11): UM →
 * o id; mais de um → os candidatos (id e nome, para a Dolores oferecer os nomes); nenhum → vazio.
 */
export async function clienteDoNomeDoGrupo(g: Pick<DoloresGrupo, "nome" | "nomeWhatsapp">): Promise<{ leadId: number | null; candidatos: ClienteParaTipo[] }> {
  const clientes = await clientesAtivos();
  const d = descobrirTipoDoGrupo(g.nomeWhatsapp ?? g.nome, clientes);
  if ((d.tipo === "cliente" || d.tipo === "pos_atendimento") && d.leadId) return { leadId: d.leadId, candidatos: [] };
  const ids = new Set(d.candidatos ?? []);
  return { leadId: null, candidatos: clientes.filter(c => ids.has(c.id)).slice(0, 5) };
}

export type Prova = { ok: true } | { ok: false; motivo: string };
const nao = (motivo: string): Prova => ({ ok: false, motivo });

/**
 * A ação reversível `funcao(argumentos)` (como o modelo pediu) tem a intenção e os alvos nas palavras do dono (`textoDoDono`)?
 * Nunca lança: falha → não provado (segue a confirmação).
 */
export async function provarAlvosDoDono(funcao: string, argumentos: unknown, textoDoDono: string): Promise<Prova> {
  try {
    if (!podeExecutarPorOrdemDireta(funcao, argumentos)) return nao("função fora da lista da ordem direta");
    if (!intencaoDaFuncao(funcao, textoDoDono)) return nao("a mensagem do dono não tem o verbo desta ação");
    const a = (argumentos ?? {}) as { grupoId?: unknown; tipo?: unknown; leadId?: unknown; obraId?: unknown };
    const grupoId = Number(a.grupoId);
    if (!Number.isSafeInteger(grupoId) || grupoId <= 0) return nao("grupo inválido");
    const cfg = await lerConfigWhatsapp().catch(() => null);
    const grupos = await bancoDaLeitura().select({ id: doloresGrupos.id, codigo: doloresGrupos.codigo, nome: doloresGrupos.nome, nomeWhatsapp: doloresGrupos.nomeWhatsapp,
      instancia: doloresGrupos.instancia }).from(doloresGrupos).where(cfg?.instancia ? eq(doloresGrupos.instancia, cfg.instancia) : undefined).limit(MAX_GRUPOS_CONFERIDOS);
    const alvo = grupos.find(g => g.id === grupoId);
    if (!alvo) return nao("grupo não é da conexão da empresa");
    const palavras = palavrasQueIdentificam(textoDoDono);
    const porCodigo = codigoCitado(textoDoDono, alvo.codigo);
    const porNome = escolherPorNome(palavras, grupos.map(g => ({ id: g.id, nome: g.nomeWhatsapp ?? g.nome }))).escolhido === alvo.id;
    if (!porCodigo && (exigeCodigoDigitado(funcao) || !porNome)) return nao(exigeCodigoDigitado(funcao) ? "aceitar grupo só com o código digitado pelo dono" : "o grupo não saiu das palavras do dono");
    if (funcao !== "classificar_grupo") return { ok: true };
    const tipo = String(a.tipo);
    if (!tipoDitoPeloDono(tipo, textoDoDono)) return nao("o tipo não é o que o dono disse");
    if (tipo === "cliente" || tipo === "pos_atendimento") {
      const leadId = Number(a.leadId);
      if (!Number.isSafeInteger(leadId) || leadId <= 0) return nao("sem cliente");
      if (numeroCitado(textoDoDono, leadId)) return { ok: true };
      const pelasPalavras = escolherPorNome(palavras, await clientesPelasPalavras(palavras)).escolhido;
      if (pelasPalavras === leadId) return { ok: true };
      // o cliente que o NOME DO GRUPO aponta (um só), pela regra do dono — só se as palavras dele não apontaram OUTRO cliente
      if (pelasPalavras === null && (await clienteDoNomeDoGrupo(alvo)).leadId === leadId) return { ok: true };
      return nao("o cliente não saiu das palavras do dono nem do nome do grupo");
    }
    // engenharia: com obra, a obra também precisa sair das palavras dele
    if (a.obraId === undefined || a.obraId === null) return { ok: true };
    const obraId = Number(a.obraId);
    if (numeroCitado(textoDoDono, obraId)) return { ok: true };
    const obras = palavras.length ? await bancoDaLeitura().select({ id: constructionProjects.id, nome: constructionProjects.title }).from(constructionProjects)
      .where(or(...palavras.slice(0, 8).map(p => contem(sql`${constructionProjects.title}`, p)))).limit(MAX_CANDIDATOS_POR_PALAVRA) : [];
    return escolherPorNome(palavras, obras).escolhido === obraId ? { ok: true } : nao("a obra não saiu das palavras do dono");
  } catch (e) {
    console.error("[dolores/ordem-direta] não consegui conferir os alvos; segue a confirmação", erroParaLog(e));
    return nao("falha ao conferir");
  }
}
