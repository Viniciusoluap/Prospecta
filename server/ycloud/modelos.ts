// EPIC-027 C7.2 (21/11/2026) — modelos da API oficial criados PELO SERVIDOR do Prospecta (o dono não usa o painel da YCloud).
// Palavras do dono: "se nós já temos isso tudo no sistema… eu quero que você faça".
// 1. Modelo padrão `novidades_prospecta` (MARKETING, pt_BR): enviado para aprovação UMA vez, sozinho, quando a integração está pronta
//    (chave salva, número confere, WABA conhecida) e a conta não tem nenhum modelo de marketing em pt_BR. Dispara pelo cron da Vercel
//    (api/index.ts) e ao listar os modelos (`whatsappOficial.modelos`). Estado em dashboard_settings (`ycloud.modelo_padrao`, sem
//    migração), reservado por compare-and-set: duas chamadas ao mesmo tempo → um POST só. No máximo 1 tentativa por dia (dia de Brasília)
//    e 3 no total; recusa da YCloud grava o motivo (sem segredo) e não entra em laço.
// 2. Template da Central (Templates › "+ Novo template" / "Editar", só admin): marcado "Usar também em campanha pela API oficial", vira
//    modelo (variáveis nomeadas → {{1}}, {{2}}… na ordem), vai para aprovação e o vínculo (nome na YCloud, posição → variável, resumo do
//    texto enviado) fica em dashboard_settings (`ycloud.template.<id>`, sem migração).
// A chave só é lida por `chaveYcloud()` (config.ts) e só vai no cabeçalho (server/_core/ycloud.ts); nunca em log, erro, auditoria ou tela.
import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { dashboardSettings, whatsappTemplates } from "../../drizzle/schema.js";
import {
  IDIOMA_MODELO, MODELO_PADRAO, ROTULO_STATUS_MODELO, componentesDoNovoModelo, converterTemplateParaModelo, nomeDoModeloDoTemplate,
  temModeloDeMarketingPtBr, type CategoriaNovoModelo, type NovoModelo,
} from "../../shared/whatsapp/ycloud.js";
import { ErroYcloud, criarModeloYcloud, listarModelosYcloud, semSegredo, textoBemFormado, type ModeloYcloud } from "../_core/ycloud.js";
import { getDb } from "../db.js";
import { auditarYcloud, chaveYcloud, depsYcloud, lerConfigYcloud, type AutorYcloud } from "./config.js";

export const CHAVE_ESTADO_MODELO_PADRAO = "ycloud.modelo_padrao";
export const PREFIXO_VINCULO_TEMPLATE = "ycloud.template.";
export const MAX_TENTATIVAS_MODELO_PADRAO = 3;

// ── dashboard_settings direto (compare-and-set; value até 500 caracteres) ──

async function lerLinha(chave: string): Promise<string | null> {
  const [r] = await getDb().select({ value: dashboardSettings.value }).from(dashboardSettings).where(eq(dashboardSettings.key, chave)).limit(1);
  return r?.value ?? null;
}
/** Grava `novo` só se o valor ainda for `antigo` (null = a linha não existe). true = ganhou a reserva. */
async function trocarSe(chave: string, antigo: string | null, novo: string): Promise<boolean> {
  const d = getDb();
  if (antigo === null) {
    const r = await d.insert(dashboardSettings).values({ key: chave, value: novo, updatedAt: depsYcloud().agora() }).onConflictDoNothing()
      .returning({ id: dashboardSettings.id });
    return r.length > 0;
  }
  const r = await d.update(dashboardSettings).set({ value: novo, updatedAt: depsYcloud().agora() })
    .where(and(eq(dashboardSettings.key, chave), eq(dashboardSettings.value, antigo))).returning({ id: dashboardSettings.id });
  return r.length > 0;
}
async function gravar(chave: string, valor: string) {
  await getDb().insert(dashboardSettings).values({ key: chave, value: valor, updatedAt: depsYcloud().agora() })
    .onConflictDoUpdate({ target: dashboardSettings.key, set: { value: valor, updatedAt: depsYcloud().agora() } });
}
/** dashboard_settings.value é varchar(500): o limite vale para o texto JÁ serializado (JSON escapa alguns caracteres em até 6). */
export const MAX_VALOR_SETTING = 500;
/** Serializa cortando o campo de texto `campo` (motivo) até caber; sem ele, devolve null se não couber. */
function serializarCabendo<T extends object>(obj: T, campo?: keyof T): string | null {
  let o = obj;
  let j = JSON.stringify(o);
  if (campo) {
    let txt = typeof o[campo] === "string" ? (o[campo] as unknown as string) : "";
    while (j.length > MAX_VALOR_SETTING && txt) {
      txt = textoBemFormado(txt, Math.max(0, Array.from(txt).length - Math.max(1, Math.ceil((j.length - MAX_VALOR_SETTING) / 6))));
      o = { ...o, [campo]: txt || null };
      j = JSON.stringify(o);
    }
  }
  return j.length <= MAX_VALOR_SETTING ? j : null;
}
const jsonOu = <T>(v: string | null): T | null => { if (!v) return null; try { return JSON.parse(v) as T; } catch { return null; } };

/** Dia no fuso de Brasília (AAAA-MM-DD): "no máximo 1 tentativa por dia". */
export const diaDeBrasilia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

/** Motivo para guardar/mostrar: mensagem montada pelo código + explicação da Meta (limpa), sem a chave. */
function motivoDoErro(e: unknown, chave: string | null): string {
  const base = e instanceof ErroYcloud ? `${e.message}${e.explicacaoMeta ? ` Meta: ${e.explicacaoMeta}` : ""}` : "Falha inesperada ao falar com a YCloud.";
  return textoBemFormado(semSegredo(base, chave), 220);
}

// ── 1. Modelo padrão ──

type EstadoPadrao = {
  /** andamento | criado | ja_existia | recusado | incerto | falhou */
  s: string; t: number; d: string; em: string; m?: string | null; st?: string | null;
};
export type ResultadoModeloPadrao =
  | "ja_feito" | "desistiu" | "hoje_ja_tentou" | "nao_pronta" | "ocupado" | "ja_existia" | "criado" | "recusado" | "incerto" | "falhou_listar";

const FINAIS = new Set(["criado", "ja_existia"]);

/**
 * Garante o modelo padrão. Idempotente e à prova de corrida. `lista`: modelos já lidos agora (evita consultar de novo).
 * Nunca lança: o chamador (cron, listagem) segue com o que estava fazendo.
 */
export async function garantirModeloPadrao(p: { origem: "cron" | "listagem"; lista?: ModeloYcloud[]; signal?: AbortSignal } = { origem: "cron" }):
  Promise<{ r: ResultadoModeloPadrao; modelo?: ModeloYcloud }> {
  let chave: string | null = null;
  try {
    const agora = depsYcloud().agora();
    const bruto = await lerLinha(CHAVE_ESTADO_MODELO_PADRAO);
    const est = jsonOu<EstadoPadrao>(bruto);
    if (est && FINAIS.has(est.s)) return { r: "ja_feito" };
    if (est && est.t >= MAX_TENTATIVAS_MODELO_PADRAO) return { r: "desistiu" };
    const dia = diaDeBrasilia(agora);
    if (est && est.d === dia) return { r: "hoje_ja_tentou" };
    chave = await chaveYcloud();
    const cfg = await lerConfigYcloud();
    if (!chave || !cfg.numeroConfere || !cfg.wabaId) return { r: "nao_pronta" };
    const tentativas = est?.t ?? 0;
    // Portão de QA (QA-1): a tentativa é somada JÁ NA RESERVA (antes de qualquer POST). Se o fechamento falhar, a reserva
    // "andamento" fica com a tentativa contada e o dia marcado: respeita 1 por dia e 3 no total. Só a falha ao LISTAR devolve.
    const reserva: EstadoPadrao = { s: "andamento", t: tentativas + 1, d: dia, em: agora.toISOString() };
    if (!(await trocarSe(CHAVE_ESTADO_MODELO_PADRAO, bruto, JSON.stringify(reserva)))) return { r: "ocupado" };
    const fechar = async (e: Partial<EstadoPadrao>) => {
      const v = serializarCabendo<EstadoPadrao>({ ...reserva, ...e }, "m") ?? JSON.stringify({ ...reserva, ...e, m: null });
      await gravar(CHAVE_ESTADO_MODELO_PADRAO, v);
    };
    const c = { apiKey: chave, fetchImpl: depsYcloud().fetch, signal: p.signal };

    let lista = p.lista;
    if (!lista) {
      try { lista = await listarModelosYcloud(c, cfg.wabaId); } catch (e) {
        await fechar({ s: "falhou", t: tentativas, m: motivoDoErro(e, chave) }); // nada foi criado: não conta tentativa; volta amanhã
        return { r: "falhou_listar" };
      }
    }
    if (temModeloDeMarketingPtBr(lista)) {
      await fechar({ s: "ja_existia" });
      await auditarYcloud({ acao: "modelo_padrao_dispensado", usuarioId: null, papel: "sistema", modelo: `${MODELO_PADRAO.nome} (${IDIOMA_MODELO})`, detalhe: "a conta já tem modelo de marketing em pt_BR" });
      return { r: "ja_existia" };
    }
    try {
      const criado = await criarModeloYcloud(c, pedidoDoModelo(MODELO_PADRAO, cfg.wabaId));
      const st = typeof criado?.status === "string" ? criado.status.replace(/[^A-Z_]/g, "").slice(0, 20) : null;
      await fechar({ s: "criado", st });
      await auditarYcloud({ acao: "modelo_padrao_enviado", usuarioId: null, papel: "sistema", modelo: `${MODELO_PADRAO.nome} (${IDIOMA_MODELO})`, detalhe: `origem=${p.origem}${st ? `; status_ycloud=${st}` : ""}` });
      return { r: "criado", modelo: { ...criado, name: criado?.name ?? MODELO_PADRAO.nome, language: criado?.language ?? IDIOMA_MODELO, category: criado?.category ?? "MARKETING", status: criado?.status ?? "PENDING", components: criado?.components ?? componentesDoNovoModelo(MODELO_PADRAO) } };
    } catch (e) {
      const ambiguo = e instanceof ErroYcloud && e.ambiguo;
      const m = motivoDoErro(e, chave);
      await fechar({ s: ambiguo ? "incerto" : "recusado", m });
      await auditarYcloud({ acao: "modelo_padrao_recusado", usuarioId: null, papel: "sistema", modelo: `${MODELO_PADRAO.nome} (${IDIOMA_MODELO})`, detalhe: m });
      return { r: ambiguo ? "incerto" : "recusado" };
    }
  } catch {
    console.error("[ycloud/modelo-padrao] não consegui conferir o modelo padrão; tenta de novo na próxima rodada.");
    return { r: "falhou_listar" };
  }
}

/**
 * Portão de QA (QA-2): nos crons, roda DEPOIS da rotina principal, com prazo total curto — aborta as chamadas à YCloud e nunca lança
 * nem muda a resposta do cron. Devolve o resultado ou "sem_tempo".
 */
export async function garantirModeloPadraoNoCron(prazoMs = 10_000): Promise<ResultadoModeloPadrao | "sem_tempo"> {
  if (prazoMs < 1_000) return "sem_tempo";
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tempo = new Promise<"sem_tempo">(r => { timer = setTimeout(() => { ctl.abort(); r("sem_tempo"); }, prazoMs); });
  try {
    return await Promise.race([garantirModeloPadrao({ origem: "cron", signal: ctl.signal }).then(x => x.r, () => "falhou_listar" as const), tempo]);
  } catch {
    return "falhou_listar";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Para o cartão de Integrações (só admin): o que o servidor fez com o modelo padrão. */
export async function estadoModeloPadrao() {
  const est = jsonOu<EstadoPadrao>(await lerLinha(CHAVE_ESTADO_MODELO_PADRAO).catch(() => null));
  return est ? { situacao: est.s, tentativas: est.t, motivo: est.m ?? null, ultimaEm: est.em, nome: MODELO_PADRAO.nome, maxTentativas: MAX_TENTATIVAS_MODELO_PADRAO }
    : { situacao: null, tentativas: 0, motivo: null, ultimaEm: null, nome: MODELO_PADRAO.nome, maxTentativas: MAX_TENTATIVAS_MODELO_PADRAO };
}

/** Corpo de POST /whatsapp/templates no formato da documentação da YCloud. */
export function pedidoDoModelo(m: NovoModelo, wabaId: string) {
  return { wabaId, name: m.nome, language: IDIOMA_MODELO, category: m.categoria, components: componentesDoNovoModelo(m) };
}

// ── 2. Template da Central → modelo da API oficial ──

export type VinculoTemplate = {
  /** nome do modelo na YCloud */ n: string; /** categoria */ c: CategoriaNovoModelo; /** posição (1..n) → variável da Central */ v: string[];
  /** resumo do texto enviado */ h: string; /** versão do nome (_v2…) */ ver: number; /** enviado em */ e: string;
  /** Portão de QA (QA-3): versões anteriores ainda podem estar aprovadas — nome do modelo → variáveis (a mais recente primeiro) */
  ant?: Array<[string, string[]]>;
};

/** Todos os nomes de modelo do vínculo (atual e anteriores) → variáveis. */
export function mapeamentosDoVinculo(v: VinculoTemplate): Array<[string, string[]]> {
  return [[v.n, v.v], ...(Array.isArray(v.ant) ? v.ant.filter(a => Array.isArray(a) && typeof a[0] === "string" && Array.isArray(a[1])) : [])];
}
export const resumoDoTexto = (conteudo: string) => createHash("sha256").update(String(conteudo).replace(/\r\n?/g, "\n").trim()).digest("hex").slice(0, 24);
const chaveDoVinculo = (templateId: number) => `${PREFIXO_VINCULO_TEMPLATE}${templateId}`;

export async function vinculosDosTemplates(): Promise<Map<number, VinculoTemplate>> {
  const linhas = await getDb().select({ key: dashboardSettings.key, value: dashboardSettings.value }).from(dashboardSettings)
    .where(like(dashboardSettings.key, `${PREFIXO_VINCULO_TEMPLATE}%`));
  const m = new Map<number, VinculoTemplate>();
  for (const l of linhas) {
    const id = Number(l.key.slice(PREFIXO_VINCULO_TEMPLATE.length));
    const v = jsonOu<VinculoTemplate>(l.value);
    if (Number.isInteger(id) && v?.n && Array.isArray(v.v)) m.set(id, v);
  }
  return m;
}

export type ResultadoEnvioTemplate = { ok: boolean; nome: string | null; status: string | null; repetido: boolean; motivo: string | null };

/**
 * Envia o template (já salvo na Central) para aprovação. Mesmo texto já enviado → não envia de novo (`repetido`). Texto mudou → nova
 * versão do nome (`_v2`…): a Meta analisa outra vez e a campanha usa o modelo novo quando for aprovado. Duas chamadas ao mesmo tempo →
 * uma só vai à YCloud (compare-and-set). Erro da YCloud → `ok: false` com motivo amigável (o template continua salvo na Central).
 */
export async function enviarTemplateParaAprovacao(p: { templateId: number; nomeTemplate: string; conteudo: string; categoria: CategoriaNovoModelo; autor: AutorYcloud }):
  Promise<ResultadoEnvioTemplate> {
  const falha = (motivo: string): ResultadoEnvioTemplate => ({ ok: false, nome: null, status: null, repetido: false, motivo });
  const chave = await chaveYcloud();
  if (!chave) return falha("O template foi salvo, mas a chave da YCloud não está cadastrada (Integrações › API oficial do WhatsApp).");
  const cfg = await lerConfigYcloud();
  if (!cfg.wabaId) return falha("O template foi salvo, mas a conta da YCloud ainda não foi conferida: clique em \"Testar\" em Integrações › API oficial do WhatsApp.");
  const k = chaveDoVinculo(p.templateId);
  const bruto = await lerLinha(k);
  const antigo = jsonOu<VinculoTemplate>(bruto);
  const h = resumoDoTexto(p.conteudo);
  if (antigo && antigo.h === h && antigo.c === p.categoria) return { ok: true, nome: antigo.n, status: null, repetido: true, motivo: null };
  const ver = antigo ? antigo.ver + 1 : 1;
  const nome = nomeDoModeloDoTemplate(p.nomeTemplate, p.templateId, ver);
  const conv = converterTemplateParaModelo({ conteudo: p.conteudo, nomeModelo: nome, categoria: p.categoria });
  if (!conv.ok) return falha(`Para virar modelo da API oficial, ajuste: ${conv.problemas.join(" ")}`);
  const base: VinculoTemplate = { n: nome, c: p.categoria, v: conv.variaveis, h, ver, e: depsYcloud().agora().toISOString() };
  // QA-3: guarda também as versões anteriores (a v1 aprovada segue preenchendo {{nome}} na campanha); cabendo em 500, as mais
  // antigas saem primeiro
  let anteriores = antigo ? mapeamentosDoVinculo(antigo).filter(([n]) => n !== nome) : [];
  let valor = serializarCabendo<VinculoTemplate>(anteriores.length ? { ...base, ant: anteriores } : base);
  while (!valor && anteriores.length) {
    anteriores = anteriores.slice(0, -1);
    valor = serializarCabendo<VinculoTemplate>(anteriores.length ? { ...base, ant: anteriores } : base);
  }
  if (!valor) return falha("Variáveis demais para guardar o vínculo com a API oficial.");
  if (!(await trocarSe(k, bruto, valor))) return { ok: true, nome, status: null, repetido: true, motivo: null }; // outra chamada já enviou
  try {
    const r = await criarModeloYcloud({ apiKey: chave, fetchImpl: depsYcloud().fetch }, pedidoDoModelo(conv.modelo, cfg.wabaId));
    const status = typeof r?.status === "string" ? r.status.replace(/[^A-Z_]/g, "").slice(0, 20) : "PENDING";
    await auditarYcloud({ acao: "modelo_enviado", usuarioId: p.autor.id, papel: p.autor.papel, modelo: `${nome} (${IDIOMA_MODELO})`, detalhe: `template=${p.templateId}; categoria=${p.categoria}` });
    return { ok: true, nome, status, repetido: false, motivo: null };
  } catch (e) {
    // desfaz a reserva: dá para tentar de novo (se o pedido chegou, a YCloud responde "já existe" e o motivo diz isso)
    if (bruto === null) await getDb().delete(dashboardSettings).where(and(eq(dashboardSettings.key, k), eq(dashboardSettings.value, valor))).catch(() => undefined);
    else await trocarSe(k, valor, bruto).catch(() => undefined);
    const m = e instanceof ErroYcloud && e.codigo === "ALREADY_EXISTS"
      ? `Já existe na YCloud um modelo chamado "${nome}". Mude o nome do template e salve de novo.`
      : motivoDoErro(e, chave);
    await auditarYcloud({ acao: "modelo_recusado", usuarioId: p.autor.id, papel: p.autor.papel, modelo: `${nome} (${IDIOMA_MODELO})`, detalhe: m });
    return falha(`O template foi salvo na Central, mas a YCloud não aceitou o modelo: ${m}`);
  }
}

/** Situação de cada template enviado, para o próprio cartão (só admin). `lista`: modelos lidos agora; null = não deu para consultar. */
export async function situacaoDosTemplates(lista: ModeloYcloud[] | null) {
  const vinculos = await vinculosDosTemplates();
  if (!vinculos.size) return [];
  const rows = await getDb().select({ id: whatsappTemplates.id, conteudo: whatsappTemplates.conteudo }).from(whatsappTemplates);
  const conteudoPorId = new Map(rows.map(r => [r.id, r.conteudo]));
  return Array.from(vinculos.entries()).map(([templateId, v]) => {
    const m = lista?.find(x => x.name === v.n && x.language === IDIOMA_MODELO) ?? null;
    const atual = conteudoPorId.get(templateId);
    return {
      templateId, nome: v.n, categoria: v.c, variaveis: v.v,
      status: m?.status ?? null, statusRotulo: m?.status ? (ROTULO_STATUS_MODELO[m.status] ?? m.status) : lista ? "Não encontrado na conta" : null,
      motivoRecusa: m?.reason && m.reason !== "NONE" ? String(m.reason).slice(0, 300) : null,
      /** o texto do template mudou depois do envio: precisa reenviar (a campanha continua com o modelo enviado) */
      textoMudou: atual !== undefined && resumoDoTexto(atual) !== v.h,
    };
  });
}
