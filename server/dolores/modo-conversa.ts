// EPIC-026 C6 — "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central WhatsApp (pedido do dono de 20/11/2026:
// "Faça um botão nas mensagens lá no WhatsApp para que coloque para assumir o humano ou devolver pra Dolores e assim nós podemos
// fazer isso manualmente quando necessário"). Rotas `whatsapp.atendimentoDaConversa` e `whatsapp.mudarAtendimentoDaConversa`.
// Regras fixas:
// - Só admin e colaborador (por PAPEL, com o módulo WhatsApp), na conexão da EMPRESA. Corretor: nada (a conexão dele não tem Dolores).
// - Nunca a conversa do dono, a do próprio número da empresa, grupo nem número não identificado ("@lid"); só conversa que existe na
//   Central da empresa e que a Dolores atenderia (UM cliente do CRM, identificado pelo número como no webhook, e o atendimento a
//   cliente LIGADO). Com o atendimento desligado, recusa: nada é ligado.
// - O botão nunca chama a IA nem envia mensagem: só grava quem atende a conversa (whatsapp_atendimento_modo) e, ao devolver,
//   encerra o silêncio automático daquele momento. Tetos, pausa geral, interruptor e filtros da Dolores continuam como estão.
// - Auditoria em dolores_acoes ("atendimento_conversa"): quem, quando, id da conversa e do lead. Nunca o telefone.
import { TRPCError } from "@trpc/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { users, whatsappMessages } from "../../drizzle/schema.js";
import { whatsappAtendimentoModo, whatsappSilencio } from "../../drizzle/schema-whatsapp-atendimento.js";
import { type AcaoDoAtendimento, type EstadoDoAtendimento } from "../../shared/dolores/modo-conversa.js";
import { ehConversaSemNumero } from "../../shared/whatsapp/conversas.js";
import { mesmoTelefone } from "../_core/evolution.js";
import { podeUsarModulo } from "../_core/rbac.js";
import { getDb } from "../db.js";
import { MENSAGEM_NUMERO_RESERVADO, conexaoDaEmpresa, ehNumeroReservado, numerosReservadosDoPapel, usaConexaoDaEmpresa } from "../whatsapp-conexao-empresa.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { agoraDoRoteamento, chaveDoNumero, identificarRemetente, lerConfigAtendimento, situacaoDoSilencio } from "./roteamento.js";

type Usuario = { id: number; role: string; permissions?: string | null; active?: boolean | null };

export type AtendimentoDaConversa =
  | { mostrar: false }
  | {
    mostrar: true; elegivel: boolean; motivo: string | null; estado: EstadoDoAtendimento;
    /** Até quando vai o silêncio automático (estado "silencio"). */
    ate: Date | null;
    /** Quem assumiu e quando (estado "assumida"). */
    alteradoEm: Date | null; alteradoPor: string | null;
  };

export const MOTIVO_NAO_ELEGIVEL = {
  desligado: "A Dolores não responde clientes por aqui: o atendimento automático está desligado em Integrações.",
  desconectado: "A Dolores não responde por aqui: o WhatsApp da empresa está desconectado.",
  desconhecido: "A Dolores não responde esta conversa: o número não é de cliente cadastrado no CRM.",
  varios: "A Dolores não responde esta conversa: o telefone está em mais de um cadastro.",
  usuario: "A Dolores não responde esta conversa: o número é de um usuário do sistema.",
  cadastro: "A Dolores não responde esta conversa: o cadastro não está ligado a um lead do CRM.",
  semConversa: "Conversa não encontrada na Central da empresa.",
} as const;

/** Número da Central (só dígitos, às vezes sem o 55) na forma do webhook (com 55), para identificar o remetente igual. */
const comDdi = (numero: string) => { const d = numero.replace(/\D/g, ""); return d.length === 10 || d.length === 11 ? `55${d}` : d; };
const naoEhConversaDireta = (numero: string) => ehConversaSemNumero(numero) || /@/.test(numero) || !/^\d{10,15}$/.test(comDdi(numero));

type Contexto = { instancia: string; chave: string; leadId: number | null; elegivel: boolean; motivo: string | null; connId: number };

/**
 * As conferências comuns, no SERVIDOR. `null` = não mostrar nada (corretor, conversa reservada ou sem número). Lança só quando
 * `exigir` (a mutação): papel, módulo, reservada, sem número.
 */
async function conferir(user: Usuario, numero: string, exigir: boolean): Promise<Contexto | null> {
  const recusa = (code: "FORBIDDEN" | "BAD_REQUEST", message: string) => { if (exigir) throw new TRPCError({ code, message }); return null; };
  if (!usaConexaoDaEmpresa(user.role)) return recusa("FORBIDDEN", "Só a equipe (administrador e colaborador) assume ou devolve conversas do WhatsApp da empresa.");
  if (!podeUsarModulo(user, "whatsapp")) return recusa("FORBIDDEN", "Sem permissão para este módulo");
  if (naoEhConversaDireta(numero)) return recusa("BAD_REQUEST", "Só conversa direta com número identificado (nunca grupo ou número não identificado).");
  let reservados;
  try { reservados = await numerosReservadosDoPapel(user.role); }
  catch { return recusa("BAD_REQUEST", "Não consegui conferir o número do dono na configuração do WhatsApp da empresa; nada foi feito."); }
  if (ehNumeroReservado(numero, reservados)) return recusa("FORBIDDEN", MENSAGEM_NUMERO_RESERVADO);
  const chave = chaveDoNumero(comDdi(numero));
  if (!chave) return recusa("BAD_REQUEST", "Número da conversa inválido.");
  const [conn, cfg] = await Promise.all([conexaoDaEmpresa(), lerConfigWhatsapp().catch(() => null)]);
  if (!conn) return recusa("BAD_REQUEST", MOTIVO_NAO_ELEGIVEL.desconectado);
  const db = getDb();
  const destinos = await db.select({ destinatario: whatsappMessages.destinatario }).from(whatsappMessages).where(eq(whatsappMessages.connectionId, conn.id));
  if (!destinos.some(m => mesmoTelefone(m.destinatario, numero))) return recusa("BAD_REQUEST", MOTIVO_NAO_ELEGIVEL.semConversa);
  if (!cfg?.instancia) return { instancia: "", chave, leadId: null, elegivel: false, motivo: MOTIVO_NAO_ELEGIVEL.desconectado, connId: conn.id };
  const config = await lerConfigAtendimento();
  // a MESMA identificação do webhook (por código, pelo número): só UM cliente do CRM é atendido pela Dolores
  const quem = await identificarRemetente(comDdi(numero)).catch(() => ({ categoria: "varios" as const, leadId: null }));
  const motivo = quem.categoria !== "cliente" || !quem.leadId
    ? MOTIVO_NAO_ELEGIVEL[quem.categoria === "cliente" ? "cadastro" : quem.categoria]
    : !config.clienteLigado ? MOTIVO_NAO_ELEGIVEL.desligado : null;
  return { instancia: cfg.instancia, chave, leadId: quem.categoria === "cliente" ? quem.leadId : null, elegivel: !motivo, motivo, connId: conn.id };
}

async function lerEstado(c: Contexto, numero: string): Promise<Extract<AtendimentoDaConversa, { mostrar: true }>> {
  const agora = agoraDoRoteamento();
  const s = c.instancia ? await situacaoDoSilencio(comDdi(numero), agora, c.instancia) : { estado: "dolores" as const, ate: null };
  let alteradoEm: Date | null = null;
  let alteradoPor: string | null = null;
  if (s.estado === "assumida") {
    const [l] = await getDb().select({ em: whatsappAtendimentoModo.alteradoEm, nome: users.name }).from(whatsappAtendimentoModo)
      .leftJoin(users, eq(users.id, whatsappAtendimentoModo.alteradoPor))
      .where(and(eq(whatsappAtendimentoModo.instancia, c.instancia), eq(whatsappAtendimentoModo.chaveNumero, c.chave))).limit(1).catch(() => []);
    alteradoEm = l?.em ?? null;
    alteradoPor = l?.nome ?? null;
  }
  return { mostrar: true, elegivel: c.elegivel, motivo: c.motivo, estado: s.estado, ate: s.ate, alteradoEm, alteradoPor };
}

/** Para a tela: quem atende a conversa e se o botão aparece. Corretor, conversa reservada ou sem número → { mostrar: false }. */
export async function atendimentoDaConversa(user: Usuario, numero: string): Promise<AtendimentoDaConversa> {
  const c = await conferir(user, numero, false).catch(() => null);
  if (!c) return { mostrar: false };
  return lerEstado(c, numero);
}

/**
 * "Assumir (humano)": a Dolores fica calada nesta conversa sem prazo, até alguém devolver. "Devolver para a Dolores": grava a hora e
 * encerra o silêncio automático daquele momento (a próxima mensagem do cliente já pode ser respondida; nada antigo é respondido).
 * Nunca chama a IA, nunca envia mensagem e nunca liga interruptor nenhum.
 */
export async function mudarAtendimentoDaConversa(user: Usuario, numero: string, acao: AcaoDoAtendimento) {
  const c = (await conferir(user, numero, true))!;
  if (!c.elegivel) throw new TRPCError({ code: "BAD_REQUEST", message: c.motivo ?? MOTIVO_NAO_ELEGIVEL.desconhecido });
  const antes = (await situacaoDoSilencio(comDdi(numero), agoraDoRoteamento(), c.instancia)).estado;
  const agora = agoraDoRoteamento();
  const modo = acao === "assumir" ? "humano" as const : "dolores" as const;
  const db = getDb();
  const id = await db.transaction(async tx => {
    const [linha] = await tx.insert(whatsappAtendimentoModo).values({ instancia: c.instancia, chaveNumero: c.chave, leadId: c.leadId, modo, alteradoEm: agora, alteradoPor: user.id })
      .onConflictDoUpdate({ target: [whatsappAtendimentoModo.instancia, whatsappAtendimentoModo.chaveNumero], set: { modo, leadId: c.leadId, alteradoEm: agora, alteradoPor: user.id } })
      .returning({ id: whatsappAtendimentoModo.id });
    // devolver: o silêncio automático daquele momento acaba agora (nunca apaga a linha; uma resposta nova da equipe recala)
    if (modo === "dolores") await tx.update(whatsappSilencio).set({ ate: agora, atualizadoEm: sql`now()` })
      .where(and(eq(whatsappSilencio.chaveNumero, c.chave), gt(whatsappSilencio.ate, agora)));
    return linha.id;
  });
  await registrarAcao({
    funcao: "atendimento_conversa", resultado: "ok", autorUserId: user.id, canal: "tela", pedidoId: `conversa:${id}`,
    motivo: acao === "assumir" ? "conversa assumida pela equipe (Dolores calada até devolverem)" : "conversa devolvida para a Dolores (vale para a próxima mensagem do cliente)",
    resumo: { conversaId: id, leadId: c.leadId, acao, antes },
  });
  return lerEstado(c, numero);
}
