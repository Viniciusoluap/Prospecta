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
import { AVISO_REURB } from "./reurb-conhecimento.js";

/** Nome de gente de cada consulta e ação da Dolores (server/dolores/funcoes.ts e acoes/registro.ts; teste confere a lista). */
export const ROTULO_CONSULTA: Readonly<Record<string, string>> = Object.freeze({
  listar_processos_regularizacao: "processos de regularização",
  // EPIC-027 C5 (memória de longo prazo)
  guardar_memoria: "memória", corrigir_memoria: "memória", esquecer_memoria: "memória",
  // EPIC-027 C5-E4
  silenciar_aviso: "avisos automáticos",
  // EPIC-029 S-3 (fiscal)
  listar_notas_fiscais: "notas fiscais a decidir", ver_nota_fiscal: "rascunho da nota fiscal", decidir_nota_fiscal: "decisão da nota fiscal",
  editar_rascunho_nota: "correção da nota fiscal", emitir_nota_fiscal: "emissão da nota fiscal",
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
  analisar_regularizacao_reurb: "análise de REURB", // EPIC-027 C5 (REURB)
  criar_tarefa: "tarefa",
  registrar_acompanhamento: "anotação no cliente",
  preparar_cobranca: "cobrança",
  gerar_documento: "PCI da obra",
  criar_card_cliente: "card do cliente",
  salvar_documentos_grupo: "documentos do grupo",
  conciliar_nota_obra: "conciliação da nota",
  salvar_nota_obra: "nota na pasta da obra",
  // EPIC-027 C5 (E2)
  classificar_grupo: "tipo do grupo",
  aceitar_grupo: "aceite do grupo",
  ignorar_grupo: "grupo deixado de lado",
  ligar_resposta_grupo: "resposta no grupo",
  // EPIC-027 C5-COM (mesa comercial ligada à maquete)
  consultar_maquete_lote: "maquete do lote",
  listar_maquetes_lotes: "lotes com maquete",
  rascunhar_mensagem_lote: "texto para o cliente",
  gerar_link_maquete_lote: "link da maquete",
  // EPIC-027 C5 (criadora de mesas)
  consultar_limites_receita: "limites de receita das empresas",
  listar_mesas: "mesas", propor_mesa: "proposta de mesa", revisar_mesa: "proposta de mesa", propor_aprovacao_mesa: "aprovação de mesa", recusar_mesa: "proposta de mesa",
});

/** "tarefas, obras" — os rótulos das consultas feitas, sem repetir e na ordem; nome desconhecido vira "outra consulta". */
export function rotulosDasConsultas(nomes: readonly string[]): string {
  const r = Array.from(new Set(nomes.map(n => ROTULO_CONSULTA[n] ?? "outra consulta")));
  return r.join(", ");
}

// QA C5-E1 (ReDoS): toda regex daqui é LINEAR — separador obrigatório entre repetições, nada de "[ \t]*" no começo (que, numa
// busca global, vira quadrática em sequência longa de espaços), \s* nunca encostado em outro quantificador que também aceite
// espaço, e tamanhos com teto. A entrada é cortada em MAX_ENTRADA_VOZ antes de qualquer regex. Teste de tempo com entradas
// degeneradas em c5-e1-voz.test.ts e c5-e1-qa.test.ts.
/** Teto da entrada dos filtros desta etapa (a saída do modelo cabe com folga: 5.000 tokens ≈ 15 mil caracteres). */
export const MAX_ENTRADA_VOZ = 20_000;
const SNAKE = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+";
/** Colchetes cujo conteúdo é SÓ identificadores snake_case separados (obrigatoriamente) por ";", "," ou espaço. */
const COLCHETE_DE_FERRAMENTA = new RegExp(`\\[\\s*${SNAKE}(?:(?:\\s*[;,]\\s*|\\s+)${SNAKE})*\\s*[;,]?\\s*\\]`, "g");
/** "(fonte: listar_obras)", "(via consultar_cliente)": parêntese de fonte que cita ferramenta. */
const PARENTESE_DE_FONTE = /\((?:fontes?|via|consultas?|fun[cç](?:ão|ões))(?=[\s:])[^)\n]{0,200}\)/gi;
const TEM_SNAKE = new RegExp(SNAKE);
const NOMES = Object.keys(ROTULO_CONSULTA).sort((a, b) => b.length - a.length);
/** Nome de ferramenta conhecido solto no texto (com crase em volta, se houver). */
const NOME_SOLTO = new RegExp(`\`?\\b(${NOMES.join("|")})\\b\`?`, "g");
/** Id interno citado: "leadId 456", "(grupoId: 12)", "obraId=3". */
const ID_INTERNO = /\(?\b(?:leadId|grupoId|obraId|notaId|processoId|tarefaId|financiamentoId|servicoId|mensagemId)\b(?:[ \t]{0,3}[:=#])?[ \t]{0,3}\d{1,12}\)?/g;
const COD = `[${ALFABETO_CODIGO}]{5}`;
/** "aprovar K7M2P", «recusar K7M2P, AC3DE» (com aspas em volta, se houver). Maiúsculas: é o formato do código. */
const APROVAR_CODIGO = new RegExp(`[«"“']?\\b(?:[Aa]provar|[Aa]provo|[Rr]ecusar|[Rr]ecuso)[ \\t]{1,3}${COD}(?:[ \\t]{0,3}(?:,|\\be\\b)[ \\t]{0,3}${COD}){0,9}\\b[»"”']?`, "g");
const CODG = `[${ALFABETO_CODIGO_GRUPO}]{4}`;
/** "(código K7QM)", "código K7QM". */
const CODIGO_DE_GRUPO = new RegExp(`\\(?\\bc[oó]digo[ \\t]{1,3}${CODG}\\b\\)?`, "g");
/** «grupo K7QM 3», "grupo K7QM ignorar" — comando de grupo entre aspas. */
const COMANDO_DE_GRUPO = new RegExp(`[«"“]grupo[ \\t]{1,3}${CODG}\\b[^»"”\\n]{0,40}[»"”]`, "g");
// Para a MEMÓRIA (semCodigos), mais largo: o comando sem aspas e o verbo em qualquer caixa. QA C5-E1 rodada 2: só conta como
// CÓDIGO a palavra TODA EM MAIÚSCULAS ou com pelo menos um dígito (conferido no replacer, `pareceCodigo`) — palavra comum em
// minúsculas ("venda", "ajuda", "nada") nunca é apagada, para não mudar o sentido. O comando de decisão em si (minúsculas
// inclusive) já entra na memória como frase neutra (whatsapp.ts, FRASE_DECISAO_NA_MEMORIA).
const APROVAR_CODIGO_LARGO = new RegExp(`\\b(?:aprovar|aprovo|recusar|recuso)[ \\t]{1,3}${COD}(?:[ \\t]{0,3}(?:,|\\be\\b)[ \\t]{0,3}${COD}){0,9}\\b`, "gi");
/** Palavra com cara de código do sistema: toda em maiúsculas ou com algum dígito (o formato e o alfabeto já vêm da regex). */
export const pareceCodigo = (p: string) => /\d/.test(p) || (p === p.toUpperCase() && p !== p.toLowerCase());
const CODIGO_DE_GRUPO_LARGO = new RegExp(`\\(?\\bc[oó]digo[ \\t]{1,3}${CODG}\\b\\)?`, "gi");
const COMANDO_DE_GRUPO_LARGO = new RegExp(`\\bgrupo[ \\t]{1,3}${CODG}\\b`, "gi");

const MARCA = "\u0000";
const ehEspaco = (c: string) => c === " " || c === "\t";

/**
 * Junta o que sobrou em volta das remoções (só nesses pontos: o resto do texto fica como veio). Sem regex sobre o texto inteiro
 * (linear): parte nas marcas, tira os espaços que encostam nelas e junta com nada (antes de pontuação, quebra ou fim) ou com um espaço.
 */
function costurar(t: string): string {
  const partes = t.split(MARCA);
  let fim = partes[0];
  for (let i = 1; i < partes.length; i++) {
    let e = fim.length;
    while (e > 0 && ehEspaco(fim[e - 1])) e--;
    fim = fim.slice(0, e);
    const p = partes[i];
    let k = 0;
    while (k < p.length && ehEspaco(p[k])) k++;
    const resto = p.slice(k);
    const proximo = resto[0];
    const junta = proximo === undefined ? "" : ".,;:!?)\n".includes(proximo) || fim.length === 0 || fim.endsWith("\n") ? "" : " ";
    fim += junta + resto;
  }
  return fim.replace(/\(\)|\[\]/g, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Filtro de saída da voz (só o texto do MODELO). Devolve o texto e quantas correções houve (vai para a auditoria como
 * número, sem texto). Entrada acima de MAX_ENTRADA_VOZ é cortada antes (o envio corta em 3 mensagens bem antes disso).
 */
export function vozDaDolores(texto: string): { texto: string; correcoes: number } {
  let correcoes = 0;
  const marcar = () => { correcoes++; return MARCA; };
  // o aviso fixo da REURB fecha o parecer: o corte de tamanho leva o corpo, nunca o aviso (ele volta ao fim, intacto)
  const bruto = String(texto ?? "");
  const fecho = bruto.trimEnd().endsWith(AVISO_REURB) ? AVISO_REURB : "";
  const corpo = fecho ? bruto.trimEnd().slice(0, -fecho.length).trimEnd() : bruto;
  let t = corpo.slice(0, MAX_ENTRADA_VOZ - (fecho ? fecho.length + 2 : 0)).replaceAll(MARCA, "");
  t = t.replace(COLCHETE_DE_FERRAMENTA, marcar);
  t = t.replace(PARENTESE_DE_FONTE, m => (TEM_SNAKE.test(m) ? marcar() : m));
  t = t.replace(NOME_SOLTO, (_m, nome: string) => { correcoes++; return ROTULO_CONSULTA[nome] ?? ""; });
  t = t.replace(ID_INTERNO, marcar);
  t = t.replace(APROVAR_CODIGO, marcar);
  t = t.replace(COMANDO_DE_GRUPO, marcar);
  t = t.replace(CODIGO_DE_GRUPO, marcar);
  const saida = correcoes ? costurar(t).trim() : t;
  return { texto: fecho ? `${saida.trimEnd()}\n\n${fecho}` : saida, correcoes };
}

const ultimaPalavra = (m: string) => m.trim().split(/[ \t]+/).pop() ?? "";
/**
 * "aprovar K7M3P e AC3DE" → só a parte até o último código de verdade sai; a partir da primeira palavra que não parece código
 * ("aprovar venda do lote", "aprovar K7M3P e ajuda"), o resto fica como veio.
 */
function verbosComCodigos(m: string): string {
  const partes = m.split(/([ \t]*(?:,|\be\b)[ \t]*|[ \t]+)/); // [verbo, sep, código, sep, código, …]
  let corte = 0; // índice (em `partes`) do último código aceito
  for (let i = 2; i < partes.length; i += 2) { if (!pareceCodigo(partes[i])) break; corte = i; }
  if (!corte) return m;
  return MARCA + partes.slice(corte + 1).join("");
}

/** Tira códigos de aprovação e de grupo (texto que vai para a memória: o modelo nunca vê códigos), em qualquer caixa e sem aspas. */
export function semCodigos(texto: string): string {
  const t = String(texto ?? "").slice(0, MAX_ENTRADA_VOZ).replaceAll(MARCA, "")
    .replace(COMANDO_DE_GRUPO, MARCA)
    .replace(APROVAR_CODIGO_LARGO, verbosComCodigos)
    .replace(COMANDO_DE_GRUPO_LARGO, m => (pareceCodigo(ultimaPalavra(m)) ? `grupo${MARCA}` : m))
    .replace(CODIGO_DE_GRUPO_LARGO, m => (pareceCodigo(ultimaPalavra(m.replace(/\)$/, ""))) ? MARCA : m));
  return t.includes(MARCA) ? costurar(t).trim() : t;
}

/** Normaliza a mensagem do dono para os reconhecimentos por código (sem regex sobre espaço no fim: linear). */
const normalizar = (s: string) => {
  let t = String(s ?? "").slice(0, 400).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  let e = t.length;
  while (e > 0 && (t[e - 1] === "." || t[e - 1] === "!" || /\s/.test(t[e - 1]))) e--;
  t = t.slice(0, e);
  return t.replace(/\s+/g, " ");
};
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
  const t = normalizar(String(texto ?? ""));
  return /\b(lista completa|todos os|todas as|tudo sobre|relatorio|detalhad[oa]s?|detalhe|completo|completa|analise|cada um|um por um|item por item)\b/.test(t);
}
