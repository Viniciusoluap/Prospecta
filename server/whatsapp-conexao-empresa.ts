// EPIC-025 (etapa 9) — a "conexão efetiva" da Central para o admin e o colaborador: a conexão da EMPRESA, feita só em
// Configurações › Integrações (instância `prospecta-dolores`, linha `dolores_whatsapp_config`). Regra do dono de 20/11/2026: "eu
// quero uma conexão só".
// Caminho de MENOS mudança nas regras da Central: a linha de `whatsapp_connections` do primeiro admin (a que o colaborador já usava)
// continua sendo o `connectionId` das conversas — ela NÃO é alterada no banco. Ao LER, por código, provider/instância/status/número
// vêm da conexão da empresa. Assim as regras de visibilidade e de envio da Central (corretor só os próprios leads; admin e
// colaborador a conexão da empresa) ficam como estavam. Só se o primeiro admin não tiver linha nenhuma, uma linha NOVA é criada
// (sem instância), para servir de `connectionId`.
import { eq } from "drizzle-orm";
import { users, whatsappConnections, type WhatsappConnection } from "../drizzle/schema.js";
import { ehNumeroDoDono, mascararNumero, normalizarNumeroDono } from "../shared/dolores/whatsapp.js";
import { ehConversaSemNumero } from "../shared/whatsapp/conversas.js";
import { getDb } from "./db.js";
import { lerConfigWhatsapp } from "./dolores/consumo.js";

/** Papéis que usam a conexão da empresa na Central (o corretor continua com a própria). */
export const usaConexaoDaEmpresa = (role: string | null | undefined) => role === "admin" || role === "colaborador";

export type ConexaoDaEmpresa = WhatsappConnection & { daEmpresa: true; numeroMascarado: string | null };

/**
 * QA-SEG E9 achado 1: números que a Central NUNCA usa pela conexão da empresa — o do DONO (a conversa dele é com a Dolores; escrever a
 * ele pelo número da empresa é se passar pela Dolores) e o PRÓPRIO número da empresa. Lidos da configuração da Dolores, no servidor.
 */
export type NumerosReservados = {
  dono: string | null; empresa: string | null;
  /**
   * QA-SEG C2 achado 1: a conversa de "número não identificado" (endereço "@lid") fica oculta (lista, histórico, mídia, exclusão,
   * busca, não lidas) para quem não é ADMIN (por papel) — pode ser o dono escrevendo de um "@lid" ainda não aprendido.
   */
  ocultarSemNumero?: boolean;
  /**
   * EPIC-025 E10 (QA M3): os telefones dos USUÁRIOS do sistema (qualquer papel, ativos e inativos), normalizados. A conversa da
   * empresa com um usuário é a cobrança da Dolores ao colaborador (e a resposta dele): pela conexão da empresa, só o ADMIN vê.
   */
  usuarios?: readonly string[];
};

/** Falha ao ler a configuração → lança (quem chama fecha: não envia, não lista). */
export async function numerosReservados(): Promise<NumerosReservados> {
  const cfg = await lerConfigWhatsapp();
  return { dono: cfg?.numeroDono ?? null, empresa: cfg?.numeroDolores ?? null };
}

/**
 * QA-SEG C2 achado 1: os números que a Central esconde de QUEM pede. Conexão da empresa (admin e colaborador): o dono e a empresa;
 * além disso, para quem não é admin, toda conversa de número não identificado ("@lid"). Demais papéis (conexão própria): só o
 * "@lid" (nunca deveria haver um ali; se houver, fica oculto). Falha ao ler a configuração → lança (quem chama fecha).
 */
export async function numerosReservadosDoPapel(role: string | null | undefined): Promise<NumerosReservados> {
  const ocultarSemNumero = role !== "admin";
  if (!usaConexaoDaEmpresa(role)) return { dono: null, empresa: null, ocultarSemNumero };
  const base = await numerosReservados();
  if (role === "admin") return { ...base, ocultarSemNumero };
  return { ...base, ocultarSemNumero, usuarios: await telefonesDosUsuarios() };
}

/** Os telefones (normalizados, sem repetição) de todos os usuários do sistema. Falha ao ler → lança (quem chama fecha). */
async function telefonesDosUsuarios(): Promise<string[]> {
  const linhas = await getDb().select({ phone: users.phone }).from(users);
  return Array.from(new Set(linhas.map(u => normalizarNumeroDono(u.phone)).filter((n): n is string => !!n)));
}

/**
 * O número é o do dono ou o da empresa? Comparação ESTRITA (`ehNumeroDoDono`), sobre o número como ele SAI pela Evolution (sem o 55,
 * ela acrescenta — `enviarTextoEvolution`) e sobre o número como veio. Estrangeiro com os mesmos 8 finais não casa.
 */
export function ehNumeroReservado(numero: string | null | undefined, r: NumerosReservados): boolean {
  // EPIC-026 C2: o "@lid" (número não identificado) não é telefone — não se compara com o dono nem com a empresa pelos dígitos.
  // QA-SEG C2 achado 1: para quem não é admin, ele é reservado (oculto) — qualquer forma de "@lid" (maiúsculas, sufixo de aparelho).
  if (ehConversaSemNumero(numero) || /@lid\b/i.test(String(numero ?? ""))) return !!r.ocultarSemNumero;
  const d = String(numero ?? "").replace(/\D/g, "");
  if (!d) return false;
  const efetivo = d.startsWith("55") ? d : `55${d}`;
  return [d, efetivo].some(n => ehNumeroDoDono(n, r.dono) || ehNumeroDoDono(n, r.empresa) || (r.usuarios ?? []).some(u => ehNumeroDoDono(n, u)));
}

export const MENSAGEM_NUMERO_RESERVADO =
  "Esse é o número do dono (conversa com a Dolores), o da própria empresa ou o de um usuário do sistema (cobrança da Dolores, só o administrador vê): a Central não escreve, não mostra nem altera essa conversa pelo número da empresa.";

/** Primeiro admin (o mesmo critério que o colaborador já usava). */
async function primeiroAdmin(): Promise<number | null> {
  const [admin] = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  return admin?.id ?? null;
}

/**
 * A conexão da empresa como a Central a enxerga. `numero` sai MASCARADO (tela); provider "evolution" e a instância da empresa só
 * na memória. Sem admin → null. Sem a configuração da Dolores (migração 0124) → desconectada.
 */
export async function conexaoDaEmpresa(): Promise<ConexaoDaEmpresa | null> {
  const dono = await primeiroAdmin();
  if (!dono) return null;
  const db = getDb();
  let [linha] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
  if (!linha) {
    await db.insert(whatsappConnections).values({ userId: dono, provider: "evolution", status: "desconectado" }).onConflictDoNothing();
    [linha] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
    if (!linha) return null;
  }
  const cfg = await lerConfigWhatsapp().catch(() => null);
  const conectada = !!cfg?.instancia && cfg.statusConexao === "conectado";
  const numeroMascarado = mascararNumero(cfg?.numeroDolores ?? null);
  return {
    ...linha, provider: "evolution", instancia: cfg?.instancia ?? null, status: conectada ? "conectado" : (cfg?.statusConexao ?? "desconectado"),
    numero: numeroMascarado, tokenEncrypted: null, phoneNumberId: null, daEmpresa: true, numeroMascarado,
  };
}
