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
    case "criar_tarefa": case "registrar_acompanhamento": case "guardar_memoria": case "corrigir_memoria": case "esquecer_memoria": return true;
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
  if (tipo === "engenharia") return /\bengenhar/.test(n);
  if (tipo === "pos_atendimento") return /\bpos\b|\bposvenda\b|\bpos atendimento\b/.test(n);
  return tipo === "cliente";
}

// ── Confirmação nomeada: "o grupo da Emily pode", "pode o da Maria Dayane", "pode todos" ──

export const MAX_CARACTERES_CONFIRMACAO_NOMEADA = 80;
const AFIRMA = new Set(["pode", "sim", "ok", "confirmo", "faz", "faca", "manda"]);
/** Palavras que só ligam a frase ("o grupo da …") — saem da referência. */
const LIGACAO = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das", "e", "grupo", "grupos", "isso", "esse", "essa", "tambem", "ai", "la", "eu", "ja"]);
const VERBO_NOVO = /\b(?:cri(?:e|ar|a)|registr\w*|anot\w*|apag\w*|exclu\w*|mand(?:ar|e)|envi\w*|cobr\w*|emit\w*|cancel\w*|pag(?:ar|a|ue)|transfer\w*|ger(?:e|ar)|prepar\w*)\b/;

export type ConfirmacaoNomeada = { tipo: "sim" | "confirmo"; todos: boolean; referencia: string[] };

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
  if (ps.length < 2) return null;
  const primeira = ps[0];
  const ultima = ps[ps.length - 1];
  const fim = AFIRMA.has(ultima) && !(ps.length >= 2 && ps[ps.length - 2] === "nao");
  const inicio = AFIRMA.has(primeira);
  if (!fim && !inicio) return null;
  if (ps.includes("nao")) return null;
  const confirmo = ps.includes("confirmo");
  const resto = (fim ? ps.slice(0, -1) : ps.slice(1)).filter(p => !AFIRMA.has(p) && !LIGACAO.has(p) && p !== "sim");
  if (!resto.length || resto.length > 6) return null;
  const todos = resto.every(p => p === "todos" || p === "todas" || p === "tudo");
  if (todos) return { tipo: confirmo ? "confirmo" : "sim", todos: true, referencia: [] };
  const referencia = resto.filter(p => (p.length >= 3 && !PALAVRAS_GENERICAS.has(p)) || (/^[a-z0-9]{4}$/.test(p) && /\d/.test(p)));
  if (!referencia.length) return null;
  return { tipo: confirmo ? "confirmo" : "sim", todos: false, referencia };
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

/** Negação explícita (palavra inteira, normalizada). */
const NEGACAO_SOLTA = /\b(?:nao|nem|nunca|jamais)\b/;

/**
 * Portão de segurança E11, 2ª rodada (I-A) — o texto que será GRAVADO (título, descrição, anotação, lembrança, correção) saiu das
 * palavras do dono? Regra simples e estrita: TODA palavra do texto (normalizada; inclusive as curtas, os números — exatos — e a
 * "moldura") está na mensagem dele, NA MESMA ORDEM (subsequência). "pagar o boleto de 300" nunca vira "Não pagar boleto 900";
 * "prefere contato à tarde" nunca vira "não prefere… nunca". Negação no texto que ele não escreveu → não saiu dele.
 */
export function textoSaiuDoDono(texto: string | null | undefined, textoDoDono: string): boolean {
  const t = normalizarNome(texto).split(" ").filter(Boolean);
  if (!t.length) return true;
  const d = normalizarNome(textoDoDono).split(" ").filter(Boolean);
  if (t.some(p => NEGACAO_SOLTA.test(p)) && !d.some(p => NEGACAO_SOLTA.test(p))) return false;
  let i = 0;
  for (const p of d) if (i < t.length && p === t[i]) i++;
  return i === t.length;
}

/**
 * Portão de segurança E11, 2ª rodada (M-A) — a mensagem não serve de ORDEM DIRETA quando é pergunta ("?" em qualquer ponto) ou tem
 * negação em qualquer posição ("não/nem/nunca/jamais"), além da negação antes do verbo ("sem criar…", `negaAcao`). Vai para a
 * confirmação de sempre. Errar para o lado de perguntar é o combinado.
 */
export function bloqueiaOrdemDireta(textoDoDono: string | null | undefined): boolean {
  const bruto = String(textoDoDono ?? "");
  return bruto.includes("?") || NEGACAO_SOLTA.test(normalizarNome(bruto)) || negaAcao(bruto);
}

/** B-a: prazo só se ele disse quando (dia, data, hora); prioridade diferente de "média" só se ele disse. */
export function prazoDitoPeloDono(textoDoDono: string | null | undefined): boolean {
  return /\b(?:hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana|mes|dia \d{1,2}|ate \d{1,2}|\d{1,2} \d{1,2}(?: \d{2,4})?|\d{1,2}h|\d{1,2} horas?)\b/
    .test(normalizarNome(String(textoDoDono ?? "").replace(/[/:]/g, " ")));
}
export function prioridadeDitaPeloDono(prioridade: unknown, textoDoDono: string | null | undefined): boolean {
  if (prioridade === undefined || prioridade === null || prioridade === "media") return true;
  const n = normalizarNome(textoDoDono);
  if (prioridade === "alta" || prioridade === "critica") return /\b(?:urgent\w*|prioridade alta|alta prioridade|critic\w*|importante)\b/.test(n);
  if (prioridade === "baixa") return /\b(?:sem pressa|baixa prioridade|prioridade baixa)\b/.test(n);
  return false;
}

/** silenciar_aviso: a direção (parar / voltar) bate com o que ele escreveu. */
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

/** Teto do texto ditado depois do ":". */
export const MAX_DITADO_DEPOIS_DOS_DOIS_PONTOS = 200;
/** Aspas de qualquer tipo (inclusive apóstrofo e crase). */
const ASPAS = /["'`“”‘’«»„‟]/;

export type PartesDaOrdem = { antes: string; depois: string | null };

/**
 * E11 (ajuste antes da 3ª revisão) — separa a mensagem do dono em ANTES do ":" (verbo, função, código e alvos) e o texto DITADO depois
 * dele (só conteúdo de registro). null = a mensagem não serve de ordem direta: aspas de qualquer tipo, ">", quebra de linha, mais de
 * um ":" (o de hora "14:30" e o de "http://" não contam), ditado com mais de 200 caracteres, "?" em qualquer ponto, ou negação ANTES do
 * ":" (M-A). Negação DEPOIS do ":" é conteúdo ditado (o texto gravado precisa reproduzi-la igual — `textoSaiuDoDono`).
 */
export function partesDaOrdem(mensagem: string | null | undefined): PartesDaOrdem | null {
  const m = String(mensagem ?? "").trim();
  if (!m || ASPAS.test(m) || m.includes(">") || /[\r\n]/.test(m) || m.includes("?")) return null;
  // ":" que contam: nem o de hora (dígito:dígito) nem o de "://"
  const pos: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== ":") continue;
    if (/\d/.test(m[i - 1] ?? "") && /\d/.test(m[i + 1] ?? "")) continue;
    if (m.slice(i, i + 3) === "://") continue;
    pos.push(i);
  }
  if (pos.length > 1) return null;
  const antes = (pos.length ? m.slice(0, pos[0]) : m).trim();
  const depois = pos.length ? m.slice(pos[0] + 1).trim() : null;
  if (!antes || (depois !== null && (!depois || depois.length > MAX_DITADO_DEPOIS_DOS_DOIS_PONTOS))) return null;
  if (NEGACAO_SOLTA.test(normalizarNome(antes)) || negaAcao(antes)) return null;
  return { antes, depois };
}
