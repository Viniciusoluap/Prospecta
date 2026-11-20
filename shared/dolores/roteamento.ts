// EPIC-025 (etapa 9) — roteamento POR CÓDIGO de tudo o que chega ao número da empresa (regra do dono de 20/11/2026: "eu quero uma
// conexão só"). Regras puras, sem banco nem rede; quem consulta o banco é server/dolores/roteamento.ts. Nunca pela IA, nunca pelo
// texto da mensagem: só o endereço do WhatsApp (`key.remoteJid`, `senderPn`/`remoteJidAlt`, `fromMe`) e o que o servidor achou
// nos cadastros pelo número.
//
//   grupo                        → só Dolores (E4/E4b/E7); nunca vira conversa da Central
//   direta do número do dono     → só Dolores (comando); nunca gravada/visível na Central
//   direta de cliente cadastrado → Central + Dolores pode responder (item 4)
//   direta de telefone em 2+ cadastros distintos → Central (equipe); a Dolores não responde
//   direta de usuário do sistema, ou de cadastro sem lead no CRM → Central; sem saudação, sem Dolores
//   direta de número desconhecido → Central + saudação (item 3); a Dolores NÃO responde nem chama a IA
//   direta SEM número conferível (endereço "@lid" sem o número) → Central como "número não identificado" (EPIC-026 C2: nenhuma
//     mensagem some sem registro); nunca é o dono, nunca é comando, sem saudação, sem Dolores, sem resposta por aqui
//   fromMe (enviada pelo número da empresa) → nunca é comando; com o dono ou em grupo nunca aparece na Central; com os demais,
//     aparece na conversa (resposta automática marcada; a da equipe cala a Dolores naquela conversa por N horas)
import { desembrulhar, ehNumeroDoDono, foiEncaminhada, formaDoEndereco, lerMensagemEvolution, lidDaConversa, numeroDaConversaDireta, segundos } from "./whatsapp.js";

/**
 * Forma canônica do número brasileiro para chaves (resumo, silêncio, saudação, tetos): "55" + DDD + os 8 finais, sem o nono dígito
 * (a mesma variação aceita por `ehNumeroDoDono`). Fixo e celular de mesmos 8 finais ficam iguais aqui — só serve de CHAVE de
 * contagem, nunca para identificar alguém (a identificação é sempre `ehNumeroDoDono`, estrita). Fora da forma brasileira: os
 * dígitos com prefixo "x" (nunca casa com um brasileiro).
 */
export function formaCanonicaDoNumero(numero: string | null | undefined): string | null {
  let d = String(numero ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`; // cadastro sem o DDI
  const m = /^55([1-9][1-9])9?(\d{8})$/.exec(d);
  return m ? `55${m[1]}${m[2]}` : `x${d.slice(0, 20)}`;
}

/** Áudio de verdade (gravado ou enviado como áudio), com a duração e o tamanho declarados pelo WhatsApp. */
export type AudioDeclarado = { segundos: number | null; tamanho: number | null; mime: string | null };

export type ItemRoteado =
  | { tipo: "grupo" }
  | { tipo: "ignorar"; motivo: string }
  | { tipo: "propria"; externalId: string; numero: string | null; lid: string | null; enviadaEm: Date | null; texto: string }
  | { tipo: "direta"; externalId: string; numero: string | null; lid: string | null; enviadaEm: Date | null; texto: string; temMidia: boolean; encaminhada: boolean; audio: AudioDeclarado | null };

const tamanho = (v: unknown): number | null => {
  const n = segundos(v); // mesmo formato (número, texto ou Long)
  return n === null ? null : n;
};

/** Lê UM item de `messages.upsert` para o roteamento (inclusive o que o número da empresa enviou — fromMe). */
export function lerParaRoteamento(item: unknown): ItemRoteado {
  const d = (item ?? {}) as { key?: Record<string, unknown>; message?: Record<string, any> | null; messageTimestamp?: unknown };
  const key = d.key ?? {};
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (jid.endsWith("@g.us")) return { tipo: "grupo" };
  if (!jid || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return { tipo: "ignorar", motivo: "status" };
  if (key.fromMe === true) {
    const id = typeof key.id === "string" ? key.id.trim().slice(0, 160) : "";
    if (!id) return { tipo: "ignorar", motivo: "sem_id" };
    const forma = formaDoEndereco(jid);
    if (forma !== "numero" && forma !== "lid") return { tipo: "ignorar", motivo: "outro_destino" };
    const m = desembrulhar(d.message ?? {});
    if (m.reactionMessage || m.protocolMessage || m.editedMessage) return { tipo: "ignorar", motivo: "edicao" };
    const texto = typeof m.conversation === "string" ? m.conversation : typeof m.extendedTextMessage?.text === "string" ? m.extendedTextMessage.text : "";
    const s = segundos(d.messageTimestamp);
    return { tipo: "propria", externalId: id, numero: numeroDaConversaDireta(key), lid: lidDaConversa(key), enviadaEm: s === null ? null : new Date(s * 1000), texto: texto.trim() };
  }
  const lida = lerMensagemEvolution(item);
  if (lida.tipo === "ignorar") return { tipo: "ignorar", motivo: lida.motivo };
  const m = desembrulhar(d.message ?? {});
  const a = m.audioMessage && typeof m.audioMessage === "object" ? m.audioMessage as Record<string, unknown> : null;
  const audio: AudioDeclarado | null = a ? {
    segundos: tamanho(a.seconds), tamanho: tamanho(a.fileLength),
    mime: typeof a.mimetype === "string" ? a.mimetype.split(";")[0].trim().slice(0, 60) : null,
  } : null;
  // QA-SEG C2 achado 3: a leitura do comando é estrita; para a Central/roteamento valem também participantPn/participantAlt
  return { ...lida, numero: lida.numero ?? numeroDaConversaDireta(key, "roteamento"), encaminhada: lida.encaminhada || foiEncaminhada(m), audio };
}

/** Quem é o remetente da conversa direta, decidido no servidor pelo número (nunca pelo texto). */
export type Categoria = "cliente" | "cadastro" | "varios" | "usuario" | "desconhecido";

export type Rota =
  | { destino: "grupo" }
  | { destino: "dono" }
  | { destino: "nada"; motivo: string }
  | { destino: "central_saida"; numero: string }
  /** EPIC-026 C2: conversa direta de terceiro sem número conferível — Central com o "@lid" como chave; nada automático. */
  | { destino: "central_sem_numero"; lid: string }
  | { destino: "central"; numero: string; categoria: Categoria; dolores: boolean; saudacao: boolean };

/**
 * A decisão. `categoria` só é usada para conversa direta que não é do dono (quem chama a resolve pelo número). O número do dono é
 * conferido aqui com a MESMA comparação estrita dos comandos: dono escrevendo → comando (nunca Central); fromMe para o dono →
 * nada (nunca Central). Sem número conferível: a recebida vai à Central como "número não identificado" (EPIC-026 C2); a enviada,
 * nada.
 */
export function decidirRota(item: ItemRoteado, numeroDono: string | null | undefined, categoria: Categoria | null): Rota {
  if (item.tipo === "grupo") return { destino: "grupo" };
  if (item.tipo === "ignorar") return { destino: "nada", motivo: item.motivo };
  if (!item.numero) {
    // EPIC-026 C2: a mensagem RECEBIDA sem número aparece na Central (nunca é o dono: sem número não há como conferir). A enviada
    // pelo número da empresa a um "@lid" fica fora (pode ser a conversa com o dono) e só deixa o registro de diagnóstico.
    if (item.tipo === "direta" && item.lid) return { destino: "central_sem_numero", lid: item.lid };
    return { destino: "nada", motivo: "sem número conferível" };
  }
  if (item.tipo === "propria") {
    if (ehNumeroDoDono(item.numero, numeroDono)) return { destino: "nada", motivo: "conversa com o dono: nunca vai à Central" };
    return { destino: "central_saida", numero: item.numero };
  }
  if (ehNumeroDoDono(item.numero, numeroDono)) return { destino: "dono" };
  const c = categoria ?? "desconhecido";
  return { destino: "central", numero: item.numero, categoria: c, dolores: c === "cliente", saudacao: c === "desconhecido" };
}

/** O que a pessoa mandou é áudio "só áudio" (sem texto escrito)? */
export const ehSoAudio = (item: Extract<ItemRoteado, { tipo: "direta" }>) => !!item.audio && !item.texto;

/** Texto fixo de campanha/aviso: sem variáveis (nada de {{…}}), sem marcador de dado e curto. Devolve o motivo da recusa ou null. */
export function textoFixoInvalido(texto: string, max: number): string | null {
  const t = texto.trim();
  if (t.length < 2) return "texto vazio";
  if (t.length > max) return `texto maior que ${max} caracteres`;
  if (/\{\{|\}\}|\$\{/.test(t)) return "o texto não pode ter variáveis ({{…}}): é fixo, igual para todos";
  return null;
}
