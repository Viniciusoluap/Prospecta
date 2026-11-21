// EPIC-027 C5 (E1) — a "voz" da Dolores na conversa com o dono: regras PURAS, por código (nunca pela IA).
//   - vozDaDolores: filtro de saída aplicado SÓ ao texto do modelo (nunca aos quadros do sistema) antes dos filtros de
//     segurança. Tira o que é de sistema e escapou ao modelo: nome de ferramenta entre colchetes ("[listar_grupos;
//     ler_grupo_cliente]"), nome de ferramenta solto (vira um rótulo de gente), id interno ("leadId 456"), "aprovar CÓDIGO" e
//     código de grupo. Os marcadores do filtro de segurança ("[senha omitida]", "[link removido]", "[dado pessoal omitido]")
//     têm espaço e acento e NUNCA casam; colchete legítimo ("[1]", "[RG]") também fica.
//   - semCodigos: tira os códigos de aprovação e de grupo de um texto que vai para a memória (o modelo nunca vê códigos).
//   - ROTULO_CONSULTA: o nome de gente de cada consulta/ação ("listar_tarefas" → "tarefas").
//   - ehPedidoDeEsquecer / pedeDetalhe: a mensagem do dono, reconhecida por código.
import { ALFABETO_CODIGO } from "./fila.js";
import { ALFABETO_CODIGO_GRUPO } from "./grupos-tipo.js";

/** Nome de gente de cada consulta e ação da Dolores (server/dolores/funcoes.ts e acoes/registro.ts; teste confere a lista). */
export const ROTULO_CONSULTA: Readonly<Record<string, string>> = Object.freeze({
  listar_processos_regularizacao: "processos de regularização",
  detalhar_processo_regularizacao: "detalhe do processo",
  consultar_cliente: "cadastro do cliente",
  historico_atendimento: "histórico de atendimento",
  conversas_whatsapp: "conversas do WhatsApp",
  listar_tarefas: "tarefas",
  listar_documentos: "documentos",
  listar_atrasos: "atrasos",
  listar_obras: "obras",
  listar_medicoes: "medições",
  listar_financiamentos: "financiamentos",
  listar_recebiveis_pendentes: "recebíveis",
  listar_grupos: "grupos do WhatsApp",
  ler_grupo_cliente: "mensagens do grupo",
  listar_notas_obra: "notas de obra",
  relatorio_diario: "relatório do dia",
  plano_de_atrasos: "plano dos atrasos",
  criar_tarefa: "tarefa",
  registrar_acompanhamento: "anotação no cliente",
  preparar_cobranca: "cobrança",
  gerar_documento: "PCI da obra",
  criar_card_cliente: "card do cliente",
  salvar_documentos_grupo: "documentos do grupo",
  conciliar_nota_obra: "conciliação da nota",
  salvar_nota_obra: "nota na pasta da obra",
});

/** "tarefas, obras" — os rótulos das consultas feitas, sem repetir e na ordem; nome desconhecido vira "outra consulta". */
export function rotulosDasConsultas(nomes: readonly string[]): string {
  const r = Array.from(new Set(nomes.map(n => ROTULO_CONSULTA[n] ?? "outra consulta")));
  return r.join(", ");
}

const SNAKE = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+";
/** Colchetes cujo conteúdo é SÓ identificadores snake_case separados por ";", "," ou espaço. */
const COLCHETE_DE_FERRAMENTA = new RegExp(`[ \\t]*\\[\\s*${SNAKE}(?:\\s*[;,]?\\s*${SNAKE})*\\s*[;,]?\\s*\\]`, "g");
/** "(fonte: listar_obras)", "(via consultar_cliente)": parêntese de fonte que cita ferramenta. */
const PARENTESE_DE_FONTE = new RegExp(`[ \\t]*\\((?:fontes?|via|consultas?|fun[cç](?:ão|ões))\\s*:?\\s*[^)\\n]{0,200}\\)`, "gi");
const NOMES = Object.keys(ROTULO_CONSULTA).sort((a, b) => b.length - a.length);
/** Nome de ferramenta conhecido solto no texto (com crase em volta, se houver). */
const NOME_SOLTO = new RegExp(`\`?\\b(${NOMES.join("|")})\\b\`?`, "g");
/** Id interno citado: "leadId 456", "(grupoId: 12)", "obraId=3". */
const ID_INTERNO = /[ \t]*\(?\b(?:leadId|grupoId|obraId|notaId|processoId|tarefaId|financiamentoId|servicoId|mensagemId)\b\s*[:=#]?\s*\d+\)?/g;
const COD = `[${ALFABETO_CODIGO}]{5}`;
/** "aprovar K7M2P", «recusar K7M2P, AC3DE» (com aspas em volta, se houver). Maiúsculas: é o formato do código. */
const APROVAR_CODIGO = new RegExp(`[«"“']?\\b(?:[Aa]provar|[Aa]provo|[Rr]ecusar|[Rr]ecuso)\\s+${COD}(?:\\s*(?:,|\\be\\b)\\s*${COD})*\\b[»"”']?`, "g");
const CODG = `[${ALFABETO_CODIGO_GRUPO}]{4}`;
/** "(código K7QM)", "código K7QM". */
const CODIGO_DE_GRUPO = new RegExp(`[ \\t]*\\(?\\bc[oó]digo\\s+${CODG}\\b\\)?`, "g");
/** «grupo K7QM 3», "grupo K7QM ignorar" — comando de grupo entre aspas. */
const COMANDO_DE_GRUPO = new RegExp(`[«"“]grupo\\s+${CODG}\\b[^»"”\\n]{0,40}[»"”]`, "g");

const MARCA = "\u0000";

/** Junta o que sobrou em volta das remoções (só nesses pontos: o resto do texto fica como veio). */
function costurar(t: string): string {
  return t
    .replace(new RegExp(`[ \\t]*${MARCA}+[ \\t]*(?=[.,;:!?)]|\\n|$)`, "g"), "")
    .replace(new RegExp(`[ \\t]*${MARCA}+[ \\t]*`, "g"), " ")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Filtro de saída da voz (só o texto do MODELO). Devolve o texto e quantas correções houve (vai para a auditoria como
 * número, sem texto).
 */
export function vozDaDolores(texto: string): { texto: string; correcoes: number } {
  let correcoes = 0;
  const marcar = () => { correcoes++; return MARCA; };
  let t = String(texto ?? "");
  t = t.replace(COLCHETE_DE_FERRAMENTA, marcar);
  t = t.replace(PARENTESE_DE_FONTE, m => (new RegExp(SNAKE).test(m) ? marcar() : m));
  t = t.replace(NOME_SOLTO, (_m, nome: string) => { correcoes++; return ROTULO_CONSULTA[nome] ?? ""; });
  t = t.replace(ID_INTERNO, marcar);
  t = t.replace(APROVAR_CODIGO, marcar);
  t = t.replace(COMANDO_DE_GRUPO, marcar);
  t = t.replace(CODIGO_DE_GRUPO, marcar);
  return { texto: correcoes ? costurar(t).trim() : t, correcoes };
}

/** Tira códigos de aprovação e de grupo (texto que vai para a memória: o modelo nunca vê códigos). */
export function semCodigos(texto: string): string {
  const t = String(texto ?? "").replace(APROVAR_CODIGO, MARCA).replace(COMANDO_DE_GRUPO, MARCA).replace(CODIGO_DE_GRUPO, MARCA);
  return t.includes(MARCA) ? costurar(t).trim() : t;
}

const normalizar = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[.!\s]+$/, "").replace(/\s+/g, " ");
const ESQUECER = new Set([
  "esquece", "esqueca", "esquece tudo", "esqueca tudo", "esquece isso", "esqueca isso", "limpa a conversa", "limpar a conversa", "limpa conversa",
  "limpe a conversa", "zera a conversa", "zerar a conversa", "novo assunto", "outro assunto", "comeca de novo", "comecar de novo", "vamos comecar de novo",
  "dolores, esquece", "dolores esquece", "dolores, limpa a conversa", "dolores, novo assunto",
]);
/** "esquece", "limpa a conversa", "novo assunto" — a mensagem INTEIRA (código, sem IA). */
export const ehPedidoDeEsquecer = (texto: string | null | undefined) => ESQUECER.has(normalizar(String(texto ?? "")));
export const FRASE_ESQUECI = "Certo, começamos do zero.";

/** O dono pediu lista completa / relatório / detalhe: libera a saída longa (5.000); senão, resposta curta (1.500). */
export function pedeDetalhe(texto: string | null | undefined): boolean {
  const t = normalizar(String(texto ?? "")).slice(0, 400);
  return /\b(lista completa|todos os|todas as|tudo sobre|relatorio|detalhad[oa]s?|detalhe|completo|completa|analise|cada um|um por um|item por item)\b/.test(t);
}
