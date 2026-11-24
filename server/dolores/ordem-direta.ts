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
  codigoCitado, direcaoDoAvisoDita, unicoComPonto, exigeCodigoDigitado, prazoConfere, funcaoDoPedido, textoPelaMoldura, temNegacao, tokensDoPedido, tokensSemArtigo, mesmaSequencia, molduraInteira, apararPontas, tarefaUrgenteNaMoldura, temCondicaoOuTempo, soPalavrasPermitidas, LIGACAO_DE_GRUPO, LIGACAO_DE_AVISO, PALAVRAS_GENERICAS, RESTRITIVAS, type PartesDaOrdem, intencaoDaFuncao, numeroCitado, palavrasQueIdentificam, palavrasDoAlvo, palavrasDepoisDoVerbo, codigoDigitadoDeProposito, PONTE, FECHO_DO_DITADO, podeExecutarPorOrdemDireta,
  tipoDitoPeloDono,
} from "../../shared/dolores/ordem-direta.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { erroParaLog } from "./erro-seguro.js";
import { bancoDaLeitura } from "./somente-leitura.js";
import { doloresAprovacoes } from "../../drizzle/schema-dolores-fila.js";
import { comoDesfazer } from "../../shared/dolores/ordem-direta.js";
import { textoDeDado } from "../../shared/dolores/fila.js";
import { diaFortaleza } from "../../shared/dolores/formato.js";
import { normalizarNome } from "../../shared/dolores/grupos-tipo.js";

/** Teto das leituras (as tabelas são pequenas; o teto só garante que a conferência é barata). */
export const MAX_GRUPOS_CONFERIDOS = 2_000;
export const MAX_CLIENTES_CONFERIDOS = 20_000;
export const MAX_CANDIDATOS_POR_PALAVRA = 300;
export const MAX_LEMBRANCAS_CONFERIDAS = 500;

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
/** Portão 5 (I-2): tamanho máximo do texto gravado por função (o mesmo da tela/zod); acima → confirmação, nunca corte. */
export const LIMITE_TEXTO = { criar_tarefa: 150, registrar_acompanhamento: 1000, guardar_memoria: 300, corrigir_memoria: 300 } as const;

export type Prova = { ok: true; argumentos?: Record<string, unknown> } | { ok: false; motivo: string; pergunta?: string };
const nao = (motivo: string, pergunta?: string): Extract<Prova, { ok: false }> => ({ ok: false, motivo, ...(pergunta ? { pergunta } : {}) });
const SIM: Prova = { ok: true };
const nomesEntreAspas = (nomes: ReadonlyArray<string | null>) => {
  const l = nomes.slice(0, 5).map(n => `«${String(n ?? "(sem nome)").replace(/[«»\r\n]/g, " ").trim().slice(0, 60)}»`);
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} ou ${l.at(-1)}` : l.join("");
};

/** Palavras (identificadoras) do nome de alguém que estão nas palavras do dono. */
const palavrasDoNome = (nome: string | null | undefined, palavras: readonly string[]) => palavrasQueIdentificam(nome).filter(p => palavras.includes(p));

/** O nome da equipe ou do cliente provado, em tokens normalizados (para a moldura). */
const tokensDoNome = (nome: string | null | undefined) => normalizarNome(nome).split(" ").filter(Boolean);

type ProvaDeNome = { ok: true; nome: string | null; palavras: string[] } | Exclude<Prova, { ok: true }>;

/**
 * Cliente (lead) apontado pelas palavras dele: "cliente N"/"nº N", ou UM cliente ativo pelo nome; empate → pergunta com os nomes.
 * Portão 4 (M-3): `excluir` = palavras que já provaram OUTRO alvo (o responsável) — não contam aqui; e palavra do cliente que também é
 * nome de alguém da equipe → ambíguo (pergunta).
 */
async function provarCliente(leadId: unknown, textoDoDono: string, palavrasTodas: string[], o: { excluir?: readonly string[]; equipe?: ReadonlyArray<{ name: string | null }> } = {}): Promise<ProvaDeNome> {
  const id = Number(leadId);
  if (!Number.isSafeInteger(id) || id <= 0) return nao("sem cliente");
  const palavras = palavrasTodas.filter(p => !(o.excluir ?? []).includes(p));
  const [l] = await bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads).where(and(eq(leads.id, id), isNull(leads.deletedAt))).limit(1);
  if (!l) return nao("cliente não encontrado");
  if (numeroCitado(textoDoDono, id)) return { ok: true, nome: l.nome, palavras: [] };
  const achados = await clientesPelasPalavras(palavras);
  // QA E11 (B2): passou do teto → ambíguo
  if (achados.cortado) return nao("nome comum demais: muitos clientes");
  const candidatos = achados.clientes;
  // Portão 2 (M-C): o ÚNICO com ponto — outro cadastro com qualquer palavra dele → pergunta com os nomes
  const e = unicoComPonto(palavras, candidatos);
  if (e.comPonto.length > 1 && e.comPonto.includes(id)) {
    return nao("o nome aponta mais de um cliente", `Qual cliente: ${nomesEntreAspas(candidatos.filter(c => e.comPonto.includes(c.id)).map(c => c.nome))}? Nada foi feito ainda.`);
  }
  if (e.escolhido !== id) return nao("o cliente não saiu das palavras do dono");
  const usadas = palavrasDoNome(l.nome, palavras);
  // Portão 4 (M-3): a palavra que provou o cliente também é nome de alguém da equipe → ambíguo
  const daEquipe = new Set((o.equipe ?? []).flatMap(u => palavrasQueIdentificam(u.name)));
  if (usadas.some(p => daEquipe.has(p))) return nao("o nome é de um cliente e de alguém da equipe", `É o cliente ${nomesEntreAspas([l.nome])} ou alguém da equipe? Nada foi feito ainda.`);
  return { ok: true, nome: l.nome, palavras: usadas };
}

async function provarObra(obraId: unknown, textoDoDono: string, palavras: string[]): Promise<Prova> {
  const id = Number(obraId);
  if (!Number.isSafeInteger(id) || id <= 0) return nao("sem obra");
  if (numeroCitado(textoDoDono, id)) return SIM;
  const obras = palavras.length ? await bancoDaLeitura().select({ id: constructionProjects.id, nome: constructionProjects.title }).from(constructionProjects)
    .where(or(...palavras.slice(0, 8).map(p => contem(sql`${constructionProjects.title}`, p)))).limit(MAX_CANDIDATOS_POR_PALAVRA) : [];
  return unicoComPonto(palavras, obras).escolhido === id ? SIM : nao("a obra não saiu das palavras do dono");
}

/** Responsável da tarefa: o nome pedido resolve para UM usuário da equipe e é esse que as palavras dele apontam (empate → pergunta). */
async function provarResponsavel(responsavel: unknown, palavras: string[], equipe: ReadonlyArray<{ id: number; name: string | null }>): Promise<ProvaDeNome> {
  const pedido = palavrasQueIdentificam(String(responsavel ?? ""));
  if (!pedido.some(p => palavras.includes(p))) return nao("o responsável não saiu das palavras do dono");
  const e = unicoComPonto(palavras, equipe.map(u => ({ id: u.id, nome: u.name })));
  if (e.comPonto.length > 1) return nao("o nome aponta mais de uma pessoa da equipe", `Para quem é a tarefa: ${nomesEntreAspas(equipe.filter(u => e.comPonto.includes(u.id)).map(u => u.name))}? Nada foi feito ainda.`);
  const doPedido = unicoComPonto(pedido, equipe.map(u => ({ id: u.id, nome: u.name }))).escolhido;
  if (e.escolhido === null || e.escolhido !== doPedido) return nao("o responsável não é o que o dono disse");
  const u = equipe.find(x => x.id === e.escolhido)!;
  return { ok: true, nome: u.name, palavras: palavrasDoNome(u.name, palavras) };
}

/** Portões 5 e 6 (I-4): mínimo de palavras (3+ letras) de conteúdo do dono para apontar uma lembrança pelo conteúdo. */
export const MIN_PALAVRAS_PARA_APONTAR_LEMBRANCA = 2;

/**
 * A lembrança (corrigir/esquecer) que ELE apontou entre as ATIVAS. Palavra comum ("dia", "prefere") nunca escolhe:
 *  (a) pelo CONTEÚDO, nos dois sentidos, com TODAS as palavras (portão 6, I-2: "sem", "com", "só", "não" contam; só o artigo sai): o
 *      que ele escreveu depois da moldura tem exatamente as palavras da lembrança — e só UMA lembrança ativa passa nisso; ou
 *  (b) pelo NOME: "esquece/corrige a lembrança do/da <nome>" — o <nome> é de alguém do CADASTRO (cliente ativo ou equipe; portão 6,
 *      M-4: "a lembrança do dia" não vale) e está em uma lembrança só.
 * Qualquer outra coisa → não provado (segue a confirmação, que mostra a lembrança). Devolve as palavras que a apontaram (M-4).
 */
async function provarMemoria(memoriaId: unknown, antes: string): Promise<ProvaDeNome> {
  const id = Number(memoriaId);
  if (!Number.isSafeInteger(id) || id <= 0) return nao("sem lembrança");
  const ativas = await bancoDaLeitura().select({ id: doloresMemoriaLonga.id, nome: doloresMemoriaLonga.texto }).from(doloresMemoriaLonga)
    .where(eq(doloresMemoriaLonga.situacao, "ativa")).limit(MAX_LEMBRANCAS_CONFERIDAS + 1);
  // passou do teto → não dá para garantir que é a única
  if (ativas.length > MAX_LEMBRANCAS_CONFERIDAS) return nao("lembranças demais para conferir");
  if (!ativas.some(m => m.id === id)) return nao("lembrança não encontrada");
  const ts = tokensDoPedido(antes).map(t => t.n);
  // (b) "a lembrança do/da <nome>"
  const iL = ts.findIndex(t => t === "lembranca" || t === "memoria");
  if (iL >= 0) {
    if (!["do", "da", "de"].includes(ts[iL + 1] ?? "")) return nao("lembrança sem nome nem conteúdo");
    const cauda = ts.slice(iL + 2);
    const nome = cauda.filter(t => t.length >= 3 && !PALAVRAS_GENERICAS.has(t));
    // tudo o que vem depois de "do/da" tem de ser o nome; palavra de condição ou de tempo → não é um nome
    if (!nome.length || nome.length > 4 || cauda.some(t => RESTRITIVAS.has(t)) || temCondicaoOuTempo(antes)) return nao("o nome não aponta uma lembrança só");
    // o nome é de alguém do cadastro (palavra inteira do nome de um cliente ativo ou de alguém da equipe)
    const achados = await clientesPelasPalavras(nome);
    const equipe = (await getAssignableUsers(bancoDaLeitura() as never)).filter(u => u.name?.trim());
    const doCadastro = new Set([...achados.clientes.flatMap(c => palavrasQueIdentificam(c.nome)), ...equipe.flatMap(u => palavrasQueIdentificam(u.name))]);
    if (!nome.every(p => doCadastro.has(p))) return nao("o nome não é de alguém do cadastro");
    const com = ativas.filter(m => { const w = palavrasQueIdentificam(m.nome); return nome.every(p => w.includes(p)); });
    return com.length === 1 && com[0].id === id ? { ok: true, nome: null, palavras: nome } : nao("o nome não aponta uma lembrança só");
  }
  // (a) conteúdo nos dois sentidos, com todas as palavras
  const conteudo = textoPelaMoldura(antes);
  const doDono = conteudo ? tokensSemArtigo(conteudo.texto) : [];
  if (doDono.filter(p => p.length >= 3).length < MIN_PALAVRAS_PARA_APONTAR_LEMBRANCA) return nao("poucas palavras de conteúdo do dono");
  // Portão 7 (I-2): a mesma SEQUÊNCIA de palavras (ordem e repetição contam)
  const igual = (texto: string | null) => mesmaSequencia(tokensSemArtigo(texto), doDono);
  const com = ativas.filter(m => igual(m.nome));
  return com.length === 1 && com[0].id === id ? { ok: true, nome: null, palavras: palavrasQueIdentificam(conteudo!.texto) } : nao("as palavras dele não apontam uma lembrança só");
}

/**
 * E11b + portões 3 e 4 — os registros (tarefa, anotação, memória, aviso). O TEXTO gravado é calculado pelo CÓDIGO a partir da mensagem
 * do dono — o ditado inteiro (com ":") ou o que sobra depois da MOLDURA (sem ":", `textoPelaMoldura`) — e vai nos `argumentos`
 * devolvidos; o texto do modelo é descartado. Prazo/prioridade pelo código; categoria da memória e tipo da anotação, o padrão do
 * código (salvo "ligação", conferida). Qualquer dúvida → confirmação.
 */
/** Verbos do pedido de aviso: permitidos na frase, nunca apontam o tipo (portão 10). */
const VERBOS_DE_AVISO: ReadonlySet<string> = new Set(["parar", "pare", "para", "deixa", "deixe", "deixar", "chega", "volta", "volte", "voltar",
  "silencia", "silencie", "silenciar", "religa", "religue", "religar"]);
async function provarRegistro(funcao: string, a: Record<string, unknown>, partes: PartesDaOrdem, hojeIso: string): Promise<Prova> {
  const antes = partes.antes;
  // Portão 9 (I-9a/b): vocativo, saudação e verbo nunca apontam alvo
  const palavras = palavrasDoAlvo(antes, funcao === "silenciar_aviso" ? [LIGACAO_DE_AVISO, VERBOS_DE_AVISO] : [PONTE, FECHO_DO_DITADO]);
  /** O texto do dono: o ditado, ou o que sobra depois da moldura (com os nomes provados), sem negação na moldura. */
  // Opção A do dono (24/11/2026): registro por ordem direta SÓ com o texto DITADO depois de ":" — o texto gravado é o ditado inteiro.
  // Sem ":", o código não tem como separar moldura de conteúdo com segurança (origem dos achados dos portões 5 a 8) → confirmação.
  if (partes.depois === null && (funcao === "criar_tarefa" || funcao === "registrar_acompanhamento")) return nao("registro sem texto ditado depois de \":\": pede a confirmação");
  const textoDoDono = (nomes: ReadonlyArray<string | null>): string | null => {
    // Portão 7 (I-1): com ditado, o trecho antes do ":" tem de ser SÓ moldura — condição ou assunto escrito ali nunca some em silêncio
    if (partes.depois !== null) {
      if (!molduraInteira(partes.antes, nomes.filter((n): n is string => !!n).map(tokensDoNome))) return null;
      return apararPontas(partes.depois) || null;
    }
    const t = textoPelaMoldura(partes.mensagem, nomes.filter((n): n is string => !!n).map(tokensDoNome));
    return t && !temNegacao(t.moldura) ? t.texto : null;
  };
  switch (funcao) {
    case "criar_tarefa": {
      if (!prazoConfere(a.prazo, partes.mensagem, hojeIso)) return nao("prazo que o código não tirou da mensagem do dono");
      // Portão 8 (I-8a): a prioridade é do CÓDIGO — "tarefa urgente" na moldura = alta; senão, média. O modelo só pode coincidir
      // (ou não dizer nada); "crítica"/"baixa" e alta sem o "urgente" → confirmação
      const prioridade = tarefaUrgenteNaMoldura(antes) ? "alta" : "media";
      // "media" é o padrão do esquema (o zod preenche quando o modelo não diz nada): vale como "não disse" — o código decide
      // Portão 9 (M-9): "urgente" dentro do DITADO não vale ("…se ele viu a tarefa urgente da Maria") — só o da moldura
      if (a.prioridade !== undefined && a.prioridade !== null && a.prioridade !== "media" && a.prioridade !== prioridade) return nao("prioridade que o dono não disse");
      const prioridadeFinal = prioridade;
      const equipe = (await getAssignableUsers(bancoDaLeitura() as never)).filter(u => u.name?.trim());
      const quem = await provarResponsavel(a.responsavel, palavras, equipe);
      if (!quem.ok) return quem;
      // Portão 9 (I-9a): antes do ":" só há moldura e o nome do RESPONSÁVEL — o vínculo (cliente/obra) nunca sai da frase dele; o do
      // modelo é sempre DESCARTADO na ordem direta (tarefa sem vínculo)
      // portão 6: na moldura da tarefa só sai o nome do RESPONSÁVEL; o do cliente é conteúdo do título e fica
      const titulo = textoDoDono([quem.nome]);
      if (!titulo) return nao("o texto da tarefa não sai da mensagem do dono (vazio, curto ou com referência)");
      // Portão 5 (I-2): acima do limite da função → confirmação (nunca corte em silêncio)
      if (titulo.length > LIMITE_TEXTO.criar_tarefa) return nao("texto da tarefa maior que o limite");
      const { descricao: _d, vinculo: _v, ...resto } = a;
      // Portão 11 (R1): o responsável gravado é o PROVADO (nome exato do cadastro) — nunca a string do modelo ("ana li" → Mariana Lima)
      if (!quem.nome) return nao("responsável sem nome no cadastro");
      return { ok: true, argumentos: { ...resto, titulo, prioridade: prioridadeFinal, responsavel: quem.nome } };
    }
    case "registrar_acompanhamento": {
      const equipe = (await getAssignableUsers(bancoDaLeitura() as never)).filter(u => u.name?.trim());
      const c = await provarCliente(a.leadId, antes, palavras, { equipe });
      if (!c.ok) return c;
      const texto = textoDoDono([c.nome]);
      if (!texto) return nao("a anotação não sai da mensagem do dono (vazia, curta ou com referência)");
      if (texto.length > LIMITE_TEXTO.registrar_acompanhamento) return nao("anotação maior que o limite");
      // Portão 12 (concern 3): na ordem direta o tipo é sempre "anotação" (o do modelo é descartado; "ligação" só com o "pode")
      return { ok: true, argumentos: { leadId: a.leadId, texto, tipo: "anotacao" } };
    }
    case "guardar_memoria": {
      let nome: string | null = null;
      if (a.leadId) { const c = await provarCliente(a.leadId, antes, palavras); if (!c.ok) return c; nome = c.nome; }
      else if (a.obraId) { const o = await provarObra(a.obraId, antes, palavras); if (!o.ok) return o; }
      const texto = textoDoDono([nome]);
      if (!texto) return nao("a lembrança não sai da mensagem do dono (vazia, curta ou com referência)");
      if (texto.length > LIMITE_TEXTO.guardar_memoria) return nao("lembrança maior que o limite");
      // categoria: o padrão do código (o do modelo é descartado)
      return { ok: true, argumentos: { texto, categoria: "fato_negocio", ...(a.leadId ? { leadId: a.leadId } : {}), ...(a.obraId ? { obraId: a.obraId } : {}) } };
    }
    case "corrigir_memoria": {
      // sem ":" o texto novo não tem como ser separado da moldura com segurança → confirmação
      if (partes.depois === null) return nao("corrigir lembrança só com o texto novo ditado depois de \":\"");
      const m = await provarMemoria(a.memoriaId, antes);
      if (!m.ok) return m;
      // o trecho antes do ":" já foi usado INTEIRO para apontar a lembrança (provarMemoria); o texto novo é o ditado
      const texto = partes.depois.replace(/^[\s.,;:!\-]+|[\s.,;:!\-]+$/g, "") || null;
      if (!texto) return nao("texto novo vazio");
      if (texto.length > LIMITE_TEXTO.corrigir_memoria) return nao("texto novo maior que o limite");
      // Portão 4 (M-4): o ditado tem de trazer ao menos uma das palavras que apontaram a lembrança (senão perde o sujeito)
      const noDitado = new Set(palavrasQueIdentificam(texto));
      if (!m.palavras.some(p => noDitado.has(p))) return nao("o texto novo não traz o sujeito da lembrança");
      return { ok: true, argumentos: { memoriaId: a.memoriaId, texto } };
    }
    case "esquecer_memoria": { const m = await provarMemoria(a.memoriaId, antes); return m.ok ? SIM : m; }
    case "silenciar_aviso": {
      if (typeof a.silenciar !== "boolean" || !direcaoDoAvisoDita(a.silenciar, antes)) return nao("a direção (parar/voltar) não é a que o dono disse");
      const i = (TIPOS_AVISO as readonly string[]).indexOf(String(a.tipo));
      if (i < 0) return nao("tipo de aviso inválido");
      const tipos = TIPOS_AVISO.map((t, j) => ({ id: j + 1, nome: `${t.replace(/_/g, " ")} ${ROTULO_TIPO_AVISO[t]}` }));
      if (unicoComPonto(palavras, tipos).escolhido !== i + 1) return nao("o tipo de aviso não saiu das palavras do dono");
      // Portão 6 (M-1): no pedido todo, só palavra de ligação, os verbos do aviso e o NOME do tipo — "até segunda", "só hoje" → confirmação
      const permitidas = [...normalizarNome(tipos[i].nome).split(" "), ...Array.from(VERBOS_DE_AVISO)];
      return soPalavrasPermitidas(antes, LIGACAO_DE_AVISO, permitidas) ? SIM : nao("palavra fora do pedido de aviso (condição ou prazo)");
    }
    default: return nao("função fora da lista");
  }
}

/**
 * A ação reversível `funcao(argumentos)` (como o modelo pediu) tem a intenção e os alvos nas palavras do dono (`textoDoDono`)?
 * Nunca lança: falha → não provado (segue a confirmação).
 */
/** E11 (ajuste antes da 3ª revisão): funções de REGISTRO de texto em que o texto ditado depois de ":" pode ser o conteúdo gravado. */
export const FUNCOES_COM_CONTEUDO_DITADO: ReadonlySet<string> = new Set(["criar_tarefa", "registrar_acompanhamento", "guardar_memoria", "corrigir_memoria"]);

/**
 * `partes` = a mensagem do dono separada por `partesDaOrdem` (porta de caracteres, ":" e negação já conferidos): verbo, função, código e
 * alvos saem SÓ de `partes.antes`; o texto gravado, de `textoGravadoDoDono`. Com ditado (":"), só as funções de registro de texto vão
 * direto. `agora`: o dia de hoje (prazo). Devolve, quando provado, os `argumentos` com o texto do dono no lugar do texto do modelo.
 */
export async function provarAlvosDoDono(funcao: string, argumentos: unknown, partes: PartesDaOrdem, agora: Date = new Date()): Promise<Prova> {
  try {
    const textoDoDono = partes.antes;
    if (!podeExecutarPorOrdemDireta(funcao, argumentos)) return nao("função fora da lista da ordem direta");
    // Portão 4 (1): a função é a do PRIMEIRO verbo do pedido, decidida pelo código; a chamada do modelo tem de ser a mesma
    if (funcaoDoPedido(textoDoDono) !== funcao) return nao("a função pedida pelo modelo não é a do primeiro verbo do dono");
    // a moldura do pedido (sem texto gravado: o trecho antes do ":", ou a mensagem toda) não pode ter negação
    if (!FUNCOES_COM_CONTEUDO_DITADO.has(funcao) && temNegacao(textoDoDono)) return nao("negação no pedido");
    // Portão 6 (M-1): ordem que não grava texto (grupo, aviso) com CONDIÇÃO ou TEMPO ("só se…", "depois que…", "até segunda") → confirmação
    if (String(funcao).endsWith("_grupo") && temCondicaoOuTempo(textoDoDono)) return nao("condição ou prazo no pedido");
    const a = (argumentos ?? {}) as { grupoId?: unknown; tipo?: unknown; leadId?: unknown; obraId?: unknown };
    if (partes.depois !== null && !FUNCOES_COM_CONTEUDO_DITADO.has(funcao)) return nao("mensagem com texto ditado depois de \":\": só registro de texto vai direto");
    if (!String(funcao).endsWith("_grupo")) return await provarRegistro(funcao, a as Record<string, unknown>, partes, diaFortaleza(agora) ?? agora.toISOString().slice(0, 10));
    const grupoId = Number(a.grupoId);
    if (!Number.isSafeInteger(grupoId) || grupoId <= 0) return nao("grupo inválido");
    const cfg = await lerConfigWhatsapp().catch(() => null);
    const grupos = await bancoDaLeitura().select({ id: doloresGrupos.id, codigo: doloresGrupos.codigo, nome: doloresGrupos.nome, nomeWhatsapp: doloresGrupos.nomeWhatsapp,
      instancia: doloresGrupos.instancia, adicionadoPor: doloresGrupos.adicionadoPor, origem: doloresGrupos.origem })
      .from(doloresGrupos).where(cfg?.instancia ? eq(doloresGrupos.instancia, cfg.instancia) : undefined).limit(MAX_GRUPOS_CONFERIDOS);
    const alvo = grupos.find(g => g.id === grupoId);
    if (!alvo) return nao("grupo não é da conexão da empresa");
    // Portão 9 (I-9c): "Dolores, ignora esse grupo" não escolhe o grupo «DOLORES …»
    const palavras = palavrasDoAlvo(textoDoDono, [LIGACAO_DE_GRUPO]);
    const nomeDoAlvo = new Set(palavrasQueIdentificam(alvo.nomeWhatsapp ?? alvo.nome));
    // QA E11 (qualidade: dois grupos numa mensagem): o grupo é provado pelas palavras dele QUE ESTÃO no nome deste grupo — e essas
    // palavras precisam apontar só este grupo (outro grupo com o mesmo nome → empate → não provado)
    const doGrupo = palavras.filter(p => nomeDoAlvo.has(p));
    // Portão 11 (R2): código que é palavra comum ou nome ("VERA") só vale digitado de propósito (em maiúsculas)
    const porCodigo = codigoDigitadoDeProposito(textoDoDono, alvo.codigo);
    const porNome = doGrupo.length > 0 && unicoComPonto(doGrupo, grupos.map(g => ({ id: g.id, nome: g.nomeWhatsapp ?? g.nome }))).escolhido === alvo.id;
    // Portão 12 (concerns 1 e 2): o código bate, mas as palavras da frase estão no nome de OUTRO grupo ("ignora o grupo da VERA" com o
    // grupo «VERA LUCIA»; "…grupo mcmv" com «MCMV RESIDENCIAL») → código e nome apontam grupos diferentes → confirmação
    if (porCodigo && grupos.some(g => g.id !== alvo.id && palavrasQueIdentificam(g.nomeWhatsapp ?? g.nome).some(p => palavras.includes(p)))) return nao("o código e o nome apontam grupos diferentes");
    if (!porCodigo && (exigeCodigoDigitado(funcao) || !porNome)) return nao(exigeCodigoDigitado(funcao) ? "aceitar grupo só com o código digitado pelo dono" : "o grupo não saiu das palavras do dono");
    // Portão 6 (M-1), regra estrutural: depois do verbo, só palavra de ligação, o nome/código DESTE grupo, o nome do cliente/obra pedido
    // e número. Qualquer outra palavra ("assim que ela assinar", "provisoriamente") → confirmação
    const doAlvo = [...normalizarNome(alvo.nomeWhatsapp ?? alvo.nome).split(" "), ...(porCodigo ? [String(alvo.codigo ?? "").toLowerCase()] : [])];
    if (funcao === "classificar_grupo") {
      const leadDoPedido = Number(a.leadId);
      if (Number.isSafeInteger(leadDoPedido) && leadDoPedido > 0) {
        const [c] = await bancoDaLeitura().select({ nome: leads.name }).from(leads).where(and(eq(leads.id, leadDoPedido), isNull(leads.deletedAt))).limit(1);
        doAlvo.push(...normalizarNome(c?.nome).split(" "));
      }
      // Portão 11 (R3/R4): obra escolhida junto com o grupo é um SEGUNDO alvo (Opção A: um alvo só) → confirmação, como "cliente N"
      if (a.obraId !== undefined && a.obraId !== null) return nao("grupo com obra: segundo alvo pede a confirmação");
    }
    // Codex #341 (P1): número solto que não é do nome/código do grupo ("…como cliente 5") → ele apontou outro alvo: confirmação
    if (palavrasDepoisDoVerbo(textoDoDono).some(t => /^\d+$/.test(t) && !doAlvo.includes(t))) return nao("número no pedido de grupo: pede a confirmação");
    if (!soPalavrasPermitidas(textoDoDono, LIGACAO_DE_GRUPO, doAlvo.filter(Boolean))) return nao("palavra fora do pedido de grupo (condição, prazo ou outro assunto)");
    if (funcao !== "classificar_grupo") return { ok: true };
    const tipo = String(a.tipo);
    if (!tipoDitoPeloDono(tipo, textoDoDono)) return nao("o tipo não é o que o dono disse");
    if (tipo === "cliente" || tipo === "pos_atendimento") {
      const leadId = Number(a.leadId);
      if (!Number.isSafeInteger(leadId) || leadId <= 0) return nao("sem cliente");
      // Opção A do dono (24/11/2026): direto só quando o cliente é o que o NOME DO GRUPO aponta (um só; grupo de terceiro, só o nome
      // inteiro). "cliente N", outro cliente ou segundo nome na frase → confirmação (portão 8, I-8b)
      return (await clienteDoNomeDoGrupo(alvo)).leadId === leadId ? { ok: true } : nao("o cliente não é o do nome do grupo");
    }
    // engenharia sem obra (com obra já foi para a confirmação acima)
    return { ok: true };
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
