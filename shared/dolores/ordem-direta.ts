// EPIC-025 E11 (conversa direta, 23/11/2026) — "ordem direta do dono = confirmação" para o que é REVERSÍVEL. Regras PURAS (sem banco
// nem rede). Pedido do dono: "quero uma assistente pessoal inteligente e rápida, que entenda o contexto, aja e confirme operações com
// convicção, com autonomia; não criar comandos".
//
// O que muda (e o que não muda):
// - Ação reversível de grupo pedida pelo DONO, na conversa direta dele, executa na hora — SEM o "pode" — quando, por CÓDIGO:
//   (1) a função e os argumentos estão na lista fechada abaixo (`podeExecutarPorOrdemDireta`);
//   (2) a mensagem dele tem a INTENÇÃO daquela função (verbo dela, `intencaoDaFuncao`) — um "me diz o que chegou no grupo X" nunca
//       vira "ignorar o grupo X" porque um texto lido pediu;
//   (3) os ALVOS (grupo e cliente/obra) saem das PALAVRAS DELE (código do grupo citado, ou nome que aponta UM só grupo/cliente —
//       `escolherPorNome`), ou do nome do grupo pela regra do dono de 19/11 (um único cliente). Quem confere é o servidor
//       (server/dolores/ordem-direta.ts), nunca o modelo. Alvo que veio de texto lido (não das palavras dele) → UMA confirmação.
// - O que é sério (nota fiscal, cobrança, mensagem a terceiro, dinheiro, tipos que liberam mais, ligar a resposta num grupo, aceitar
//   grupo sem o código digitado) continua pedindo "confirmo"/"pode" como antes (shared/dolores/confirmacao.ts, intacto).
import { normalizarNome } from "./grupos-tipo.js";
import { intencaoDeMemoria } from "./memoria-longa.js";

/** Palavras que aparecem em nome de grupo/cliente mas não identificam ninguém (nunca contam para escolher um alvo). */
export const PALAVRAS_GENERICAS: ReadonlySet<string> = new Set([
  "grupo", "grupos", "obra", "obras", "prospecta", "imp", "imperatriz", "cliente", "clientes", "pos", "venda", "vendas", "atendimento",
  "casa", "reforma", "construcao", "construcoes", "construtora", "financiamento", "regularizacao", "projeto", "familia", "equipe", "time",
  "dono", "dona", "senhor", "senhora", "sra", "sr", "dela", "dele", "deles", "delas", "esse", "essa", "este", "esta", "isso", "aquele", "aquela",
  "pode", "sim", "confirmo", "todos", "todas", "tudo", "para", "pra", "com", "sem", "que", "uma", "uns", "umas", "nos", "nas", "das", "dos",
  "ltda", "eireli", "sociedade", "residencial", "condominio", "lote", "quadra", "rua", "avenida", "bairro", "vila", "jardim",
]);

/** Palavras de um texto que podem identificar alguém: normalizadas, com 3+ letras/dígitos, fora das genéricas. */
export function palavrasQueIdentificam(texto: string | null | undefined): string[] {
  return normalizarNome(texto).split(" ").filter(p => p.length >= 3 && !PALAVRAS_GENERICAS.has(p));
}

export type Candidato = { id: number; nome: string | null };
export type Escolha = { escolhido: number | null; pontos: number; empatados: number[] };

/**
 * Qual candidato as palavras apontam: pontos = quantas palavras do nome dele (as que identificam) estão nas palavras. Só escolhe
 * quando o melhor é ÚNICO e tem ao menos 1 ponto; empate ou nada → ninguém (`empatados` lista os do topo, para oferecer nomes).
 * ATENÇÃO (portão 2, M-C): um cadastro de terceiro com MAIS palavras da frase vence aqui. Por isso a PROVA de alvo da ordem direta usa
 * `unicoComPonto` (nenhum outro candidato com ponto), nunca esta função; esta só serve para sugerir/nomear (ex.: confirmação nomeada).
 */
export function escolherPorNome(palavras: Iterable<string>, candidatos: readonly Candidato[]): Escolha {
  const conjunto = new Set(palavras);
  let melhor = 0;
  let topo: number[] = [];
  for (const c of candidatos) {
    const nome = new Set(palavrasQueIdentificam(c.nome));
    let pontos = 0;
    nome.forEach(p => { if (conjunto.has(p)) pontos++; });
    if (pontos === 0) continue;
    if (pontos > melhor) { melhor = pontos; topo = [c.id]; } else if (pontos === melhor) topo.push(c.id);
  }
  const unicos = Array.from(new Set(topo));
  return { escolhido: melhor > 0 && unicos.length === 1 ? unicos[0] : null, pontos: melhor, empatados: unicos };
}

/**
 * Portão de segurança E11, 2ª rodada (M-C) — "o ÚNICO com ponto": as palavras do dono apontam este candidato e NENHUM outro candidato
 * pontua (qualquer outro com ponto → ninguém; quem chama pergunta com os nomes). Um cadastro de terceiro com mais palavras da frase
 * ("EMILY MANDOU") nunca vence: ele só torna a escolha ambígua.
 */
export function unicoComPonto(palavras: Iterable<string>, candidatos: readonly Candidato[]): { escolhido: number | null; comPonto: number[] } {
  const conjunto = new Set(palavras);
  const comPonto = Array.from(new Set(candidatos.filter(c => palavrasQueIdentificam(c.nome).some(p => conjunto.has(p))).map(c => c.id)));
  return { escolhido: comPonto.length === 1 ? comPonto[0] : null, comPonto };
}

/** O código do grupo (4 caracteres do alfabeto do sistema) aparece como palavra inteira no texto do dono (qualquer caixa)? */
export function codigoCitado(texto: string | null | undefined, codigo: string | null | undefined): boolean {
  if (!codigo || !/^[A-Za-z0-9]{4,5}$/.test(codigo)) return false;
  return normalizarNome(texto).split(" ").includes(codigo.toLowerCase());
}

/**
 * Portão 11 (R2): o código foi digitado DE PROPÓSITO? Código sorteado pode coincidir com palavra comum ou nome ("VERA", "DUDA", "PARA",
 * "CADA"): esse só vale quando o dono o escreveu em MAIÚSCULAS numa mensagem que não está toda em maiúsculas. Código com dígito ou só
 * de consoantes ("KHMN", "AA7W") não é palavra — vale em qualquer caixa. `textoCru`: a mensagem como ele escreveu.
 */
export function codigoDigitadoDeProposito(textoCru: string | null | undefined, codigo: string | null | undefined): boolean {
  if (!codigoCitado(textoCru, codigo)) return false;
  const c = String(codigo);
  if (/\d/.test(c) || !/[aeiou]/i.test(c)) return true;
  const cru = String(textoCru ?? "");
  return /[a-zà-ÿ]/.test(cru) && new RegExp(`(?:^|[^0-9A-Za-zÀ-ÿ])${c.toUpperCase()}(?:[^0-9A-Za-zÀ-ÿ]|$)`).test(cru);
}

/** "cliente 29", "nº 29", "número 29" no texto do dono (nunca um número solto: "1" pode ser a opção da lista). */
export function numeroCitado(texto: string | null | undefined, id: number): boolean {
  const n = normalizarNome(String(texto ?? "").replace(/[º°]/g, " "));
  return new RegExp(`\\b(?:cliente|obra|n|no|numero) ${id}\\b`).test(n);
}

/** Tipos simples (um cliente/obra só) que a ordem direta pode definir; os que liberam mais continuam sérios. */
const TIPOS_DIRETOS = new Set(["cliente", "pos_atendimento", "engenharia"]);

/**
 * Lista FECHADA do que pode rodar sem o "pode" quando o dono manda (E11). Lê os argumentos como o modelo pediu E como o servidor
 * preparou (os dois passam por aqui; o preparado passa também por `preparadoPodeIrDireto`). Qualquer outra função, ou argumento fora do esperado → false (segue a confirmação de sempre).
 * `aceitar_grupo` só com o código do grupo digitado pelo dono (conferido no servidor: `exigeCodigoDigitado`).
 */
export function podeExecutarPorOrdemDireta(funcao: string, argumentos: unknown): boolean {
  const a = (argumentos && typeof argumentos === "object" ? argumentos : {}) as Record<string, unknown>;
  switch (funcao) {
    case "classificar_grupo": return typeof a.tipo === "string" && TIPOS_DIRETOS.has(a.tipo);
    case "ignorar_grupo": case "aceitar_grupo": return true;
    // desligar a resposta (literalmente false) só a deixa calada; LIGAR amplia o que ela fala — continua com a confirmação
    case "ligar_resposta_grupo": return a.ligado === false;
    // EPIC-025 E11b (autorização do dono de 23/11): registros reversíveis — o TEXTO gravado e os alvos também são conferidos no servidor
    // Decisão do dono em 24/11/2026 ("Opção A", depois de 8 portões reprovados pela mesma causa): só tarefa e anotação DITADAS com ":"
    // vão direto (conferido no servidor). Guardar, corrigir e esquecer lembrança voltaram a pedir o "pode".
    case "criar_tarefa": case "registrar_acompanhamento": return true;
    case "silenciar_aviso": return typeof a.silenciar === "boolean" && typeof a.tipo === "string";
    default: return false;
  }
}
/** aceitar grupo em que outra pessoa (ou não se sabe quem) a colocou: só com o CÓDIGO do grupo nas palavras do dono. */
export const exigeCodigoDigitado = (funcao: string) => funcao === "aceitar_grupo";

/** Verbos que mostram a intenção de cada função, na mensagem do dono (sem acento, minúscula). */
const INTENCAO: Readonly<Record<string, RegExp>> = {
  classificar_grupo: /\b(?:vincul\w*|lig(?:ar|a|ue|uem|ou)|classific\w*|defin(?:ir|a|e)|marc(?:ar|a)|coloc(?:ar|a)|coloqu\w*|troc(?:ar|a|e)|associ\w*|junt(?:ar|a))\b/,
  aceitar_grupo: /\baceit\w*/,
  ignorar_grupo: /\b(?:ignor\w*|deix\w* de lado|desativ\w*)\b/,
  ligar_resposta_grupo: /\b(?:deslig\w*|par\w* de respond\w*|nao respond\w*|cal(?:ar|a|e|ada))\b/,
  // E11b
  criar_tarefa: /\btarefas?\b/,
  registrar_acompanhamento: /\b(?:anot\w*|registr\w*|acompanhamento|historico)\b/,
  silenciar_aviso: /\b(?:avis\w*|silenci\w*|relig\w*)\b/,
};
/** E11b: memória usa o reconhecimento que já existia ("lembra que…", "esquece que…", "corrige…"). */
const FUNCOES_DE_MEMORIA = new Set(["guardar_memoria", "corrigir_memoria", "esquecer_memoria"]);
export function intencaoDaFuncao(funcao: string, textoDoDono: string | null | undefined): boolean {
  if (negaAcao(textoDoDono)) return false;
  if (FUNCOES_DE_MEMORIA.has(funcao)) return intencaoDeMemoria(textoDoDono);
  const r = INTENCAO[funcao];
  if (!r) return false;
  const t = String(textoDoDono ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return r.test(t);
}

/**
 * Portão de QA E11 (M1): o dono NEGA uma ação ("não vincula…", "nunca ignore…", "nem anota", "jamais", "sem criar")? Por código: a
 * negação até 3 palavras antes de um verbo de ação. Com negação, nada roda pela ordem direta (no máximo, a confirmação de sempre).
 */
const NEGACAO = /\b(?:nao|nem|nunca|jamais|sem)\b(?: \S+){0,3}? (?:cri\w*|anot\w*|registr\w*|lembr\w*|guard\w*|corrig\w*|esquec\w*|silenci\w*|vincul\w*|lig\w*|ignor\w*|aceit\w*|deslig\w*|classific\w*|defin\w*|fa(?:z|ca|zer)|marc\w*|agend\w*|coloc\w*|troc\w*|associ\w*|junt\w*|par\w*)\b/;
export function negaAcao(textoDoDono: string | null | undefined): boolean {
  return NEGACAO.test(normalizarNome(textoDoDono));
}

/**
 * Portão de QA E11 (I2): o item PREPARADO pode rodar sem confirmação? Além da lista fechada, classificar só na PRIMEIRA definição
 * (`troca` literalmente false, montado pelo servidor): trocar o cliente ou o tipo de um grupo já definido vai SEMPRE para UMA
 * confirmação mostrando o "hoje: …". (O dono listou "inclusive troca"; a segurança prevaleceu — registrado na story.)
 */
export function preparadoPodeIrDireto(funcao: string, argumentosPreparados: unknown): boolean {
  if (!podeExecutarPorOrdemDireta(funcao, argumentosPreparados)) return false;
  const a = (argumentosPreparados && typeof argumentosPreparados === "object" ? argumentosPreparados : {}) as Record<string, unknown>;
  return funcao !== "classificar_grupo" || a.troca === false;
}

/** Tipo pedido coerente com as palavras: engenharia só se ele disse "engenharia"; pós só se disse "pós". Cliente é o padrão. */
export function tipoDitoPeloDono(tipo: string, textoDoDono: string | null | undefined): boolean {
  const n = normalizarNome(textoDoDono);
  const eng = /\bengenhar/.test(n);
  const pos = /\bpos\b|\bposvenda\b/.test(n);
  // Portão 12 (T1) e 13 (c1): palavra de OUTRO tipo, ou "obra"/"atendimento" (sem "pós"), nunca vira grupo de cliente
  const outro = /\bjuridic|\badministr|\bsoci[oa]s?\b|\bparceir|\bcorretor|\bintern[oa]s?\b|\bobras?\b/.test(n) || (!pos && /\batendimento\b/.test(n));
  const cli = /\bclientes?\b/.test(n);
  // Portão 13 (c2): mais de um tipo na frase ("como engenharia pós venda", "cliente engenharia") → a escolha não fica com o modelo
  const ditos = [eng, pos, outro, cli].filter(Boolean).length;
  if (tipo === "engenharia") return eng && ditos === 1;
  if (tipo === "pos_atendimento") return pos && ditos === 1;
  return tipo === "cliente" && !eng && !pos && !outro;
}

// ── Confirmação nomeada: "o grupo da Emily pode", "pode o da Maria Dayane", "pode todos" ──

export const MAX_CARACTERES_CONFIRMACAO_NOMEADA = 80;
const AFIRMA = new Set(["pode", "sim", "ok", "confirmo", "faz", "faca", "manda"]);
/** Palavras que só ligam a frase ("o grupo da …") — saem da referência. */
const LIGACAO = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das", "e", "grupo", "grupos", "isso", "esse", "essa", "tambem", "ai", "la", "eu", "ja", "so", "somente", "apenas"]);
const VERBO_NOVO = /\b(?:cri(?:e|ar|a)|registr\w*|anot\w*|apag\w*|exclu\w*|mand(?:ar|e)|envi\w*|cobr\w*|emit\w*|cancel\w*|pag(?:ar|a|ue)|transfer\w*|ger(?:e|ar)|prepar\w*)\b/;

const VOCABULARIO_DE_TIPO: ReadonlySet<string> = new Set(["como", "tipo", "cliente", "clientes", "pos", "posvenda", "venda", "vendas", "atendimento", "engenharia",
  "juridico", "administrativo", "socio", "socios", "parceiro", "parceiros", "obra", "obras", "interno", "interna"]);
const EXCLUSAO_OU_CONDICAO: ReadonlySet<string> = new Set(["menos", "exceto", "fora", "salvo", "tirando", "sem", "nem", "se", "caso", "quando",
  "depois", "antes", "mas", "porem", "talvez", "ainda", "nunca", "jamais", "nenhum", "nenhuma", "outro", "outra", "outros", "outras"]);
/** Formas exatas dos verbos de ordem (palavra inteira — "Marcos", "Cristina", "Lígia" não são verbo). */
const VERBO_DE_ORDEM: ReadonlySet<string> = new Set(["ignorar", "ignora", "ignore", "vincular", "vincula", "vincule", "desligar", "desliga", "desligue", "ligar", "liga", "ligue",
  "aceitar", "aceita", "aceite", "classificar", "classifica", "classifique", "definir", "define", "defina", "marcar", "marca", "marque", "trocar", "troca", "troque",
  "colocar", "coloca", "coloque", "silenciar", "silencia", "silencie", "esquecer", "esquece", "esqueca", "lembrar", "lembra", "lembre", "guardar", "guarda", "guarde",
  "corrigir", "corrige", "corrija", "salvar", "salva", "salve", "agendar", "agenda", "agende", "desfazer", "desfaz", "desfaca", "recusar", "recusa", "recuse",
  "parar", "pare", "voltar", "volta", "volte", "religar", "religa", "religue", "tirar", "tira", "tire", "remover", "remove", "remova", "mudar", "muda", "mude"]);
export type EntidadeNomeada = "grupo" | "tarefa" | "anotacao" | "lembranca" | "aviso";
export type ConfirmacaoNomeada = { tipo: "sim" | "confirmo"; todos: boolean; referencia: string[]; entidade?: EntidadeNomeada };
/** Codex #341 (P2): a coisa que ele nomeou na confirmação ("o GRUPO da Emily pode") restringe os itens que ela pode confirmar. */
const ENTIDADE_DA_PALAVRA: Readonly<Record<string, EntidadeNomeada>> = { grupo: "grupo", grupos: "grupo", tarefa: "tarefa", tarefas: "tarefa", anotacao: "anotacao", anotacoes: "anotacao",
  nota: "anotacao", lembranca: "lembranca", lembrancas: "lembranca", memoria: "lembranca", aviso: "aviso", avisos: "aviso" };
/** A função do item da fila é da entidade nomeada? */
export function funcaoDaEntidade(funcao: string, entidade: EntidadeNomeada): boolean {
  if (entidade === "grupo") return funcao.endsWith("_grupo");
  if (entidade === "tarefa") return funcao === "criar_tarefa";
  if (entidade === "anotacao") return funcao === "registrar_acompanhamento";
  if (entidade === "lembranca") return funcao.endsWith("_memoria");
  return funcao === "silenciar_aviso";
}

/**
 * Resposta do dono a uma proposta que NOMEIA o item ("o grupo da Emily pode", "pode o da Maria", "confirmo o da nota 12", "pode
 * todos"). Por CÓDIGO: uma linha, até 80 caracteres, começa ou termina pela palavra que confirma, o resto tem no máximo 6 palavras e
 * nenhum verbo de pedido novo ("pode criar…", "pode mandar…" não são confirmação). Sem referência → null (o "pode" solto é da E2).
 */
export function lerConfirmacaoNomeada(texto: string | null | undefined): ConfirmacaoNomeada | null {
  const bruto = String(texto ?? "");
  if (!bruto.trim() || bruto.length > MAX_CARACTERES_CONFIRMACAO_NOMEADA || /[\r\n?]/.test(bruto)) return null;
  const n = normalizarNome(bruto);
  if (VERBO_NOVO.test(n)) return null;
  const ps = n.split(" ").filter(Boolean);
  // Codex #341 (P1): ordem NOVA de grupo, lembrança ou aviso ("pode ignorar o grupo da Emily") nunca confirma outra coisa que espera
  if (ps.some(p => VERBO_DE_ORDEM.has(p))) return null;
  if (ps.length < 2) return null;
  const primeira = ps[0];
  const ultima = ps[ps.length - 1];
  const fim = AFIRMA.has(ultima) && !(ps.length >= 2 && ps[ps.length - 2] === "nao");
  const inicio = AFIRMA.has(primeira);
  if (!fim && !inicio) return null;
  if (ps.includes("nao")) return null;
  // Codex #341 (P1): exclusão ou condição ("pode todos menos o da Emily", "confirmo todos exceto…", "pode o da Emily se…") nunca é
  // confirmação nomeada — "menos"/"exceto" não fazem parte do nome e o item excluído seria justamente o executado
  if (ps.some(p => EXCLUSAO_OU_CONDICAO.has(p))) return null;
  // Codex #341 (5ª passada, P1): tempo ou adiamento ("pode amanhã o da Emily", "confirmo o da Emily às 18h") nunca é confirmação —
  // confirmar é AGORA; a palavra de tempo não pode virar "nome" ignorável
  if (ps.some(p => CONDICAO_OU_TEMPO.has(p) || /^\d{1,2}h(?:\d{2})?$/.test(p) || MESES_E_SEMANA.test(p)) || /\d[:/]\d/.test(bruto)) return null;
  const confirmo = ps.includes("confirmo");
  // Codex #341 (6ª passada, P2): a palavra da entidade ("tarefas", "anotações") sai antes de decidir se é "todos" —
  // "pode todas as tarefas" é o lote das tarefas (a restrição da entidade continua valendo na execução)
  const resto = (fim ? ps.slice(0, -1) : ps.slice(1)).filter(p => !AFIRMA.has(p) && !LIGACAO.has(p) && p !== "sim" && !ENTIDADE_DA_PALAVRA[p]);
  if (!resto.length || resto.length > 6) return null;
  // QA 14 (C1): palavra de TIPO ou "como" na confirmação ("pode o grupo da Emily como pós") pede algo diferente da proposta —
  // confirmar é aceitar a proposta como ela foi mostrada; mudar o tipo é pedido novo
  if (resto.some(p => VOCABULARIO_DE_TIPO.has(p))) return null;
  const todos = resto.every(p => p === "todos" || p === "todas" || p === "tudo");
  // "todos" misturado com um nome ("pode todos o da Emily") é ambíguo → não é confirmação
  if (!todos && resto.some(p => p === "todos" || p === "todas" || p === "tudo")) return null;
  const entidades = Array.from(new Set(ps.map(p => ENTIDADE_DA_PALAVRA[p]).filter((e): e is EntidadeNomeada => !!e)));
  // duas coisas nomeadas ("o grupo e a tarefa da Emily pode") → ambíguo
  if (entidades.length > 1) return null;
  // Codex #341 (P2): "pode todos os grupos" vale só para os itens de grupo
  if (todos) return { tipo: confirmo ? "confirmo" : "sim", todos: true, referencia: [], ...(entidades[0] ? { entidade: entidades[0] } : {}) };
  const referencia = resto.filter(p => !ENTIDADE_DA_PALAVRA[p] && ((p.length >= 3 && !PALAVRAS_GENERICAS.has(p)) || (/^[a-z0-9]{4}$/.test(p) && /\d/.test(p))));
  if (!referencia.length) return null;
  return { tipo: confirmo ? "confirmo" : "sim", todos: false, referencia, ...(entidades[0] ? { entidade: entidades[0] } : {}) };
}

/**
 * A resposta do dono a "de qual cliente é?" só com o NOME ("Maria dayane", "1 Maria Dayane", "é da Emily"). Uma linha, até 60
 * caracteres, até 6 palavras, sem "?", sem verbo de ação, sem número além da opção no começo. Devolve as palavras do nome e o tipo
 * (2 no começo = pós-atendimento). Quem confere se é UM cliente é o servidor.
 */
export function lerNomeDeCliente(texto: string | null | undefined): { palavras: string[]; tipo: "cliente" | "pos_atendimento" } | null {
  const bruto = String(texto ?? "");
  if (!bruto.trim() || bruto.length > 60 || /[\r\n?]/.test(bruto)) return null;
  let ps = normalizarNome(bruto).split(" ").filter(Boolean);
  let tipo: "cliente" | "pos_atendimento" = "cliente";
  if (ps[0] === "1" || ps[0] === "2") { tipo = ps[0] === "2" ? "pos_atendimento" : "cliente"; ps = ps.slice(1); }
  ps = ps.filter(p => !["e", "o", "a", "da", "do", "de", "cliente", "grupo"].includes(p));
  if (!ps.length || ps.length > 6 || ps.some(p => /\d/.test(p)) || VERBO_NOVO.test(ps.join(" "))) return null;
  if (ps.some(p => ["pode", "sim", "nao", "ok", "confirmo", "obrigado", "obrigada", "bom", "boa", "dia", "tarde", "noite", "oi", "ola"].includes(p))) return null;
  const palavras = ps.filter(p => p.length >= 3 && !PALAVRAS_GENERICAS.has(p));
  return palavras.length ? { palavras, tipo } : null;
}

/** A linha fixa (texto do SISTEMA) do que foi feito por ordem direta — uma linha, com como desfazer. */
export function linhaDoFeito(frases: readonly string[]): string | null {
  const limpas = frases.map(f => f.trim().replace(/\.+$/, "")).filter(Boolean);
  if (!limpas.length) return null;
  return `Feito: ${limpas.join("; ")}. Se algo estiver errado, me diga que eu corrijo.`;
}

/** "desfaz", "desfaça", "desfaz isso", "pode desfazer" — a mensagem inteira, por código. */
export function ehPedidoDeDesfazer(texto: string | null | undefined): boolean {
  const n = normalizarNome(texto);
  return /^(?:dolores )?(?:pode )?(?:desfaz|desfaca|desfazer|desfaz isso|desfaca isso|desfazer isso|volta atras|desfaz o ultimo|desfaz a ultima)$/.test(n);
}

/** Portão de QA E11 (M2): o que a linha "Feito" diz quando liga um grupo (a resposta lá continua só quando marcada). */
export const FRASE_SO_QUANDO_MARCADA = "Lá eu só respondo quando me marcarem";

// ── E11b: texto do dono, aviso e como desfazer ──

/**
 * Portão de segurança E11, 2ª rodada (M-B) — direção do aviso por VERBOS explícitos ("para de me avisar", "pare de avisar", "silencia",
 * "deixa de me avisar"; "volta a me avisar", "religa"). "para eu acompanhar" (preposição) não conta. As duas direções na mesma
 * mensagem → nenhuma (confirmação).
 */
const PARAR_DE_AVISAR = /\b(?:(?:parar|pare|para|paresse) de (?:me )?(?:te )?avis\w*|silenci\w*|deix\w* de (?:me )?avis\w*|chega de avis\w*)\b/;
const VOLTAR_A_AVISAR = /\b(?:volt\w* a (?:me )?(?:te )?avis\w*|relig\w*)\b/;
export function direcaoDoAvisoDita(silenciar: boolean, textoDoDono: string | null | undefined): boolean {
  const n = normalizarNome(textoDoDono);
  const parar = PARAR_DE_AVISAR.test(n);
  const voltar = VOLTAR_A_AVISAR.test(n);
  if (parar === voltar) return false;
  return silenciar ? parar : voltar;
}

/** Como desfazer, por função (só onde existe um jeito de verdade). Texto do SISTEMA. */
export function comoDesfazer(funcao: string, argumentos?: unknown, codigoDoGrupo?: string | null): string | null {
  const a = (argumentos && typeof argumentos === "object" ? argumentos : {}) as Record<string, unknown>;
  switch (funcao) {
    case "classificar_grupo": return codigoDoGrupo ? `se não for esse, me diga o cliente certo; para eu sair de lá, «grupo ${codigoDoGrupo} ignorar»` : "se não for esse, me diga o cliente certo";
    case "ignorar_grupo": return "para voltar, me peça para ligar o grupo de novo";
    case "ligar_resposta_grupo": return a.ligado === false ? "para voltar, me peça para ligar a resposta de novo" : null;
    case "criar_tarefa": return "para desfazer, cancele em Tarefas";
    case "guardar_memoria": return "para desfazer, me peça para esquecer";
    case "corrigir_memoria": return "para desfazer, me peça para corrigir de novo";
    case "esquecer_memoria": return "fica arquivada; para voltar, me peça para lembrar de novo";
    case "silenciar_aviso": return a.silenciar === false ? "para parar de novo, é só pedir" : "para voltar, é só pedir";
    default: return null;
  }
}

// ── Portão de segurança E11, 3ª rodada: regra ESTRUTURAL, que falha fechada ──

/** Teto do texto ditado depois do ":". */
export const MAX_DITADO_DEPOIS_DOS_DOIS_PONTOS = 200;

/**
 * (1) PORTA DE CARACTERES — LISTA PERMITIDA (nunca lista de bloqueio): depois de NFKC, só letras latinas do português (com acento),
 * dígitos, espaço comum e `. , ; : ! - / ( ) % $ @ + #`. Qualquer outro caractere — aspas de qualquer tipo, apóstrofo, crase, "?",
 * "¿", ">", "<", quebra de linha, emoji, outro alfabeto, invisível, NBSP, travessão, "：" e parecidos que sobrarem — tira a ordem
 * direta da mensagem inteira (vai para o "pode").
 */
const PERMITIDOS = /^[0-9A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç .,;:!\-/()%$@+#]*$/;
/** Espaços "parecidos" que o NFKC transformaria em espaço comum (NBSP, espaços tipográficos, ideográfico): barrados ANTES do NFKC. */
const ESPACOS_PARECIDOS = /[\u00A0\u1680\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF]/;
export function passaNaPortaDeCaracteres(mensagem: string | null | undefined): boolean {
  if (ESPACOS_PARECIDOS.test(String(mensagem ?? ""))) return false;
  const m = String(mensagem ?? "").normalize("NFKC");
  return m.trim().length > 0 && PERMITIDOS.test(m);
}

/** (3) Negação, por TOKEN ("ñ" vira "n"; "n", "naum", "num", "nada"…). Uma função só, usada pela produção (partesDaOrdem). */
const TOKENS_DE_NEGACAO = new Set(["nao", "n", "naum", "num", "nem", "nunca", "jamais", "nada"]);
export function temNegacao(texto: string | null | undefined): boolean {
  const n = normalizarNome(String(texto ?? "").replace(/ñ/gi, "n"));
  return n.split(" ").some(t => TOKENS_DE_NEGACAO.has(t)) || negaAcao(texto);
}

export type PartesDaOrdem = { mensagem: string; antes: string; depois: string | null };

/** Verbos de ação (a mesma ideia de `intencaoDeAcao`): depois de um "hh:mm" não pode vir pedido. */
const VERBO_DE_ACAO = /\b(?:cri\w*|anot\w*|registr\w*|lembr\w*|guard\w*|esquec\w*|corrig\w*|silenci\w*|avis\w*|vincul\w*|lig\w*|ignor\w*|aceit\w*|deslig\w*|classific\w*|defin\w*|marc\w*|agend\w*|coloc\w*|troc\w*|cobr\w*|prepar\w*|ger\w*|salv\w*)\b/;

/**
 * Separa a mensagem do dono (já pela porta de caracteres) em ANTES do ":" (verbo, função, código e alvos) e o DITADO depois dele (só
 * conteúdo de registro). null = sem ordem direta. (2) Só existe o ":" ASCII e TODOS contam: mais de um → null. Um único ":" entre dois
 * dígitos ("14:30") vale como texto comum se nada depois dele for verbo de ação; senão → null. (3) negação no trecho antes do ":"
 * (ou na mensagem inteira, sem ":") → null. Ditado vazio ou com mais de 200 caracteres → null.
 */
export function partesDaOrdem(mensagemBruta: string | null | undefined): PartesDaOrdem | null {
  if (!passaNaPortaDeCaracteres(mensagemBruta)) return null;
  // Portão 4 (M-2): o NFKC não pode mudar nada do que ele digitou ("10³", largura cheia, "ﬁ", "①"…); grava-se sempre o NFC
  if (String(mensagemBruta).normalize("NFC") !== String(mensagemBruta).normalize("NFKC")) return null;
  const mensagem = String(mensagemBruta).normalize("NFC").replace(/ +/g, " ").trim();
  const pos: number[] = [];
  for (let i = 0; i < mensagem.length; i++) if (mensagem[i] === ":") pos.push(i);
  if (pos.length > 1) return null;
  let antes = mensagem;
  let depois: string | null = null;
  if (pos.length === 1) {
    const i = pos[0];
    const hora = /\d/.test(mensagem[i - 1] ?? "") && /\d/.test(mensagem[i + 1] ?? "");
    if (hora) {
      if (VERBO_DE_ACAO.test(normalizarNome(mensagem.slice(i + 1)))) return null;
    } else {
      antes = mensagem.slice(0, i).trim();
      depois = mensagem.slice(i + 1).trim();
      if (!antes || !depois || depois.length > MAX_DITADO_DEPOIS_DOS_DOIS_PONTOS) return null;
    }
  }
  // Portão 4 (3): negação no trecho ANTES do ":" bloqueia; sem ":", só a da MOLDURA (antes do texto gravado) — conferida em
  // `textoPelaMoldura` / na prova; o que vem depois é conteúdo dele e fica. Negação antes do verbo sempre bloqueia (`funcaoDoPedido`).
  if (depois !== null && temNegacao(antes)) return null;
  return { mensagem, antes, depois };
}

/** Normalização da comparação do texto gravado: só caixa, espaços repetidos e pontuação nas pontas. */
const PONTAS = /^(?:[\s.,;:!]|-(?!\d))+|[\s.,;:!\-]+$/g;
/** Apara só pontuação solta nas pontas; "-500" mantém o sinal (portão 8, M-8d). */
export const apararPontas = (t: string) => t.replace(PONTAS, "");
const comparavel = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(PONTAS, "");

/**
 * (4) TEXTO GRAVADO = TEXTO DO DONO. Devolve o texto a gravar (sempre um pedaço do que ELE escreveu) ou null (→ confirmação).
 * - Com ditado: grava-se SEMPRE o ditado do dono, aparado; o texto do modelo é descartado (ajuste antes da 4ª revisão).
 * - Sem ":": o texto do modelo tem de ser um trecho CONTÍNUO da mensagem dele (mesma normalização; comparação caractere a caractere,
 *   começando e terminando em fronteira de palavra); grava-se o trecho do próprio dono.
 */
export function textoGravadoDoDono(textoDoModelo: string | null | undefined, partes: PartesDaOrdem): string | null {
  // Ajuste antes da 4ª revisão: com ditado, o texto gravado é SEMPRE o ditado do dono, aparado — o do modelo é descartado (resumo,
  // reescrita ou conteúdo injetado nunca chegam ao banco)
  if (partes.depois !== null) return partes.depois.replace(PONTAS, "") || null;
  const alvo = comparavel(String(textoDoModelo ?? ""));
  if (!alvo) return null;
  // mapa: posição na forma comparável → posição na mensagem (a mensagem já tem espaços simples e só caracteres permitidos)
  const m = partes.mensagem;
  const minus = m.toLowerCase();
  if (minus.length !== m.length) return null;
  const fronteira = (c: string | undefined) => c === undefined || /[\s.,;!]/.test(c);
  for (let i = minus.indexOf(alvo); i >= 0; i = minus.indexOf(alvo, i + 1)) {
    if (fronteira(minus[i - 1]) && fronteira(minus[i + alvo.length])) return m.slice(i, i + alvo.length);
  }
  return null;
}

/**
 * (5) PRAZO calculado pelo CÓDIGO: a data inequívoca da mensagem do dono ("hoje", "amanhã", "dd/mm", "dd/mm/aaaa", "dia dd" → o próximo
 * dia dd), como "AAAA-MM-DD" no horário de Imperatriz. Mais de uma data, ou nenhuma → null.
 */
const MARCADORES_DE_PRAZO = new Set(["ate", "para", "pra", "prazo", "vence", "vencimento"]);
const PASSADO = new Set(["fez", "pagou", "mandou", "enviou", "ligou", "deu", "recebeu", "assinou", "veio", "foi", "chegou", "fizeram", "pagaram", "mandaram", "falou", "disse", "entregou",
  // portão 6 (B-3): passados irregulares
  "trouxe", "quis", "soube", "teve", "esteve", "pos", "viu", "houve", "coube", "pode", "fiz", "pus", "tive", "estive", "fui", "dei", "vim", "vi", "era", "estava", "tinha", "ficou"]);
const ORACAO_ANTES_DA_DATA = new Set(["que", "se", "quando", "caso", "onde", "como", "porque"]);
const TERMINACAO_DE_PASSADO = /(?:ou|eu|iu|ei|aram|eram|iram)$/;
const NAO_SAO_PASSADO = new Set(["estou", "museu", "europeu", "pneu", "chapeu", "plebeu", "ateu"]);
const MESES_E_SEMANA = /\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|segunda|terca|quarta|quinta|sexta|sabado|domingo|que vem|proxim[oa]s?|semana|mes)\b/;
export function dataDitaPeloDono(mensagem: string, hojeIso: string): string | null {
  const n = normalizarNome(mensagem.replace(/\//g, " / "));
  // Portão 4 (M-1): nome de mês, dia da semana, "que vem", "próximo/a", "semana", "mês" → o código não decide a data
  if (MESES_E_SEMANA.test(n)) return null;
  const [ano, mes, dia] = hojeIso.split("-").map(Number);
  const iso = (a: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  const raw = String(mensagem).normalize("NFC");
  // Portão 5 (B-1): a data só é PRAZO com marcador colado antes ("até", "para/pra [o dia]", "prazo", "vence"), nunca depois de um verbo no
  // passado ("o João fez dia 10", "pagou 3/4"); data que não é prazo (sem marcador) → o código não decide (null)
  const antesDe = (i: number) => normalizarNome(raw.slice(Math.max(0, i - 40), i)).split(" ").filter(Boolean);
  // verbo no passado antes da data ("quitou hoje", "recebeu amanhã cedo", "saíram dia 10"): a lista E a terminação (ou/eu/iu/aram/eram/iram)
  const temPassado = (ps: readonly string[]) => ps.slice(-5).some(t => PASSADO.has(t) || (t.length >= 4 && TERMINACAO_DE_PASSADO.test(t) && !NAO_SAO_PASSADO.has(t)));
  const comMarcador = (ps: readonly string[]) => {
    let x = ps.length - 1;
    while (x >= 0 && (ps[x] === "o" || ps[x] === "dia" || ps[x] === "no")) x--;
    return x >= 0 && x >= ps.length - 3 && MARCADORES_DE_PRAZO.has(ps[x]);
  };
  /** Depois da data não vem mais nada — ou só a hora ("às 14h", "14:30") e cortesia. */
  const fechaOPedido = (fim: number) => normalizarNome(raw.slice(fim)).split(" ").filter(Boolean).every(t => /^(?:as|\d{1,2}h?|\d{1,2}h\d{2}|\d{2}|h|hs|horas|por|favor|sem|falta)$/.test(t));
  const achadas: Array<string | null> = [];
  // "\b" do JavaScript não vê letra acentuada ("amanhã" termina em "ã"): a fronteira é conferida pela classe de letras
  for (const x of Array.from(raw.matchAll(/(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ])(hoje|amanh[aã])(?![0-9A-Za-zÀ-ÖØ-öø-ÿ])/gi))) {
    const ps = antesDe(x.index ?? 0);
    if (temPassado(ps)) return null;
    // Portão 7 (M-1): "hoje"/"amanhã" só é prazo com marcador colado antes ("até amanhã", "para hoje") ou FECHANDO o pedido (só com o
    // período/hora depois: "amanhã cedo", "hoje às 14h") e fora de oração ("a reunião de amanhã", "que chega amanhã", "se chover hoje")
    const marcado = ps.length > 0 && MARCADORES_DE_PRAZO.has(ps[ps.length - 1]);
    const emOracao = ps.slice(-6).some(t => ORACAO_ANTES_DA_DATA.has(t)) || ["de", "do", "da"].includes(ps[ps.length - 1] ?? "");
    const depois = normalizarNome(raw.slice((x.index ?? 0) + x[0].length)).split(" ").filter(Boolean);
    const fecha = depois.every(t => /^(?:cedo|manha|tarde|noite|de|a|pela|as|\d{1,2}h?|\d{1,2}h\d{2}|\d{2}|h|hs|horas|por|favor|sem|falta|mesmo)$/.test(t));
    // portão 8 (M-8c): dentro de oração ("ver se o João entrega para hoje") o marcador não salva
    if (emOracao || (!marcado && !fecha)) return null;
    achadas.push(/^hoje$/i.test(x[1]) ? hojeIso : iso(ano, mes, dia + 1) ?? new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10));
  }
  const usadas = new Set<number>();
  for (const x of Array.from(raw.matchAll(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/gi))) {
    const ps = antesDe(x.index ?? 0);
    if (temPassado(ps) || !comMarcador(x[0].toLowerCase().startsWith("dia") ? [...ps, "dia"] : ps)) return null;
    if (ps.slice(-6).some(t => ORACAO_ANTES_DA_DATA.has(t))) return null; // portão 8 (M-8c): "perguntar se o João paga até 10/12"
    usadas.add(x.index ?? 0);
    // Portão 6 (M-2): "2/3 do telhado", "1/2 salário" é fração, não data — a data de prazo FECHA o pedido (ou vem seguida da hora)
    if (!fechaOPedido((x.index ?? 0) + x[0].length)) return null;
    const d = Number(x[1]); const m = Number(x[2]);
    let a = x[3] ? Number(x[3].length === 2 ? `20${x[3]}` : x[3]) : ano;
    let r = iso(a, m, d);
    if (r && !x[3] && r < hojeIso) { a += 1; r = iso(a, m, d); }
    achadas.push(r);
  }
  for (const x of Array.from(raw.matchAll(/\bdia\s+(\d{1,2})\b(?!\s*\/)/gi))) {
    if (usadas.has(x.index ?? 0)) continue;
    const ps = antesDe(x.index ?? 0);
    if (temPassado(ps) || !comMarcador([...ps, "dia"])) return null;
    if (ps.slice(-6).some(t => ORACAO_ANTES_DA_DATA.has(t))) return null;
    if (!fechaOPedido((x.index ?? 0) + x[0].length)) return null;
    const d = Number(x[1]);
    let r = d >= dia ? iso(ano, mes, d) : null;
    if (!r) r = mes === 12 ? iso(ano + 1, 1, d) : iso(ano, mes + 1, d);
    achadas.push(r);
  }
  const unicas = Array.from(new Set(achadas));
  return unicas.length === 1 && unicas[0] ? unicas[0] : null;
}

/** Hora escrita pelo dono ("14:30", "14h", "14h30") como "HH:MM"; mais de uma, ou nenhuma → null. */
export function horaDitaPeloDono(mensagem: string): string | null {
  const achadas = Array.from(String(mensagem).normalize("NFKC").matchAll(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)\b/g)).map(x => {
    const h = Number(x[1]); const mm = Number(x[2] ?? x[3] ?? 0);
    return h <= 23 && mm <= 59 ? `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : null;
  });
  const unicas = Array.from(new Set(achadas));
  return unicas.length === 1 && unicas[0] ? unicas[0] : null;
}

/**
 * Prazo do modelo confere com o que o CÓDIGO tirou da mensagem? Sem prazo do modelo → sim (cria sem prazo). Com prazo: o dia tem de ser
 * a data inequívoca da mensagem e, com hora no prazo, a hora tem de ser a que ele escreveu.
 */
export function prazoConfere(prazoDoModelo: unknown, mensagem: string, hojeIso: string): boolean {
  if (prazoDoModelo === undefined || prazoDoModelo === null || prazoDoModelo === "") return true;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(String(prazoDoModelo));
  if (!m) return false;
  if (dataDitaPeloDono(mensagem, hojeIso) !== m[1]) return false;
  // Portão 12 (concern 4): se ele escreveu uma hora ("amanhã às 9h"), o prazo tem de trazer ESSA hora — nunca cair nas 18:00 em silêncio
  const temHora = /\b\d{1,2}(?::\d{2}|h(?:\d{2})?)\b/.test(String(mensagem).normalize("NFKC"));
  // Portão 13 (c4): hora escrita por extenso ou turno ("às 9", "9 horas", "de manhã", "à tarde") → o código não sabe a hora: confirmação
  if (/\bas \d{1,2}\b|\b\d{1,2} horas?\b|\bmeio dia\b|\b(?:de|pela|a|na) (?:manha|tarde|noite)\b/.test(normalizarNome(mensagem)) && !horaDitaPeloDono(mensagem)) return false;
  return m[2] || temHora ? horaDitaPeloDono(mensagem) === m[2] : true;
}

/** Prioridade direta: só "média" (padrão) ou "alta" com "urgente" e nenhuma negação em parte alguma da mensagem. */
export function prioridadeConfere(prioridade: unknown, mensagem: string): boolean {
  if (prioridade === undefined || prioridade === null || prioridade === "media") return true;
  if (prioridade !== "alta") return false;
  const ts = normalizarNome(String(mensagem).replace(/ñ/gi, "n")).split(" ").filter(Boolean);
  if (ts.some(t => TOKENS_DE_NEGACAO.has(t))) return false;
  // Portão 6 (B-1): "urgente" uma vez só e em POSIÇÃO de prioridade — "tarefa urgente", ou fechando a mensagem depois de "é"/"muito".
  // "longe de ser urgente", "zero urgente", "urgente nenhum", "pouco urgente" não passam
  const onde = ts.flatMap((t, i) => (t === "urgente" ? [i] : []));
  if (onde.length !== 1) return false;
  const i = onde[0];
  if (ts[i - 1] === "tarefa" || ts[i - 1] === "tarefas") return true;
  // Portão 7 (M-2): no fim, só como aposto depois de pausa — "…, é urgente", "…; urgente", "…. É muito urgente". Dentro da frase
  // ("ver se o pedido do João é urgente") é conteúdo
  return i === ts.length - 1 && /[,.;!]\s*(?:[ée]\s+)?(?:muito\s+)?urgente[\s.!]*$/i.test(String(mensagem));
}

// ── Portão de segurança E11, 4ª rodada: FUNÇÃO e TEXTO pelo CÓDIGO (a chamada do modelo é só o gatilho e tem de coincidir) ──

const VOCATIVOS_DE_UMA = new Set(["dolores", "oi", "ola", "ei", "vamos"]);
const VOCATIVOS_DE_DUAS = new Set(["por favor", "bom dia", "boa tarde", "boa noite"]);

export type Token = { n: string; inicio: number; fim: number };
/**
 * Portão 5 (I-1) — a tokenização ÚNICA do pedido (usada por `funcaoDoPedido`, pela moldura e pelo texto): palavras pelo MESMO limite do
 * `normalizarNome` (sequências de letras/dígitos; vírgula, ponto, ";" colados separam), cada uma com a posição no texto cru.
 */
export function tokensDoPedido(mensagem: string | null | undefined): Token[] {
  const m = String(mensagem ?? "");
  const r: Token[] = [];
  for (const x of Array.from(m.matchAll(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+/g))) {
    const n = normalizarNome(x[0].replace(/ñ/gi, "n"));
    if (!n) continue;
    // um pedaço cru pode virar mais de uma palavra normalizada só em casos fora da porta; aqui fica uma palavra por pedaço
    r.push({ n: n.split(" ")[0], inicio: x.index ?? 0, fim: (x.index ?? 0) + x[0].length });
  }
  return r;
}

/** Quantos tokens de vocativo/cortesia curto abrem o pedido ("dolores", "por favor", "oi", "bom dia"…) — no máximo 3. */
function tokensDeVocativo(ts: readonly string[]): number {
  let j = 0;
  while (j < ts.length && j < 3) {
    if (VOCATIVOS_DE_UMA.has(ts[j])) { j++; continue; }
    if (j + 1 < ts.length && VOCATIVOS_DE_DUAS.has(`${ts[j]} ${ts[j + 1]}`)) { j += 2; continue; }
    break;
  }
  return j;
}

/** Portão 5 (I-3): logo depois do verbo de grupo vem "grupo(s)" ou o código do grupo (aceitando artigo/demonstrativo). */
const ANTES_DE_GRUPO = new Set(["o", "a", "os", "as", "esse", "essa", "este", "esta", "aquele", "aquela", "meu", "nosso"]);
const CODIGO_DE_GRUPO_NO_TEXTO = /^[acdefghjkmnprtuvwxy234679]{4}$/;
const DA_RESPOSTA = new Set(["resposta", "respostas", "responder", "de", "do", "da", "no", "na", "em"]);
function grupoLogoDepois(ts: readonly string[], j: number, tambem?: ReadonlySet<string>): boolean {
  let x = j + 1;
  while (x < ts.length && x <= j + (tambem ? 5 : 2) && (ANTES_DE_GRUPO.has(ts[x]) || tambem?.has(ts[x]))) x++;
  return x < ts.length && (ts[x] === "grupo" || ts[x] === "grupos" || (CODIGO_DE_GRUPO_NO_TEXTO.test(ts[x]) && /\d|[^aeiou]{4}/.test(ts[x])));
}

/**
 * (1) A função da ORDEM DIRETA é a do PRIMEIRO verbo do pedido (o imperativo que o abre, depois de no máximo um vocativo/cortesia
 * curto), no trecho antes do ":". Famílias SEPARADAS. null = o pedido não abre com um verbo da lista (→ confirmação de sempre). A
 * chamada do modelo tem de ser desta função; outra função → confirmação. Verbos de outras famílias DEPOIS do primeiro são conteúdo.
 * Portão 5 (I-3): função de GRUPO só com "grupo"/o código logo depois do verbo ("liga pra Emily…" não é grupo).
 */
export function funcaoDoPedido(antes: string | null | undefined): string | null {
  const ts = tokensDoPedido(antes).map(t => t.n);
  const j = tokensDeVocativo(ts);
  const v = ts[j];
  if (!v) return null;
  const resto = ts.slice(j + 1);
  const temLembranca = resto.some(t => t === "lembranca" || t === "lembrancas" || t === "memoria");
  const frase = ts.slice(j).join(" ");
  if (/^(?:para|pare|parar|deixa|deixe|chega) de (?:me |te )?avis/.test(frase) || /^silenci/.test(v) || /^(?:volta|volte|voltar) a (?:me |te )?avis/.test(frase) || /^relig/.test(v)) return "silenciar_aviso";
  if (/^(?:cri(?:a|e|ar)|abr(?:e|a|ir))$/.test(v)) return resto.slice(0, 3).some(t => t === "tarefa" || t === "tarefas") ? "criar_tarefa" : null;
  if (/^(?:anot(?:a|e|ar)|registr(?:a|e|ar))$/.test(v)) return "registrar_acompanhamento";
  // Portão 6 (M-3): guardar lembrança só com "que" logo depois do verbo (ou só o verbo, com o texto ditado depois de ":") —
  // "lembra a Bianca de ligar pro João" é um recado para alguém, não uma lembrança
  if (/^(?:lembr(?:a|e|ar)|guard(?:a|e|ar)|memoriz(?:a|e|ar)|grav(?:a|e|ar))$/.test(v)) {
    const proxima = resto[0] === "ai" ? resto[1] : resto[0];
    const fechaComIsso = (proxima === "disso" || proxima === "isso") && resto.length === (resto[0] === "ai" ? 2 : 1); // "lembra disso: …"
    return proxima === undefined || proxima === "que" || fechaComIsso ? "guardar_memoria" : null;
  }
  if (/^esquec(?:e|a|er)$/.test(v)) return "esquecer_memoria";
  if (/^(?:apag(?:a|ue|ar)|remov(?:e|a|er)|tir(?:a|e|ar))$/.test(v)) return temLembranca ? "esquecer_memoria" : null;
  if (/^(?:corrig(?:e|ir)|corrija)$/.test(v)) return "corrigir_memoria";
  if (/^atualiz(?:a|e|ar)$/.test(v)) return temLembranca ? "corrigir_memoria" : null;
  const grupo = grupoLogoDepois(ts, j);
  if (/^(?:vincul\w*|lig(?:a|ue|ar)|classific\w*|defin(?:a|e|ir)|coloc(?:a|ar)|coloque|marc(?:a|ar)|marque|troc(?:a|ar)|troque|associ\w*|junt(?:a|ar))$/.test(v)) return grupo ? "classificar_grupo" : null;
  if (/^(?:ignor\w*|desativ\w*)$/.test(v) || /^deix\w* de lado/.test(frase)) return grupo || /^deix\w* de lado (?:o |a )?grupo/.test(frase) ? "ignorar_grupo" : null;
  if (/^aceit\w*$/.test(v)) return grupo ? "aceitar_grupo" : null;
  // desligar a resposta: "grupo"/o código logo depois do verbo, aceitando só "a resposta do/no", "de responder no" no meio
  if (/^(?:deslig\w*|cal(?:a|e|ar))$/.test(v) || /^par\w* de respond/.test(frase)) return grupoLogoDepois(ts, j, DA_RESPOSTA) ? "ligar_resposta_grupo" : null;
  return null;
}

/**
 * (2) A moldura do pedido — portão 6 (I-1): GRAMÁTICA fechada, não uma lista de palavras soltas. Artigo/preposição (`PONTE`) só sai
 * quando leva, em seguida, a "tarefa" (pedido de tarefa) ou a um NOME provado; sozinho, é conteúdo e fica ("a não ser que…", "a menos
 * que…", "a partir de…", "de jeito nenhum…", "no máximo…" ficam inteiros).
 */
export const PONTE: ReadonlySet<string> = new Set(["a", "o", "as", "os", "um", "uma", "para", "pra", "pro", "ao", "na", "no", "da", "do", "de"]);
const ARTIGOS = new Set(["a", "o", "as", "os", "um", "uma"]);
const VERBO_DE_TAREFA = /^(?:cri(?:a|e|ar)|abr(?:e|a|ir))$/;
/** Portão 5 (I-1): palavra RESTRITIVA logo depois do verbo/nome NUNCA é moldura — é o começo do texto gravado. */
export const RESTRITIVAS: ReadonlySet<string> = new Set(["sem", "so", "nao", "nem", "nunca", "jamais", "exceto", "salvo", "apenas", "somente", "se", "caso", "quando", "depois", "antes", "n", "naum", "num", "nada"]);
/**
 * Referência ao que NÃO está na mensagem → confirmação. Portão 5 (usabilidade): o dêitico só conta seguido de um substantivo de pedido
 * ("aquela tarefa", "essa lembrança", "a outra tarefa") ou sozinho no fim ("conferir isso", "ver aquilo"). "está", "este", "mesmo" saíram.
 */
const DEITICOS = new Set(["aquela", "aquele", "aquelas", "aqueles", "essa", "esse", "essas", "esses", "outra", "outro", "outras", "outros", "dita"]);
const DEITICOS_SOZINHOS = new Set(["isso", "aquilo", "isto"]);
const SUBSTANTIVOS_DE_PEDIDO = new Set(["tarefa", "tarefas", "lembranca", "lembrancas", "memoria", "anotacao", "coisa", "coisas", "assunto", "item", "pedido", "grupo", "caso", "historia"]);
export function temDeitico(palavras: readonly string[]): boolean {
  return palavras.some((p, i) => (DEITICOS.has(p) && (SUBSTANTIVOS_DE_PEDIDO.has(palavras[i + 1] ?? "") || (DEITICOS.has(palavras[i + 1] ?? "") && SUBSTANTIVOS_DE_PEDIDO.has(palavras[i + 2] ?? ""))))
    || (DEITICOS_SOZINHOS.has(p) && i === palavras.length - 1));
}
export const MIN_PALAVRAS_TEXTO_DA_MOLDURA = 2;

export type TextoDaMoldura = { texto: string; moldura: string; tokensDaMoldura: string[] } | null;

/**
 * (2) TEXTO PELO CÓDIGO, sem ":": o que sobra da mensagem, ATÉ O FIM, depois de tirada a MOLDURA inicial, que é SÓ isto, nesta ordem:
 *   vocativo curto · o verbo da função · "aí" · [ponte + "tarefa(s)" + "urgente"] (só em pedido de tarefa) · [ponte + NOME provado]
 *   (cada nome uma vez, começando pelo primeiro nome da pessoa) · "que".
 * `ponte` = até 3 artigos/preposições (`PONTE`) que LEVAM a "tarefa" ou a um nome provado; sem isso, a ponte é conteúdo e o texto
 * começa nela. Depois de "que" o texto começa na palavra seguinte (o artigo fica). Palavra RESTRITIVA ("sem", "só", "se"…) nunca é
 * moldura. Vazio, menos de 2 palavras, dêitico de pedido ou "tarefa que…" → null (confirmação). A moldura tirada é conferida: a
 * sequência normalizada dela tem de ser EXATAMENTE a dos tokens consumidos, senão null.
 */
/** Depois do token `k-1` e antes do token `k` (ou do fim) há pontuação de pausa (vírgula, ponto, ";", "!", ":")? */
function pausaDepois(mensagem: string, toks: readonly Token[], k: number): boolean {
  return /[,.;!:]/.test(mensagem.slice(toks[k - 1].fim, k < toks.length ? toks[k].inicio : mensagem.length));
}

/**
 * Consome a MOLDURA do começo do pedido e devolve quantos tokens ela tem (a gramática está descrita em `textoPelaMoldura`).
 * Portão 7 (B-1): do nome provado sai o PRIMEIRO nome; os seguintes só saem quando ele os escreveu com inicial maiúscula ou quando o
 * nome inteiro vem seguido de "que", de pausa ou do fim ("anota na Ana em dia com o pagamento" não perde o "em dia").
 */
function consumirMoldura(mensagem: string, toks: readonly Token[], nomesProvados: ReadonlyArray<readonly string[]>): { k: number; tarefaQue: boolean } {
  let k = tokensDeVocativo(toks.map(t => t.n));
  if (k >= toks.length) return { k, tarefaQue: false };
  const pedidoDeTarefa = VERBO_DE_TAREFA.test(toks[k].n);
  k++; // o verbo da função
  if (toks[k]?.n === "ai") k++;
  let tarefaVista = false;
  const usados = new Set<number>();
  while (k < toks.length) {
    const n = toks[k].n;
    if (RESTRITIVAS.has(n)) break;
    if (n === "que") {
      // "tarefa que o cliente pediu…" (oração relativa sobre a tarefa) aponta para algo fora da mensagem → confirmação
      if (/^tarefas?$/.test(toks[k - 1].n)) return { k, tarefaQue: true };
      k++;
      break;
    }
    let x = k;
    while (x < toks.length && x < k + 3 && PONTE.has(toks[x].n)) x++;
    if (x >= toks.length) break;
    const alvo = toks[x].n;
    if (pedidoDeTarefa && !tarefaVista && (alvo === "tarefa" || alvo === "tarefas")) {
      tarefaVista = true;
      k = x + 1;
      if (toks[k]?.n === "urgente") k++;
      continue;
    }
    const iNome = nomesProvados.findIndex((p, i) => !usados.has(i) && p.length > 0 && p[0] === alvo && alvo.length >= 3);
    if (iNome < 0) break;
    usados.add(iNome);
    const nome = nomesProvados[iNome];
    k = x + 1; // o primeiro nome
    let fim = k;
    for (let y = 1; fim < toks.length && y < nome.length && toks[fim].n === nome[y]; y++) fim++;
    if (fim > k) {
      const comMaiuscula = toks.slice(k, fim).every(t => /^[A-ZÀ-ÖØ-Þ]/.test(mensagem.slice(t.inicio, t.fim)));
      const fechaONome = fim >= toks.length || toks[fim].n === "que" || pausaDepois(mensagem, toks, fim);
      if (comMaiuscula || fechaONome) k = fim;
    }
  }
  return { k, tarefaQue: false };
}

/**
 * Portão 7 (I-1) — com texto ditado depois de ":", o trecho ANTES do ":" tem de ser SÓ moldura: vocativo, verbo, "aí", [ponte + tarefa],
 * [ponte + nome provado], "que" e, no fim, "disso"/"isso"/"o seguinte". Sobrou qualquer palavra ("se a Emily atrasar", "caso ela
 * ligue", "o boato de que") → false (confirmação): o que ele escreveu antes do ":" nunca é jogado fora em silêncio.
 */
export const FECHO_DO_DITADO: ReadonlySet<string> = new Set(["disso", "isso", "seguinte", "assim"]);
export function molduraInteira(antes: string, nomesProvados: ReadonlyArray<readonly string[]> = []): boolean {
  const toks = tokensDoPedido(antes);
  const { k, tarefaQue } = consumirMoldura(antes, toks, nomesProvados);
  if (tarefaQue) return false;
  let fim = k;
  if (toks[fim]?.n === "o" && toks[fim + 1]?.n === "seguinte") fim++;
  if (fim < toks.length && FECHO_DO_DITADO.has(toks[fim].n)) fim++;
  return fim >= toks.length;
}

export function textoPelaMoldura(mensagem: string, nomesProvados: ReadonlyArray<readonly string[]> = []): TextoDaMoldura {
  const toks = tokensDoPedido(mensagem);
  const { k, tarefaQue } = consumirMoldura(mensagem, toks, nomesProvados);
  if (tarefaQue || k >= toks.length) return null;
  const inicio = toks[k].inicio;
  const moldura = mensagem.slice(0, inicio);
  const tokensDaMoldura = toks.slice(0, k).map(t => t.n);
  // invariante: o que foi tirado é exatamente a moldura consumida (nada de conteúdo engolido por pontuação colada)
  if (normalizarNome(moldura) !== tokensDaMoldura.join(" ") || tokensDaMoldura.some(t => RESTRITIVAS.has(t))) return null;
  const texto = mensagem.slice(inicio).trim().replace(/^[\s.,;:!\-]+|[\s.,;:!\-]+$/g, "");
  const palavras = tokensDoPedido(texto).map(t => t.n);
  if (palavras.length < MIN_PALAVRAS_TEXTO_DA_MOLDURA || temDeitico(palavras)) return null;
  return { texto, moldura, tokensDaMoldura };
}

/** "tarefa(s) urgente" na moldura do pedido: a prioridade ALTA é do código (portão 8, I-8a — o "urgente" tirado do título não some). */
export function tarefaUrgenteNaMoldura(antes: string | null | undefined): boolean {
  const ts = tokensDoPedido(antes).map(t => t.n);
  return ts.some((t, i) => t === "urgente" && (ts[i - 1] === "tarefa" || ts[i - 1] === "tarefas"));
}

/**
 * Portão 6 (M-1): palavras de CONDIÇÃO ou de TEMPO. Numa ordem que não grava texto (grupo, aviso), qualquer uma delas depois do verbo
 * tira a ordem direta — "vincula o grupo da Emily só se ela assinar", "ignora o grupo … depois que a obra terminar", "… até segunda".
 */
export const CONDICAO_OU_TEMPO: ReadonlySet<string> = new Set([...Array.from(RESTRITIVAS), "ate", "enquanto", "desde", "durante", "apos", "amanha", "hoje", "dia", "dias",
  "semana", "mes", "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo", "hora", "horas", "minuto", "minutos", "mas", "porem", "menos", "talvez", "ainda"]);
/** As palavras do pedido depois do vocativo e do verbo que o abre (portão 6: conferência por LISTA PERMITIDA nas ordens sem texto). */
export function palavrasDepoisDoVerbo(antes: string | null | undefined): string[] {
  const ts = tokensDoPedido(antes).map(t => t.n);
  return ts.slice(tokensDeVocativo(ts) + 1);
}
/**
 * Portão 9 (I-9a/b/c): palavras da MOLDURA fixa do pedido — vocativo, cortesia e o vocabulário da própria ordem. Nunca apontam cliente,
 * obra, grupo nem responsável, mesmo que alguém do cadastro tenha uma delas no nome ("DOLORES RIBEIRO", "Residencial Boa Vista").
 */
const MOLDURA_FIXA: ReadonlySet<string> = new Set(["dolores", "ola", "vamos", "favor", "bom", "boa", "dia", "tarde", "noite", "tarefa", "tarefas", "urgente",
  "anotacao", "anotacoes", "nota", "historico", "acompanhamento", "registro", "ligacao", "aviso", "avisos", "resposta", "respostas", "agora"]);
/**
 * Portão 9: as palavras do pedido que PODEM apontar um alvo — só as que vêm DEPOIS do vocativo e do verbo que abre o pedido, com 3+
 * letras, fora das genéricas e da moldura fixa. O vocativo ("Dolores, …"), a saudação ("Boa tarde, …") e o verbo nunca escolhem ninguém.
 */
export function palavrasDoAlvo(antes: string | null | undefined, ligacao: ReadonlyArray<ReadonlySet<string>> = []): string[] {
  // Portão 10 (A1–A3): palavra que a LISTA PERMITIDA do pedido aceita como ligação ("por", "como", "engenharia", "seguinte"…) nunca
  // prova alvo — quem chama passa as listas permitidas do próprio pedido, em vez de depender de lembrar cada palavra aqui
  return palavrasDepoisDoVerbo(antes).filter(p => p.length >= 3 && !PALAVRAS_GENERICAS.has(p) && !MOLDURA_FIXA.has(p) && !ligacao.some(l => l.has(p)));
}
/**
 * Portão 6 (M-1), regra ESTRUTURAL: numa ordem que não grava texto, depois do verbo só pode haver palavra de ligação desta lista, o
 * nome/código do alvo (quem chama passa) e número. Qualquer outra palavra ("assim que ela assinar", "provisoriamente", "mais tarde")
 * → confirmação. Lista permitida, nunca lista de bloqueio.
 */
export const LIGACAO_DE_GRUPO: ReadonlySet<string> = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das", "no", "na", "em", "como",
  "grupo", "cliente", "obra", "pos", "venda", "atendimento", "engenharia", "esse", "essa", "este", "esta", "ai", "la",
  "agora", "ja", "por", "favor", "lado", "resposta", "respostas", "responder", "dela", "dele"]);
// Opção A (24/11/2026): UM alvo por ordem. Fora da lista: verbos (portão 7, I-3), "e", "com", "para/pra/pro", "ao", "também", "grupos"
// (portão 8, I-8b — "vincula o grupo da Emily à Maria Dayane", "…com a Maria Dayane" traziam um segundo nome). Segundo alvo → confirmação.
export const LIGACAO_DE_AVISO: ReadonlySet<string> = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das", "me", "te", "em", "com", "e", "sobre", "avisar", "avisa", "avise",
  "aviso", "avisos", "agora", "ja", "por", "favor", "tipo", "esse", "essa", "esses", "essas"]);
export function soPalavrasPermitidas(antes: string | null | undefined, ligacao: ReadonlySet<string>, doAlvo: Iterable<string>): boolean {
  const alvo = new Set(doAlvo);
  return palavrasDepoisDoVerbo(antes).every(t => ligacao.has(t) || alvo.has(t) || /^\d+$/.test(t));
}
export function temCondicaoOuTempo(antes: string | null | undefined): boolean {
  const ts = tokensDoPedido(antes).map(t => t.n);
  return ts.slice(tokensDeVocativo(ts) + 1).some(t => CONDICAO_OU_TEMPO.has(t));
}

/**
 * Os tokens de um texto, NA ORDEM e com repetição, sem os artigos — comparação de lembrança. Portão 6 (I-2): "sem", "com", "só", "não"
 * contam. Portão 7 (I-2): a ordem conta ("Emily paga o Pedro" ≠ "Pedro paga a Emily"; "20 de entrada e 10 por mês" ≠ "10 de entrada e 20…").
 * A crase conta como artigo ("à tarde" = "a tarde").
 */
export function tokensSemArtigo(texto: string | null | undefined): string[] {
  return tokensDoPedido(texto).map(t => t.n).filter(t => !ARTIGOS.has(t));
}
export function mesmaSequencia(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}
