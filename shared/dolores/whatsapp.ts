// EPIC-025 (Dolores, etapa 2) — regras puras do WhatsApp da Dolores: quem é o dono (número normalizado), leitura do
// aviso da Evolution (grupo, própria, antiga, @lid), frases fixas de bloqueio (nunca resposta fingida de IA), limite
// mensal e corte da resposta. Sem banco nem rede.
import { chaveTelefone } from "../whatsapp/conversas.js";
import { mascararTelefone } from "./formato.js";
import { AVISO_REURB } from "./reurb-conhecimento.js";

/** Nome da instância da Evolution só da Dolores (a da empresa é `prospecta-u<id>`). */
export const INSTANCIA_DOLORES = "prospecta-dolores";
/** Mensagem mais velha que isso é reentrega (histórico, reconexão): não vira comando. */
export const IDADE_MAXIMA_MS = 5 * 60_000;
/** Relógio do celular adiantado: até 2 min no futuro é tolerado. */
const FUTURO_TOLERADO_MS = 2 * 60_000;
/** O WhatsApp aceita mais, mas resposta longa no celular não se lê: corta com aviso. */
export const MAX_CARACTERES_WHATSAPP = 3800;
/** Comando do dono guardado (já filtrado). */
export const MAX_TEXTO_COMANDO = 2000;

/**
 * Número brasileiro já só em dígitos: "55" + DDD (dois dígitos de 1 a 9) + 8 dígitos (fixo) ou 9 + 8 dígitos (celular).
 * Qualquer outra forma (outro DDI, zeros à esquerda, curto, longo, nono dígito que não é 9) → null.
 */
function partesBrasileiras(digitos: string): { ddd: string; nono: boolean; final: string } | null {
  const m = /^55([1-9][1-9])(9?)(\d{8})$/.exec(digitos);
  return m ? { ddd: m[1], nono: m[2] === "9", final: m[3] } : null;
}

/** Número do dono para guardar: só dígitos, com DDI 55 e DDD válido. Inválido (inclusive estrangeiro) → null. */
export function normalizarNumeroDono(bruto: string | null | undefined): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return partesBrasileiras(d) ? d : null;
}

/**
 * O remetente é o dono? Comparação ESTRITA (não usa a chave da Central, que ignora o DDI): o remetente precisa ser
 * exatamente "55" + DDD + número (só dígitos, como vem no endereço do WhatsApp), com o mesmo DDD e os mesmos 8 últimos
 * dígitos do dono. Só o nono dígito pode faltar de um lado, e só quando os 8 finais começam por 6–9 (celular antigo); fixo
 * (2–5) exige igualdade exata. +995/+998… com os mesmos 8 finais NÃO casam.
 * Sem número do dono, ninguém comanda. A mesma função confere o destino antes de cada envio.
 */
export function ehNumeroDoDono(numero: string | null | undefined, dono: string | null | undefined): boolean {
  if (typeof numero !== "string" || typeof dono !== "string") return false;
  const a = partesBrasileiras(numero), b = partesBrasileiras(dono);
  if (!a || !b || a.ddd !== b.ddd || a.final !== b.final) return false;
  if (a.nono === b.nono) return true;
  // QA r2 N2: a falta do nono dígito só vale para celular antigo (8 dígitos começando por 6–9). Fixo (2–5) nunca casa
  // com celular de mesmos 8 finais: "99 3234-5678" (fixo) ≠ "99 9 3234-5678" (celular). Dono fixo → igualdade exata.
  return /^[6-9]/.test(a.final);
}

/**
 * Conferência FROUXA (DDD + 8 finais, formatos variados) — só para RECUSAR conflitos na configuração (número da
 * Dolores igual ao do dono ou ao de uma conexão da empresa). Nunca serve para autorizar comando.
 */
export function pareceMesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = chaveTelefone(a), y = chaveTelefone(b);
  return x.length === 10 && x === y;
}

/** Número para log, auditoria e tela: "(99) *****-4567". */
export const mascararNumero = (n: string | null | undefined): string | null => mascararTelefone(n);

/** messageTimestamp chega em segundos: número, texto ou Long ({ low, high }) do Baileys. */
export function segundos(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  const l = v as { low?: number; high?: number } | null;
  if (l && typeof l.low === "number") return (l.high ?? 0) * 2 ** 32 + (l.low >>> 0);
  return null;
}

/** Número do endereço "5599…@s.whatsapp.net" (EPIC-026 C2: tolera o sufixo de aparelho ":12" que algumas versões mandam). */
const NUMERO_DO_JID = /^(\d{10,15})(?::\d{1,3})?@s\.whatsapp\.net$/;
const numeroDoJid = (v: unknown): string | null => (typeof v === "string" ? NUMERO_DO_JID.exec(v.trim())?.[1] ?? null : null);
/** "<dígitos>@lid" (endereço novo do WhatsApp, sem o número). */
const LID_DO_JID = /^(\d{1,25})(?::\d{1,3})?@lid$/;

/**
 * Campos em que a Evolution (conforme a versão) põe o número real de uma conversa direta com endereço "@lid": `remoteJidAlt`
 * (v2.3+), `senderPn` (v2.1/2.2) e, em algumas versões, `participantPn`/`participantAlt`. Todos vêm do servidor do WhatsApp pela
 * Evolution — nunca do texto da mensagem. Só vale o que tiver a forma de número ("…@s.whatsapp.net"). `participant` puro (sem
 * "Pn"/"Alt") NÃO conta: em conversa direta ele não identifica o remetente com segurança.
 */
const CAMPOS_DO_NUMERO = ["remoteJidAlt", "senderPn", "participantPn", "participantAlt"] as const;
/**
 * QA-SEG C2 achado 3 (defesa em profundidade): no caminho de COMANDO (identificar o dono) só valem os campos de antes —
 * `remoteJid` numérico, `remoteJidAlt` e `senderPn`. `participantPn`/`participantAlt` valem só para Central/roteamento/diagnóstico.
 */
const CAMPOS_DO_NUMERO_PARA_COMANDO = ["remoteJidAlt", "senderPn"] as const;
export type CamposDoNumero = "comando" | "roteamento";

/**
 * O número da conversa DIRETA, pelo endereço (nunca pelo texto). `@lid` sem número conferível → null. `campos`: "comando" (só os
 * campos de antes; é o que identifica o dono) ou "roteamento" (também `participantPn`/`participantAlt`; nunca identifica o dono).
 */
export function numeroDaConversaDireta(key: Record<string, unknown>, campos: CamposDoNumero = "roteamento"): string | null {
  const direto = numeroDoJid(key.remoteJid);
  if (direto) return direto;
  if (typeof key.remoteJid === "string" && LID_DO_JID.test(key.remoteJid.trim())) {
    for (const campo of campos === "comando" ? CAMPOS_DO_NUMERO_PARA_COMANDO : CAMPOS_DO_NUMERO) { const n = numeroDoJid(key[campo]); if (n) return n; }
  }
  return null;
}
/** O identificador "<dígitos>@lid" da conversa direta (sem o sufixo de aparelho), ou null. */
export function lidDaConversa(key: Record<string, unknown>): string | null {
  const m = typeof key.remoteJid === "string" ? LID_DO_JID.exec(key.remoteJid.trim()) : null;
  return m ? `${m[1]}@lid` : null;
}

/** Forma do endereço, para o registro de diagnóstico (nunca o endereço em si). */
export type FormaDoEndereco = "numero" | "lid" | "grupo" | "status" | "vazio" | "outro";
export function formaDoEndereco(jid: unknown): FormaDoEndereco {
  const j = typeof jid === "string" ? jid.trim() : "";
  if (!j) return "vazio";
  if (j.endsWith("@g.us")) return "grupo";
  if (j.endsWith("@broadcast") || j.endsWith("@newsletter")) return "status";
  if (NUMERO_DO_JID.test(j)) return "numero";
  if (LID_DO_JID.test(j)) return "lid";
  return "outro";
}

export type MensagemLida =
  | { tipo: "ignorar"; motivo: "grupo" | "status" | "propria" | "sem_id" | "outro_destino" | "reacao" | "edicao" | "interacao" }
  | { tipo: "direta"; externalId: string; numero: string | null; lid: string | null; enviadaEm: Date | null; texto: string; temMidia: boolean; encaminhada: boolean };

/**
 * Embalagens do WhatsApp com a mensagem de verdade dentro (temporária, visualização única e — EPIC-026 C2 — a cópia de outro
 * aparelho da mesma conta, `deviceSentMessage`, e a mensagem com legenda de documento fica com a mídia, como antes).
 */
const EMBALAGENS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "deviceSentMessage"] as const;
export function desembrulhar(m: Record<string, any>): Record<string, any> {
  let atual = m;
  for (let i = 0; i < 4; i++) {
    const dentro = EMBALAGENS.map(k => atual?.[k]?.message).find(x => x && typeof x === "object");
    if (!dentro) break;
    atual = dentro;
  }
  return atual ?? {};
}
/** Interações que não são mensagem escrita: fixar, manter na conversa, enquete, botão, lista, modelo. */
export const INTERACOES = [
  "pinInChatMessage", "keepInChatMessage", "pollCreationMessage", "pollCreationMessageV2", "pollCreationMessageV3", "pollUpdateMessage",
  "buttonsResponseMessage", "listResponseMessage", "templateButtonReplyMessage", "interactiveResponseMessage", "senderKeyDistributionMessage",
] as const;
/** Encaminhada: o WhatsApp marca no contextInfo do conteúdo (texto ou mídia). */
export function foiEncaminhada(m: Record<string, any>): boolean {
  for (const v of Object.values(m)) {
    const ci = v && typeof v === "object" ? (v as { contextInfo?: { isForwarded?: unknown; forwardingScore?: unknown } }).contextInfo : null;
    if (ci && (ci.isForwarded === true || (typeof ci.forwardingScore === "number" && ci.forwardingScore > 0))) return true;
  }
  return false;
}

/**
 * Um item de `messages.upsert`. Grupo (@g.us), status/listas e o que a própria Dolores enviou (fromMe) são ignorados.
 * Conversa direta pode chegar com o endereço novo do WhatsApp (@lid): o número real vem em `senderPn`/`remoteJidAlt`;
 * sem ele, `numero` fica null (não dá para conferir o dono → a mensagem não é comando).
 * O texto é só o que o próprio remetente escreveu (conversa ou texto estendido); mídia vira `temMidia`.
 */
export function lerMensagemEvolution(item: unknown): MensagemLida {
  const d = (item ?? {}) as { key?: Record<string, unknown>; message?: Record<string, any> | null; messageTimestamp?: unknown };
  const key = d.key ?? {};
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (jid.endsWith("@g.us")) return { tipo: "ignorar", motivo: "grupo" };
  if (!jid || jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return { tipo: "ignorar", motivo: "status" };
  if (key.fromMe === true) return { tipo: "ignorar", motivo: "propria" };
  const id = typeof key.id === "string" ? key.id.trim().slice(0, 160) : "";
  if (!id) return { tipo: "ignorar", motivo: "sem_id" };
  const forma = formaDoEndereco(jid);
  if (forma !== "numero" && forma !== "lid") return { tipo: "ignorar", motivo: "outro_destino" };
  // QA-SEG C2 achado 3: esta leitura é a do COMANDO — só os campos de antes identificam o número (o dono)
  const numero = numeroDaConversaDireta(key, "comando");
  const lid = lidDaConversa(key);
  const m = desembrulhar(d.message ?? {});
  // reação e edição/apagamento não são pedido novo: ignoradas em silêncio (o webhook audita a contagem)
  if (m.reactionMessage) return { tipo: "ignorar", motivo: "reacao" };
  if (m.protocolMessage || m.editedMessage) return { tipo: "ignorar", motivo: "edicao" };
  const texto = typeof m.conversation === "string" ? m.conversation
    : typeof m.extendedTextMessage?.text === "string" ? m.extendedTextMessage.text : "";
  // QA r2 (informativo): fixar/manter mensagem, enquete e resposta de botão/lista não são pedido escrito — silêncio
  // (o webhook audita a contagem), sem a frase "só entendo texto". QA r3 R5: se veio texto escrito junto (ex.: conversa +
  // senderKeyDistributionMessage, que o WhatsApp manda na mesma mensagem), é texto: o pedido não some em silêncio.
  if (!texto.trim() && INTERACOES.some(k => m[k])) return { tipo: "ignorar", motivo: "interacao" };
  const temMidia = Boolean(m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.documentWithCaptionMessage || m.stickerMessage);
  const s = segundos(d.messageTimestamp);
  return { tipo: "direta", externalId: id, numero, lid, enviadaEm: s === null ? null : new Date(s * 1000), texto: texto.trim(), temMidia, encaminhada: foiEncaminhada(m) };
}

/**
 * EPIC-026 C2 — os itens de um aviso `messages.upsert`, em qualquer das formas que a Evolution manda: um objeto (v2), uma lista, ou
 * o formato do Baileys `{ messages: [...], type }`. Nada que não seja objeto entra.
 */
export function itensDoAviso(data: unknown, max: number): unknown[] {
  const d = data as { messages?: unknown } | null | undefined;
  const lista = Array.isArray(data) ? data : d && typeof d === "object" && Array.isArray(d.messages) && !("key" in (d as object)) ? d.messages : [data];
  return lista.filter(x => x && typeof x === "object").slice(0, max);
}
/** Nome do evento normalizado: "MESSAGES_UPSERT", "messages-upsert" e "messages.upsert" → "messages.upsert". */
export const normalizarEvento = (e: unknown) => String(e ?? "").trim().toLowerCase().replace(/[_-]/g, ".").slice(0, 40);

/** Sem data, velha demais ou no futuro: não é comando (reentrega da Evolution, histórico, relógio errado). */
export function mensagemAntiga(enviadaEm: Date | null, agora: Date, maxMs = IDADE_MAXIMA_MS): boolean {
  if (!enviadaEm || Number.isNaN(enviadaEm.getTime())) return true;
  const idade = agora.getTime() - enviadaEm.getTime();
  return idade > maxMs || idade < -FUTURO_TOLERADO_MS;
}

/** Mês civil de Imperatriz (UTC−3 fixo): "2026-11". */
export const mesFortaleza = (d: Date) => new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 7);

export type MotivoBloqueio =
  | "pausada" | "usuaria_desativada" | "conta_alterada" | "ia_desligada" | "sem_chave" | "sem_modelo" | "sem_limite" | "limite_mensal" | "indisponivel"
  /** EPIC-027 C5-E5: a PARTE do mês desta função acabou (só ela para; as outras seguem). */
  | "limite_da_funcao";

/**
 * Frases FIXAS para o dono quando a IA não pode rodar. Nada aqui vem de modelo: quando a Dolores está desligada ela diz
 * isso, e nada foi consultado.
 */
export function fraseDeBloqueio(motivo: MotivoBloqueio, detalhe?: string | null): string {
  const fim = " Nada foi consultado.";
  switch (motivo) {
    case "pausada": return `Dolores: estou pausada${detalhe ? ` (${detalhe.slice(0, 120)})` : ""}.${fim}`;
    case "usuaria_desativada": return `Dolores: minha usuária está desativada em Usuários e acesso.${fim}`;
    case "conta_alterada": return FRASE_CONTA_ALTERADA;
    case "ia_desligada": return `Dolores: estou desligada. Para me ligar, um administrador abre Configurações › Integrações › Dolores e toca em "Ligar a IA".${fim}`;
    case "sem_chave": return `Dolores: estou desligada — falta a chave da Anthropic em Integrações › Anthropic.${fim}`;
    case "sem_modelo": return `Dolores: estou desligada — falta escolher o modelo em Integrações › Anthropic (modelo preferencial).${fim}`;
    case "sem_limite": return `Dolores: estou desligada — falta definir o limite mensal de gasto em Integrações › Dolores.${fim}`;
    case "limite_mensal": return `Dolores: o limite mensal de gasto com a IA foi atingido; volto no mês que vem ou quando o limite for aumentado em Integrações › Dolores.${fim}`;
    case "indisponivel": return `Dolores: não consegui ler a minha configuração agora; tente de novo em instantes.${fim}`;
    case "limite_da_funcao": return FRASE_LIMITE_DA_CONVERSA;
  }
}

/**
 * 22/11/2026: a conta da Dolores foi editada em "Usuários e acesso" (perfil, módulos ou senha) — ela para e diz onde restaurar.
 * QA S-3b: a frase diz "login" e não "senha" de propósito — o filtro de saída do WhatsApp (sempre ligado) corta o que vem depois da palavra
 * "senha" ("senha [senha omitida]…") e o filtro não é afrouxado por uma frase do sistema (teste em conta-alterada.test.ts).
 */
export const FRASE_CONTA_ALTERADA = "Dolores: minha conta foi alterada em Usuários e acesso (perfil, módulos ou login), e por segurança eu parei. Para me liberar, um administrador abre Configurações › Usuários e acesso › Dolores › Restaurar conta padrão.";

export const FRASE_ENCAMINHADA = "Dolores: recebi uma mensagem encaminhada. Mensagem encaminhada não vale como pedido: escreva o pedido com as suas palavras, por favor. Nada foi consultado.";
export const FRASE_SO_TEXTO = "Dolores: nesta etapa eu só entendo mensagens de texto. Escreva o pedido, por favor. Nada foi consultado.";
/** Vários comandos no mesmo aviso e o prazo de 60 s acabou antes deste. */
export const fraseSemTempo = (hora: string) =>
  `Dolores: recebi vários pedidos juntos e não deu tempo de tratar o de ${hora}. Nada foi consultado; mande de novo, por favor.`;
/**
 * EPIC-027 C5-E5 — a parte do mês da conversa com o dono acabou (as outras funções têm a parte delas e continuam). Texto fixo.
 * Só a conversa do dono recebe frase: grupo e cliente ficam no comportamento silencioso de sempre.
 */
export const FRASE_LIMITE_DA_CONVERSA = "Dolores: bati o limite do mês da nossa conversa; os grupos e os documentos continuam funcionando. Volto no mês que vem ou quando a parte da conversa for aumentada em Dolores — operação contínua. Nada foi consultado.";
/** QA r2 N3: a reserva de OUTRO pedido em andamento ocupa o que resta do limite do mês (não é o limite atingido). */
export const FRASE_OUTRO_PEDIDO = "Dolores: há outro pedido meu em andamento usando o que resta do limite do mês; tente de novo em um minuto, por favor. Nada foi consultado.";
export const FRASE_ERRO = "Dolores: tive uma falha ao montar a resposta e parei. Nada foi alterado no sistema; tente de novo em instantes.";

export type Uso = { entrada: number; saida: number };
export type Limites = { entrada: number; saida: number };

/** Limite mensal: 0 (não definido) bloqueia; atingido em entrada OU saída bloqueia. */
export function bloqueioDoLimite(uso: Uso, limites: Limites): "sem_limite" | "limite_mensal" | null {
  if (!(limites.entrada > 0) || !(limites.saida > 0)) return "sem_limite";
  if (uso.entrada >= limites.entrada || uso.saida >= limites.saida) return "limite_mensal";
  return null;
}

/** Resposta para o WhatsApp: corta no limite, de preferência numa quebra de linha, e avisa que cortou. */
export function cortarResposta(texto: string, max = MAX_CARACTERES_WHATSAPP): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  const aviso = "\n\n(Resposta cortada por tamanho. Peça a parte que faltou.)";
  const limite = max - aviso.length;
  const corte = t.lastIndexOf("\n", limite);
  return `${t.slice(0, corte > limite * 0.6 ? corte : limite).trimEnd()}${aviso}`;
}

/** Etapa 8 — a resposta ao dono pode sair em até 3 mensagens seguidas (cada uma dentro de MAX_CARACTERES_WHATSAPP). */
export const MAX_PARTES_RESPOSTA = 3;
/** "(1/3)\n" — a numeração de cada mensagem quando a resposta vai em mais de uma. */
const TAMANHO_NUMERACAO = 6;

/**
 * Corta `t` em pedaços de até `cap` caracteres (o PRIMEIRO, de até `capPrimeiro`), de preferência numa quebra de linha (senão num
 * espaço), no máximo `maxPartes`; o último que não couber é cortado com o aviso de sempre.
 */
function pedacos(t: string, cap: number, maxPartes: number, capPrimeiro = cap): string[] {
  const r: string[] = [];
  let resto = t.trim();
  const capDe = () => (r.length === 0 ? capPrimeiro : cap);
  while (resto && r.length < maxPartes - 1 && resto.length > capDe()) {
    const c = capDe();
    let corte = resto.lastIndexOf("\n", c);
    if (corte < c * 0.5) corte = resto.lastIndexOf(" ", c);
    if (corte < c * 0.5) corte = c;
    r.push(resto.slice(0, corte).trimEnd());
    resto = resto.slice(corte).trimStart();
  }
  if (resto) r.push(resto.length <= capDe() ? resto : cortarResposta(resto, capDe()));
  return r;
}

/**
 * QA E8 A3: no texto do MODELO, uma linha que começa com "(2/3)" (ou "( 2 / 3 )") imitaria a numeração das mensagens. Ela sai:
 * a numeração do sistema é a única.
 */
export function semNumeracaoForjada(texto: string): string {
  return texto.replace(/^[ \t]*[(（][ \t]*\d{1,3}[ \t]*[/／][ \t]*\d{1,3}[ \t]*[)）][ \t]*/gm, "");
}

/** EPIC-027 C5 (REURB, QA M1): fechos fixos do sistema que, no fim da resposta, nunca são cortados. */
export const FECHOS_FIXOS: readonly string[] = [AVISO_REURB];
/** O fecho fixo com que o texto termina (ou null). */
export function fechoFixo(texto: string): string | null {
  const t = texto.trimEnd();
  return FECHOS_FIXOS.find(f => t.endsWith(f)) ?? null;
}

/**
 * Etapa 8 — divide a resposta ao dono em até {@link MAX_PARTES_RESPOSTA} mensagens, cada uma com no máximo `max` caracteres,
 * cortando em quebra de linha e numerando "(1/3)" quando há mais de uma. O que não couber é cortado na última com o aviso de
 * sempre ("Resposta cortada por tamanho"). `quadros` (o que foi feito e a fila, montados pelo sistema) NUNCA é cortado e vai
 * SEMPRE na PRIMEIRA mensagem — no fim dela quando a resposta é uma mensagem só; no começo quando há várias (QA E8 A1: a primeira é a que sai antes de o tempo acabar; o quadro é a fonte da
 * verdade sobre o que foi gravado); o texto do modelo vem depois e é ele que é cortado. `maxPartes` menor (pouco tempo para
 * enviar) corta o texto livre, nunca os quadros. A numeração "(n/m)" escrita pelo modelo no começo de linha sai (A3).
 */
export function partesDaResposta(texto: string, quadros: string | null = null, max = MAX_CARACTERES_WHATSAPP, maxPartes = MAX_PARTES_RESPOSTA): string[] {
  // EPIC-027 C5 (REURB, QA M1): o fecho fixo do sistema no fim do texto nunca é cortado — o espaço dele é reservado antes do corte
  // e ele volta no fim da ÚLTIMA mensagem; quem é cortado é o texto do modelo.
  const fecho = fechoFixo(texto);
  if (fecho) {
    const corpo = texto.trimEnd().slice(0, -fecho.length).trimEnd();
    const partes = partesDaResposta(corpo, quadros, max - fecho.length - 2, maxPartes);
    const ultima = partes.length - 1;
    return partes.map((p, i) => (i === ultima ? (p ? `${p}\n\n${fecho}` : fecho) : p));
  }
  const t = semNumeracaoForjada(texto).trim();
  const q = (quadros ?? "").trim();
  const n = Math.max(1, Math.floor(maxPartes));
  // Uma mensagem só: ela É a primeira — o texto vem antes e os quadros fecham a mensagem (a instrução "Responda só aprovar…"
  // fica no fim, como sempre); sem caber, quem é cortado é o texto do modelo, nunca os quadros.
  const inteiro = q ? (t ? `${t}\n\n${q}` : q) : t;
  if (inteiro.length <= max) return [inteiro];
  if (n === 1) {
    if (!q) return [cortarResposta(t, max)];
    const espaco = max - q.length - 2;
    return [t && espaco >= 200 ? `${cortarResposta(t, espaco)}\n\n${q}` : cortarResposta(q, max)];
  }
  const cap = max - TAMANHO_NUMERACAO;
  let partes: string[];
  if (!q) partes = pedacos(t, cap, n);
  else {
    const quadro = q.length <= cap ? q : cortarResposta(q, cap);
    // o começo do texto vai junto com os quadros na 1ª mensagem quando sobra espaço razoável; senão, os quadros vão sozinhos
    const sobra = cap - quadro.length - 2;
    if (!t) partes = [quadro];
    else if (sobra >= 200) {
      const resto = pedacos(t, cap, n, sobra);
      partes = [`${quadro}\n\n${resto[0]}`, ...resto.slice(1)];
    } else partes = [quadro, ...pedacos(t, cap, n - 1)];
  }
  return partes.length === 1 ? [partes[0].length <= max ? partes[0] : cortarResposta(partes[0], max)] : partes.map((p, i) => `(${i + 1}/${partes.length})\n${p}`);
}
