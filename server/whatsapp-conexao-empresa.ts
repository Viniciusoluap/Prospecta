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
import { mascararNumero } from "../shared/dolores/whatsapp.js";
import { getDb } from "./db.js";
import { lerConfigWhatsapp } from "./dolores/consumo.js";

/** Papéis que usam a conexão da empresa na Central (o corretor continua com a própria). */
export const usaConexaoDaEmpresa = (role: string | null | undefined) => role === "admin" || role === "colaborador";

export type ConexaoDaEmpresa = WhatsappConnection & { daEmpresa: true; numeroMascarado: string | null };

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
