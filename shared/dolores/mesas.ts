// EPIC-027 C5 (criadora de mesas) — regras PURAS (sem banco nem rede) das PROPOSTAS DE MESA da Dolores.
// Pedido do dono (aprovado em 21/11/2026): quando ele pede uma função nova ("quero que você passe a fazer X", "cria uma mesa para
// acompanhar Y"), a Dolores NÃO programa nem passa a fazer nada sozinha: escreve uma PROPOSTA (o rascunho da função) e guarda para
// aprovação. Só entra em operação depois que ele aprovar e a função for construída pelo processo normal de desenvolvimento (fora da
// Dolores). Aqui: situações, rótulos, tetos, o reconhecimento do pedido (por CÓDIGO, nunca pela IA), a regra de "completa" e o texto
// em Markdown que a tela copia para o time de desenvolvimento.
//
// Nada daqui executa código gerado, cria ferramenta, muda prompt ou liga função: aprovar só muda a SITUAÇÃO.

export const SITUACOES_MESA = ["rascunho", "aguardando_dono", "aprovada", "em_construcao", "em_operacao", "recusada", "arquivada"] as const;
export type SituacaoMesa = (typeof SITUACOES_MESA)[number];
export const ROTULO_SITUACAO_MESA: Readonly<Record<SituacaoMesa, string>> = {
  rascunho: "rascunho (incompleta)", aguardando_dono: "aguardando a aprovação do dono", aprovada: "aprovada (falta construir)",
  em_construcao: "em construção", em_operacao: "em operação", recusada: "recusada", arquivada: "arquivada",
};
/** "Abertas": ainda não viraram operação nem foram encerradas (contam no teto). */
export const SITUACOES_ABERTAS: readonly SituacaoMesa[] = ["rascunho", "aguardando_dono", "aprovada", "em_construcao"];
/** Situações em que a proposta ainda pode ganhar versão nova (a revisão de uma aprovada volta a esperar a aprovação). */
export const SITUACOES_REVISAVEIS: readonly SituacaoMesa[] = ["rascunho", "aguardando_dono", "aprovada"];
/** Situações que o dono pode recusar pela conversa. */
export const SITUACOES_RECUSAVEIS: readonly SituacaoMesa[] = ["rascunho", "aguardando_dono", "aprovada"];
/** O que o ADMIN muda pela tela (de → para). Aprovar e recusar NÃO estão aqui: são do dono, na conversa. */
export const TRANSICOES_DA_TELA: Readonly<Record<"em_construcao" | "em_operacao" | "arquivada", readonly SituacaoMesa[]>> = {
  em_construcao: ["aprovada"],
  em_operacao: ["em_construcao"],
  arquivada: ["rascunho", "aguardando_dono", "aprovada", "em_construcao", "em_operacao", "recusada"],
};
export type SituacaoDaTela = keyof typeof TRANSICOES_DA_TELA;
export const podeMudarPelaTela = (de: string, para: SituacaoDaTela) => (TRANSICOES_DA_TELA[para] as readonly string[]).includes(de);

export const QUEM_APROVA = ["nao_precisa", "dono_pode", "dono_confirmo"] as const;
export type QuemAprova = (typeof QUEM_APROVA)[number];
export const ROTULO_QUEM_APROVA: Readonly<Record<QuemAprova, string>> = {
  nao_precisa: "ninguém (só lê e informa o dono)", dono_pode: "o dono, respondendo pode", dono_confirmo: "o dono, respondendo confirmo",
};
const ORDEM_APROVA: Readonly<Record<QuemAprova, number>> = { nao_precisa: 0, dono_pode: 1, dono_confirmo: 2 };
export const maisForte = (a: QuemAprova, b: QuemAprova): QuemAprova => (ORDEM_APROVA[a] >= ORDEM_APROVA[b] ? a : b);

export const FAIXAS_CUSTO = ["baixa", "media", "alta"] as const;
export type FaixaCusto = (typeof FAIXAS_CUSTO)[number];
/** Faixas por USO da IA (não por valor: o preço depende do modelo escolhido no painel). Contado na parte "conversa" do gasto. */
export const ROTULO_FAIXA_CUSTO: Readonly<Record<FaixaCusto, string>> = {
  baixa: "baixo (só quando o dono pede, ou por código sem IA)",
  media: "médio (a IA algumas vezes por dia)",
  alta: "alto (a IA a cada mensagem, documento ou grupo)",
};

/** Tetos dos campos (o dono lê a proposta INTEIRA no WhatsApp antes do "pode"). */
export const MAX_MESA = {
  titulo: 80, objetivo: 240, quandoAge: 160, item: 100, pedido: 600,
  leituras: 8, acoes: 6, funcoesNovasDoModelo: 3, funcoesNovas: 6, exemplos: 2, riscos: 3,
} as const;
/** Teto de mesas ABERTAS (rascunho, aguardando, aprovada, em construção) e de versões por mesa. */
export const MAX_MESAS_ABERTAS = 20;
export const MAX_VERSOES_MESA = 20;

/** A proposta estruturada (o que fica em cada versão, imutável). `le`/`escreve`: SÓ nomes reais do registro (conferidos por código). */
export type PropostaMesa = {
  titulo: string; objetivo: string; quandoAge: string;
  le: string[]; escreve: string[]; funcoesNovas: string[];
  quemAprova: QuemAprova; exemplosBons: string[]; exemplosRuins: string[]; riscos: string[]; custo: FaixaCusto;
};

/** Sem acento, minúsculo, espaços colapsados. */
export const normalizarMesa = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type TipoPedidoMesa = "propor" | "revisar" | "aprovar" | "recusar";

// Regex LINEARES (alternâncias simples, sem repetição aninhada); a entrada é o trecho do dono (até 200 caracteres, fila.ts#trechoDoDono).
const VERBO_DE_PASSAR = "(?:fazer|acompanhar|cuidar|monitorar|avisar|controlar|olhar|verificar|conferir|cobrar|mandar|vigiar|analisar|organizar|separar|preparar)";
const PEDIDO_DE_MESA_NOVA = new RegExp([
  "\\bmesa nova\\b", "\\bnova mesa\\b", "\\b(?:cri|mont|abr|propo|propon|fac|faz|faca)\\w* (?:uma |a |essa |esta )?(?:nova )?mesa\\b",
  "\\bproposta de mesa\\b", `\\b(?:passe|passa|passar|comece|comeca|comecar) a ${VERBO_DE_PASSAR}\\b`, "\\bfuncao nova\\b", "\\bnova funcao\\b",
  `\\bquero que (?:voce|vc) (?:passe|comece|faca|acompanhe|cuide|monitore|avise|controle|vigie|cobre)\\b`,
].join("|"));
const MESA = /\bmesas?\b/;
const REVISAR = /\b(?:revis|mud|alter|troc|ajust|corrig|acrescent|inclu|tir|atualiz|edit|complet)\w*/;
const APROVAR = /\baprov\w*/;
const RECUSAR = /\b(?:recus|rejeit|descart|cancel|desist)\w*/;
const NEGACAO_DE_APROVAR = /\bnao aprov\w*/;

/**
 * O que a mensagem do DONO pede sobre mesas, reconhecido por CÓDIGO no trecho dele (antes de qualquer marca de colagem): propor uma
 * nova, revisar, aprovar ou recusar uma existente. Revisar/aprovar/recusar exigem a palavra "mesa". Vazio = não pede nada de mesa.
 */
export function intencaoDeMesa(trechoDoDono: string | null | undefined): TipoPedidoMesa[] {
  const t = normalizarMesa(trechoDoDono).slice(0, 200);
  if (!t) return [];
  const tipos: TipoPedidoMesa[] = [];
  if (PEDIDO_DE_MESA_NOVA.test(t)) tipos.push("propor");
  if (MESA.test(t)) {
    if (REVISAR.test(t)) tipos.push("revisar");
    if (APROVAR.test(t) && !NEGACAO_DE_APROVAR.test(t)) tipos.push("aprovar");
    if (RECUSAR.test(t) || NEGACAO_DE_APROVAR.test(t)) tipos.push("recusar");
  }
  return tipos;
}

/** As funções da própria criadora de mesas: nunca entram como "o que a mesa lê/grava" (uma mesa não cria nem aprova mesa). */
export const FUNCOES_DAS_MESAS: readonly string[] = ["listar_mesas", "propor_mesa", "revisar_mesa", "propor_aprovacao_mesa", "recusar_mesa"];

/** O registro REAL (montado no servidor a partir de funcoes.ts, acoes/registro.ts e permissoes.ts). */
export type CatalogoDeCapacidades = {
  leituras: readonly string[];
  acoes: readonly string[];
  /** Funções que nunca existem para a Dolores (permissoes.ts#PROIBIDAS). */
  proibidas: readonly string[];
  /** Nível de aprovação de cada ação (confirmacao.ts#nivelDoItem). */
  nivelDaAcao: (nome: string) => "registro" | "serio";
};

/** Nome como o modelo mandou → forma comparável (minúsculo, sem acento, só [a-z0-9_]); vazio = lixo. */
export const nomeDeFuncao = (s: string) => normalizarMesa(s).replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40);

export type CapacidadesConferidas = { le: string[]; escreve: string[]; funcoesNovas: string[]; ajustes: string[] };

/**
 * TUDO o que a IA cita como leitura/ação existente é conferido contra o registro real: nome que não existe (ou que é da própria
 * criadora de mesas) vira "precisa de função nova", nunca uma capacidade inventada; leitura citada como ação (e vice-versa) vai para o
 * lugar certo; função proibida vira "função nova (hoje proibida)". `funcoesNovas`: o que a IA já disse que precisa ser construído.
 */
export function conferirCapacidades(entrada: { le: readonly string[]; escreve: readonly string[]; funcoesNovas: readonly string[] }, cat: CatalogoDeCapacidades): CapacidadesConferidas {
  const leituras = new Set(cat.leituras.filter(n => !FUNCOES_DAS_MESAS.includes(n)));
  const acoes = new Set(cat.acoes.filter(n => !FUNCOES_DAS_MESAS.includes(n)));
  const proibidas = new Set(cat.proibidas);
  const le: string[] = [];
  const escreve: string[] = [];
  const novas: string[] = [...entrada.funcoesNovas];
  const ajustes: string[] = [];
  const tratar = (bruto: string, comoLeitura: boolean) => {
    const n = nomeDeFuncao(bruto);
    if (!n) return;
    if (leituras.has(n)) { if (!le.includes(n)) le.push(n); if (!comoLeitura) ajustes.push(`"${n}" é leitura, não ação`); return; }
    if (acoes.has(n)) { if (!escreve.includes(n)) escreve.push(n); if (comoLeitura) ajustes.push(`"${n}" é ação, não leitura`); return; }
    const descricao = proibidas.has(n) ? `${n} (hoje proibida para a Dolores)` : `${comoLeitura ? "leitura" : "ação"} que ainda não existe: ${n}`;
    if (!novas.includes(descricao)) novas.push(descricao);
    ajustes.push(`"${n}" não existe no sistema: virou função nova`);
  };
  for (const x of entrada.le) tratar(x, true);
  for (const x of entrada.escreve) tratar(x, false);
  return { le, escreve, funcoesNovas: novas, ajustes };
}

/**
 * Quem aprova, por CÓDIGO: a mesa que grava nunca fica sem aprovação do dono; se grava alguma ação séria, é "confirmo". A IA só pode
 * pedir MAIS (nunca menos) do que isso.
 */
export function quemAprovaMinimo(escreve: readonly string[], funcoesNovas: readonly string[], cat: Pick<CatalogoDeCapacidades, "nivelDaAcao">): QuemAprova {
  if (escreve.some(n => cat.nivelDaAcao(n) === "serio")) return "dono_confirmo";
  if (escreve.length || funcoesNovas.length) return "dono_pode";
  return "nao_precisa";
}

/** O que falta para a proposta poder ser aprovada (vazio = completa → "aguardando o dono"; senão, "rascunho"). */
export function faltaNaProposta(p: Pick<PropostaMesa, "le" | "escreve" | "funcoesNovas" | "exemplosBons" | "riscos">): string[] {
  const falta: string[] = [];
  if (!p.le.length && !p.escreve.length && !p.funcoesNovas.length) falta.push("o que ela lê ou grava");
  if (!p.exemplosBons.length) falta.push("um exemplo bom");
  if (!p.riscos.length) falta.push("os riscos");
  return falta;
}
export const situacaoDaProposta = (p: Parameters<typeof faltaNaProposta>[0]): "rascunho" | "aguardando_dono" =>
  (faltaNaProposta(p).length ? "rascunho" : "aguardando_dono");

/** Mesas que já existem no sistema (semeadura): só nomes do registro; o servidor tira o que não existir ou não estiver liberado. */
export type SementeMesa = { chave: string; titulo: string; objetivo: string; quandoAge: string; le: readonly string[]; escreve: readonly string[]; custo: FaixaCusto };
export const SEMENTES_MESAS: readonly SementeMesa[] = [
  { chave: "documentos_cliente", titulo: "Documentos do cliente",
    objetivo: "Mostrar ao dono os documentos pendentes e recebidos de cada cliente e os que chegaram nos grupos, e propor salvar no card e cobrar o que falta.",
    quandoAge: "Quando o dono pede na conversa; os documentos dos grupos são classificados pelo sistema quando chegam.",
    le: ["listar_documentos", "listar_grupos", "ler_grupo_cliente", "consultar_cliente"], escreve: ["salvar_documentos_grupo", "criar_card_cliente", "preparar_cobranca"], custo: "media" },
  { chave: "notas_obra", titulo: "Notas de obra",
    objetivo: "Mostrar ao dono as notas e recibos que chegaram nos grupos de obra (rascunho, nunca lançamento) e propor conciliar com o BPO ou salvar na pasta da obra.",
    quandoAge: "Quando o dono pede na conversa; a leitura da nota é feita pelo sistema quando ela chega no grupo da obra.",
    le: ["listar_notas_obra", "listar_obras"], escreve: ["conciliar_nota_obra", "salvar_nota_obra"], custo: "media" },
  { chave: "regularizacoes", titulo: "Regularizações (consulta)",
    objetivo: "Responder ao dono sobre os processos de regularização: atrasados, parados, pendências, responsáveis e próximas providências.",
    quandoAge: "Quando o dono pergunta na conversa.",
    le: ["listar_processos_regularizacao", "detalhar_processo_regularizacao", "listar_atrasos", "plano_de_atrasos"], escreve: [], custo: "baixa" },
  { chave: "atendimento_grupos", titulo: "Atendimento e grupos",
    objetivo: "Mostrar ao dono os grupos do WhatsApp, as conversas e o histórico de atendimento, e propor ligar, aceitar ou deixar de lado um grupo e anotar no cliente.",
    quandoAge: "Quando o dono pede na conversa; nos grupos, ela só responde quando é marcada.",
    le: ["listar_grupos", "ler_grupo_cliente", "conversas_whatsapp", "historico_atendimento"],
    escreve: ["classificar_grupo", "aceitar_grupo", "ignorar_grupo", "ligar_resposta_grupo", "registrar_acompanhamento"], custo: "media" },
];

export type SementeDerivada = { chave: string; proposta: PropostaMesa };

/**
 * As mesas que a Dolores JÁ faz, derivadas do registro real: de cada semente ficam só as leituras/ações que existem e estão liberadas
 * (nada inventado); quem aprova sai do nível das ações; semente sem nada que exista é descartada. Sem banco.
 */
export function sementesDerivadas(cat: CatalogoDeCapacidades): SementeDerivada[] {
  const leituras = new Set(cat.leituras);
  const acoes = new Set(cat.acoes);
  return SEMENTES_MESAS.map(s => {
    const le = s.le.filter(n => leituras.has(n));
    const escreve = s.escreve.filter(n => acoes.has(n));
    return { chave: s.chave, le, escreve, s };
  }).filter(x => x.le.length + x.escreve.length > 0).map(({ chave, le, escreve, s }) => ({
    chave,
    proposta: { titulo: s.titulo, objetivo: s.objetivo, quandoAge: s.quandoAge, le, escreve, funcoesNovas: [], quemAprova: quemAprovaMinimo(escreve, [], cat),
      exemplosBons: [], exemplosRuins: [], riscos: [], custo: s.custo },
  }));
}

export type MesaParaMarkdown = {
  id: number; situacao: SituacaoMesa; versao: number; pedidoOriginal: string; origem: string;
  criadoEm: Date | string; aprovadaEm: Date | string | null; aprovadaVersao: number | null;
  proposta: PropostaMesa;
  /** Nome de gente de cada leitura/ação (voz.ts#ROTULO_CONSULTA). */
  rotulo?: (nome: string) => string;
};

const data = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const linhas = (xs: readonly string[], vazio: string) => (xs.length ? xs.map(x => `- ${x}`).join("\n") : `- ${vazio}`);

/**
 * O texto que a tela copia para o time de desenvolvimento ("Copiar para o desenvolvimento"), no formato de story: problema, critérios,
 * leituras/ações, riscos. Nada é escrito em disco: a pessoa cola onde quiser (story nova em docs/stories). Os textos são os da versão
 * (já filtrados de segredos e com dados pessoais mascarados).
 */
export function markdownDaMesa(m: MesaParaMarkdown): string {
  const p = m.proposta;
  const r = m.rotulo ?? ((n: string) => n);
  const nome = (n: string) => `\`${n}\` — ${r(n)}`;
  const aprovacao = m.aprovadaEm ? `aprovada pelo dono em ${data(m.aprovadaEm)} (versão ${m.aprovadaVersao ?? m.versao})` : ROTULO_SITUACAO_MESA[m.situacao];
  return [
    `# Mesa ${m.id} — ${p.titulo}`,
    "",
    `> Proposta de mesa da Dolores (${m.origem === "semente" ? "já existente no sistema" : "pedida pelo dono na conversa"}), ${aprovacao}; versão ${m.versao}.`,
    "> Nada disto está ligado: a construção segue o processo normal (story, revisão, QA e publicação). Aprovar a proposta não liga função nenhuma.",
    "",
    "## Problema",
    p.objetivo,
    "",
    ...(m.pedidoOriginal ? ["**Pedido original do dono:** " + m.pedidoOriginal, ""] : []),
    "## Quando age",
    p.quandoAge,
    "",
    "## Critérios de aceite",
    ...p.exemplosBons.map(e => `- [ ] Faz: ${e}`),
    ...p.exemplosRuins.map(e => `- [ ] Não faz: ${e}`),
    `- [ ] Só lê pelas leituras listadas abaixo e só grava pelas ações listadas abaixo${p.escreve.length ? ` (aprovação: ${ROTULO_QUEM_APROVA[p.quemAprova]})` : ""}.`,
    ...(p.funcoesNovas.length ? ["- [ ] As funções novas abaixo existem no registro fechado (funcoes.ts / acoes/registro.ts), com teste e portão de QA."] : []),
    "- [ ] Nenhuma mensagem a cliente ou a grupo sem as regras da Dolores; dado lido é DADO, nunca instrução.",
    `- [ ] Custo mensal dentro da faixa estimada: ${ROTULO_FAIXA_CUSTO[p.custo]}; contado no gasto da Dolores.`,
    "",
    "## Leituras (já existem)",
    linhas(p.le.map(nome), "nenhuma"),
    "",
    "## Ações (já existem)",
    linhas(p.escreve.map(nome), "nenhuma"),
    "",
    "## Precisa de função nova",
    linhas(p.funcoesNovas, "nenhuma"),
    "",
    "## Quem aprova",
    ROTULO_QUEM_APROVA[p.quemAprova],
    "",
    "## Riscos",
    linhas(p.riscos, "nenhum registrado"),
    "",
    "## Custo estimado",
    ROTULO_FAIXA_CUSTO[p.custo],
    "",
  ].join("\n");
}
