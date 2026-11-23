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
import { and, desc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMemoriaLonga } from "../../drizzle/schema-dolores-memoria-longa.js";
import { ROTULO_TIPO_AVISO, TIPOS_AVISO } from "../../shared/dolores/avisos.js";
import { getAssignableUsers } from "../db.js";
import { descobrirTipoDoGrupo, type ClienteParaTipo } from "../../shared/dolores/grupos-tipo.js";
import {
  codigoCitado, direcaoDoAvisoDita, escolherPorNome, exigeCodigoDigitado, intencaoDaFuncao, numeroCitado, palavrasQueIdentificam, podeExecutarPorOrdemDireta,
  textoSaiuDoDono, tipoDitoPeloDono,
} from "../../shared/dolores/ordem-direta.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { erroParaLog } from "./erro-seguro.js";
import { bancoDaLeitura } from "./somente-leitura.js";
import { doloresAprovacoes } from "../../drizzle/schema-dolores-fila.js";
import { comoDesfazer } from "../../shared/dolores/ordem-direta.js";
import { textoDeDado } from "../../shared/dolores/fila.js";

/** Teto das leituras (as tabelas são pequenas; o teto só garante que a conferência é barata). */
export const MAX_GRUPOS_CONFERIDOS = 2_000;
export const MAX_CLIENTES_CONFERIDOS = 20_000;
export const MAX_CANDIDATOS_POR_PALAVRA = 300;

const SEM_ACENTO_DE = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO_PARA = "aaaaaeeeeiiiiooooouuuucn";
/** Nome normalizado no SQL (minúsculo, sem acento) contém a palavra. A palavra já vem normalizada (só a-z0-9). */
const contem = (coluna: SQL | typeof leads.name, palavra: string) =>
  sql`translate(lower(${coluna}), ${SEM_ACENTO_DE}, ${SEM_ACENTO_PARA}) LIKE ${`%${palavra.replace(/[^a-z0-9]/g, "")}%`}`;

/**
 * Clientes ativos cujo nome contém alguma das palavras. Portão de QA E11 (B2): `cortado` = passou do teto (quem usa trata como
 * AMBÍGUO — um cliente nunca sai "único" só porque os outros ficaram fora do corte).
 */
export async function clientesPelasPalavras(palavras: readonly string[]): Promise<{ clientes: ClienteParaTipo[]; cortado: boolean }> {
  const ps = Array.from(new Set(palavras)).slice(0, 8);
  if (!ps.length) return { clientes: [], cortado: false };
  const linhas = await bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads)
    .where(and(isNull(leads.deletedAt), or(...ps.map(p => contem(leads.name, p))))).limit(MAX_CANDIDATOS_POR_PALAVRA + 1);
  return { clientes: linhas.slice(0, MAX_CANDIDATOS_POR_PALAVRA), cortado: linhas.length > MAX_CANDIDATOS_POR_PALAVRA };
}

async function clientesAtivos(): Promise<ClienteParaTipo[]> {
  return bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads).where(isNull(leads.deletedAt)).limit(MAX_CLIENTES_CONFERIDOS);
}

/**
 * O cliente do grupo pelo NOME do grupo (regra do dono de 19/11, `descobrirTipoDoGrupo`, com o nível nome + sobrenome da E11): UM →
 * o id; mais de um → os candidatos (id e nome, para a Dolores oferecer os nomes); nenhum → vazio.
 */
export async function clienteDoNomeDoGrupo(g: Pick<DoloresGrupo, "nome" | "nomeWhatsapp"> & { adicionadoPor?: string | null; origem?: string | null },
  /** `parcial`: aceita o nível nome + sobrenome. Padrão: só para grupo do dono (QA E11, M3); `true` só para SUGERIR numa pergunta. */
  o: { parcial?: boolean } = {}): Promise<{ leadId: number | null; candidatos: ClienteParaTipo[] }> {
  const clientes = await clientesAtivos();
  // QA E11 (M3): grupo que outra pessoa (ou não se sabe quem) criou: para PROVAR, só o nome INTEIRO conta — o nome é texto de terceiro
  const d = descobrirTipoDoGrupo(g.nomeWhatsapp ?? g.nome, clientes, { parcial: o.parcial ?? grupoDoDono(g) });
  if ((d.tipo === "cliente" || d.tipo === "pos_atendimento") && d.leadId) return { leadId: d.leadId, candidatos: [] };
  const ids = new Set(d.candidatos ?? []);
  return { leadId: null, candidatos: clientes.filter(c => ids.has(c.id)).slice(0, 5) };
}

/** O dono pôs a Dolores no grupo (ou o grupo foi cadastrado à mão pela equipe)? */
export const grupoDoDono = (g: { adicionadoPor?: string | null; origem?: string | null }) => g.adicionadoPor === "dono" || g.origem === "manual";

/**
 * `pergunta` (E11b): o nome que ele digitou aponta MAIS de um cliente/responsável — em vez de uma confirmação com um deles, a Dolores
 * pergunta qual, com os nomes (texto do sistema). Nada é posto na fila.
 */
export type Prova = { ok: true } | { ok: false; motivo: string; pergunta?: string };
const nao = (motivo: string, pergunta?: string): Prova => ({ ok: false, motivo, ...(pergunta ? { pergunta } : {}) });
const SIM: Prova = { ok: true };
const nomesEntreAspas = (nomes: ReadonlyArray<string | null>) => {
  const l = nomes.slice(0, 5).map(n => `«${String(n ?? "(sem nome)").replace(/[«»\r\n]/g, " ").trim().slice(0, 60)}»`);
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} ou ${l.at(-1)}` : l.join("");
};

/** Cliente (lead) apontado pelas palavras dele: "cliente N"/"nº N", ou UM cliente ativo pelo nome; empate → pergunta com os nomes. */
async function provarCliente(leadId: unknown, textoDoDono: string, palavras: string[]): Promise<Prova> {
  const id = Number(leadId);
  if (!Number.isSafeInteger(id) || id <= 0) return nao("sem cliente");
  if (numeroCitado(textoDoDono, id)) return SIM;
  const achados = await clientesPelasPalavras(palavras);
  // QA E11 (B2): passou do teto → ambíguo
  if (achados.cortado) return nao("nome comum demais: muitos clientes");
  const candidatos = achados.clientes;
  const e = escolherPorNome(palavras, candidatos);
  if (e.escolhido === id) return SIM;
  if (e.empatados.length > 1 && e.empatados.includes(id)) {
    return nao("o nome aponta mais de um cliente", `Qual cliente: ${nomesEntreAspas(candidatos.filter(c => e.empatados.includes(c.id)).map(c => c.nome))}? Nada foi feito ainda.`);
  }
  return nao("o cliente não saiu das palavras do dono");
}

async function provarObra(obraId: unknown, textoDoDono: string, palavras: string[]): Promise<Prova> {
  const id = Number(obraId);
  if (!Number.isSafeInteger(id) || id <= 0) return nao("sem obra");
  if (numeroCitado(textoDoDono, id)) return SIM;
  const obras = palavras.length ? await bancoDaLeitura().select({ id: constructionProjects.id, nome: constructionProjects.title }).from(constructionProjects)
    .where(or(...palavras.slice(0, 8).map(p => contem(sql`${constructionProjects.title}`, p)))).limit(MAX_CANDIDATOS_POR_PALAVRA) : [];
  return escolherPorNome(palavras, obras).escolhido === id ? SIM : nao("a obra não saiu das palavras do dono");
}

/** Responsável da tarefa: o nome pedido resolve para UM usuário da equipe e é esse que as palavras dele apontam (empate → pergunta). */
async function provarResponsavel(responsavel: unknown, palavras: string[]): Promise<Prova> {
  const equipe = (await getAssignableUsers(bancoDaLeitura() as never)).filter(u => u.name?.trim());
  const pedido = palavrasQueIdentificam(String(responsavel ?? ""));
  if (!pedido.some(p => palavras.includes(p))) return nao("o responsável não saiu das palavras do dono");
  const e = escolherPorNome(palavras, equipe.map(u => ({ id: u.id, nome: u.name })));
  if (e.empatados.length > 1) return nao("o nome aponta mais de uma pessoa da equipe", `Para quem é a tarefa: ${nomesEntreAspas(equipe.filter(u => e.empatados.includes(u.id)).map(u => u.name))}? Nada foi feito ainda.`);
  const doPedido = escolherPorNome(pedido, equipe.map(u => ({ id: u.id, nome: u.name }))).escolhido;
  return e.escolhido !== null && e.escolhido === doPedido ? SIM : nao("o responsável não é o que o dono disse");
}

/** A lembrança (corrigir/esquecer) que as palavras dele apontam entre as ATIVAS. */
async function provarMemoria(memoriaId: unknown, palavras: string[]): Promise<Prova> {
  const id = Number(memoriaId);
  if (!Number.isSafeInteger(id) || id <= 0) return nao("sem lembrança");
  const ativas = await bancoDaLeitura().select({ id: doloresMemoriaLonga.id, nome: doloresMemoriaLonga.texto }).from(doloresMemoriaLonga)
    .where(eq(doloresMemoriaLonga.situacao, "ativa")).limit(500);
  return escolherPorNome(palavras, ativas).escolhido === id ? SIM : nao("a lembrança não saiu das palavras do dono");
}

/** E11b — os registros (tarefa, anotação, memória, aviso): texto gravado e alvos das palavras do dono. */
async function provarRegistro(funcao: string, a: Record<string, unknown>, textoDoDono: string, palavras: string[]): Promise<Prova> {
  switch (funcao) {
    case "criar_tarefa": {
      if (!textoSaiuDoDono(String(a.titulo ?? ""), textoDoDono)) return nao("o título da tarefa não saiu das palavras do dono");
      if (a.descricao && !textoSaiuDoDono(String(a.descricao), textoDoDono)) return nao("a descrição não saiu das palavras do dono");
      const quem = await provarResponsavel(a.responsavel, palavras);
      if (!quem.ok) return quem;
      const v = a.vinculo as { tipo?: unknown; id?: unknown } | undefined;
      if (!v) return SIM;
      return v.tipo === "cliente" ? provarCliente(v.id, textoDoDono, palavras) : v.tipo === "obra" ? provarObra(v.id, textoDoDono, palavras) : nao("vínculo inválido");
    }
    case "registrar_acompanhamento": {
      if (!textoSaiuDoDono(String(a.texto ?? ""), textoDoDono)) return nao("a anotação não saiu das palavras do dono");
      // "ligação" só quando ele disse que ligou
      if (a.tipo === "ligacao" && !/\b(?:ligac\w*|ligu\w*|ligou|ligamos|telefon\w*)\b/.test(textoDoDono.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())) return nao("o dono não disse que houve ligação");
      return provarCliente(a.leadId, textoDoDono, palavras);
    }
    case "guardar_memoria": {
      if (!textoSaiuDoDono(String(a.texto ?? ""), textoDoDono)) return nao("a lembrança não saiu das palavras do dono");
      if (a.leadId) return provarCliente(a.leadId, textoDoDono, palavras);
      if (a.obraId) return provarObra(a.obraId, textoDoDono, palavras);
      return SIM;
    }
    case "corrigir_memoria": {
      if (!textoSaiuDoDono(String(a.texto ?? ""), textoDoDono)) return nao("o texto novo não saiu das palavras do dono");
      return provarMemoria(a.memoriaId, palavras);
    }
    case "esquecer_memoria": return provarMemoria(a.memoriaId, palavras);
    case "silenciar_aviso": {
      if (typeof a.silenciar !== "boolean" || !direcaoDoAvisoDita(a.silenciar, textoDoDono)) return nao("a direção (parar/voltar) não é a que o dono disse");
      const i = (TIPOS_AVISO as readonly string[]).indexOf(String(a.tipo));
      if (i < 0) return nao("tipo de aviso inválido");
      const tipos = TIPOS_AVISO.map((t, j) => ({ id: j + 1, nome: `${t.replace(/_/g, " ")} ${ROTULO_TIPO_AVISO[t]}` }));
      return escolherPorNome(palavras, tipos).escolhido === i + 1 ? SIM : nao("o tipo de aviso não saiu das palavras do dono");
    }
    default: return nao("função fora da lista");
  }
}

/**
 * A ação reversível `funcao(argumentos)` (como o modelo pediu) tem a intenção e os alvos nas palavras do dono (`textoDoDono`)?
 * Nunca lança: falha → não provado (segue a confirmação).
 */
export async function provarAlvosDoDono(funcao: string, argumentos: unknown, textoDoDono: string): Promise<Prova> {
  try {
    if (!podeExecutarPorOrdemDireta(funcao, argumentos)) return nao("função fora da lista da ordem direta");
    if (!intencaoDaFuncao(funcao, textoDoDono)) return nao("a mensagem do dono não tem o verbo desta ação");
    const a = (argumentos ?? {}) as { grupoId?: unknown; tipo?: unknown; leadId?: unknown; obraId?: unknown };
    if (!String(funcao).endsWith("_grupo")) return await provarRegistro(funcao, a as Record<string, unknown>, textoDoDono, palavrasQueIdentificam(textoDoDono));
    const grupoId = Number(a.grupoId);
    if (!Number.isSafeInteger(grupoId) || grupoId <= 0) return nao("grupo inválido");
    const cfg = await lerConfigWhatsapp().catch(() => null);
    const grupos = await bancoDaLeitura().select({ id: doloresGrupos.id, codigo: doloresGrupos.codigo, nome: doloresGrupos.nome, nomeWhatsapp: doloresGrupos.nomeWhatsapp,
      instancia: doloresGrupos.instancia, adicionadoPor: doloresGrupos.adicionadoPor, origem: doloresGrupos.origem })
      .from(doloresGrupos).where(cfg?.instancia ? eq(doloresGrupos.instancia, cfg.instancia) : undefined).limit(MAX_GRUPOS_CONFERIDOS);
    const alvo = grupos.find(g => g.id === grupoId);
    if (!alvo) return nao("grupo não é da conexão da empresa");
    const palavras = palavrasQueIdentificam(textoDoDono);
    const nomeDoAlvo = new Set(palavrasQueIdentificam(alvo.nomeWhatsapp ?? alvo.nome));
    // QA E11 (qualidade: dois grupos numa mensagem): o grupo é provado pelas palavras dele QUE ESTÃO no nome deste grupo — e essas
    // palavras precisam apontar só este grupo (outro grupo com o mesmo nome → empate → não provado)
    const doGrupo = palavras.filter(p => nomeDoAlvo.has(p));
    const porCodigo = codigoCitado(textoDoDono, alvo.codigo);
    const porNome = doGrupo.length > 0 && escolherPorNome(doGrupo, grupos.map(g => ({ id: g.id, nome: g.nomeWhatsapp ?? g.nome }))).escolhido === alvo.id;
    if (!porCodigo && (exigeCodigoDigitado(funcao) || !porNome)) return nao(exigeCodigoDigitado(funcao) ? "aceitar grupo só com o código digitado pelo dono" : "o grupo não saiu das palavras do dono");
    if (funcao !== "classificar_grupo") return { ok: true };
    const tipo = String(a.tipo);
    if (!tipoDitoPeloDono(tipo, textoDoDono)) return nao("o tipo não é o que o dono disse");
    if (tipo === "cliente" || tipo === "pos_atendimento") {
      const leadId = Number(a.leadId);
      if (!Number.isSafeInteger(leadId) || leadId <= 0) return nao("sem cliente");
      // Portão de QA E11 (I1) — o PAR grupo↔cliente: (a) "cliente N" escrito; (b) o cliente que o NOME DO GRUPO aponta (um só; grupo de
      // terceiro, só o nome inteiro); (c) as palavras que escolheram o grupo estão no nome do cliente E nenhum outro cliente pontua com
      // as palavras dele que estão FORA do nome do grupo ("ela é prima da maria dayane" → não prova a Maria).
      if (numeroCitado(textoDoDono, leadId)) return { ok: true };
      if ((await clienteDoNomeDoGrupo(alvo)).leadId === leadId) return { ok: true };
      const [l] = await bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1);
      const nomeDoCliente = new Set(palavrasQueIdentificam(l?.nome));
      if (!l || !doGrupo.length || !doGrupo.every(p => nomeDoCliente.has(p))) return nao("o par grupo↔cliente não saiu das palavras do dono");
      // e essas palavras apontam UM cliente só (homônimo → não provado)
      const pelasDoGrupo = await clientesPelasPalavras(doGrupo);
      if (pelasDoGrupo.cortado || escolherPorNome(doGrupo, pelasDoGrupo.clientes).escolhido !== leadId) return nao("as palavras do grupo apontam mais de um cliente");
      const fora = palavras.filter(p => !nomeDoAlvo.has(p));
      if (fora.length) {
        const outros = await clientesPelasPalavras(fora);
        if (outros.cortado || outros.clientes.some(c => c.id !== leadId && escolherPorNome(fora, [c]).pontos > 0)) return nao("outro cliente citado na mensagem");
      }
      return { ok: true };
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

/** Janela do "desfaz": a última ação feita pelo WhatsApp do dono nestes minutos. */
export const JANELA_DESFAZER_MS = 15 * 60_000;
/**
 * Portão de QA E11 (qualidade) — "desfaz": a última ação executada pelo WhatsApp do dono nos últimos 15 min e, em UMA linha, como
 * desfazer (texto do sistema). Sem ação recente, ou sem jeito de desfazer conhecido → null (segue o caminho comum).
 */
export async function comoDesfazerAUltima(agora: Date): Promise<string | null> {
  const [i] = await bancoDaLeitura().select({ funcao: doloresAprovacoes.funcao, argumentos: doloresAprovacoes.argumentos, resumo: doloresAprovacoes.resumo })
    .from(doloresAprovacoes).where(and(eq(doloresAprovacoes.situacao, "executada"), eq(doloresAprovacoes.decididoVia, "whatsapp"),
      gt(doloresAprovacoes.executadoEm, new Date(agora.getTime() - JANELA_DESFAZER_MS)))).orderBy(desc(doloresAprovacoes.executadoEm), desc(doloresAprovacoes.id)).limit(1);
  if (!i) return null;
  const grupoId = Number((i.argumentos as { grupoId?: unknown } | null)?.grupoId);
  const [g] = Number.isSafeInteger(grupoId) && grupoId > 0 ? await bancoDaLeitura().select({ codigo: doloresGrupos.codigo }).from(doloresGrupos).where(eq(doloresGrupos.id, grupoId)).limit(1) : [];
  const como = comoDesfazer(i.funcao, i.argumentos, g?.codigo ?? null);
  if (!como) return null;
  return `Dolores: para desfazer o último (${textoDeDado(i.resumo, 160)}): ${como}.`;
}
