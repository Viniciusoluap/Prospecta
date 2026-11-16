// EPIC-025 (Dolores, etapa 1) — a usuária Dolores. É uma linha real de `users`, criada uma vez e achada pelo openId,
// usada como autora de tudo o que ela consulta ou faz. Sem senha (o login por e-mail e senha recusa quem não tem
// passwordHash), sem e-mail (não recebe primeiro acesso nem avisos) e com o perfil "user", que não abre painel,
// portal nem área do empreiteiro (shared/perfis-acesso.ts) e não passa no adminProcedure (server/_core/trpc.ts).
// Ela age só pela ponte (server/dolores/ponte.ts), com as funções liberadas em permissoes.ts.
import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema.js";
import { getDb } from "../db.js";

export const DOLORES_OPEN_ID = "sistema:dolores";
export const DOLORES_NOME = "Dolores (funcionária digital)";
export const DOLORES_PERFIL = "user" as const;

let cache: number | null = null;

export class DoloresDesativada extends Error {
  constructor() { super("Usuária Dolores desativada pelo administrador"); }
}

/**
 * Id da usuária Dolores; cria a linha na primeira vez (idempotente: openId único + ON CONFLICT DO NOTHING) e confere,
 * a cada chamada, que a conta continua sem senha, sem módulos e com o perfil sem acesso.
 */
export async function usuarioDolores(): Promise<number> {
  const db = getDb();
  if (!cache) await db.insert(users).values({
    openId: DOLORES_OPEN_ID, name: DOLORES_NOME, role: DOLORES_PERFIL, active: true,
    passwordHash: null, email: null, permissions: "[]", loginMethod: "dolores",
  }).onConflictDoNothing({ target: users.openId });
  const [u] = await db.select({ id: users.id, role: users.role, active: users.active, passwordHash: users.passwordHash, permissions: users.permissions })
    .from(users).where(eq(users.openId, DOLORES_OPEN_ID)).limit(1);
  if (!u) throw new Error("Usuária Dolores não encontrada");
  // Desativar a conta em "Usuários e acesso" é o botão de parada do administrador.
  if (!u.active) throw new DoloresDesativada();
  // Se alguém deu senha, outro perfil ou módulos à conta dela, a ponte para: ela não pode ganhar acesso por fora.
  if (u.role !== DOLORES_PERFIL || u.passwordHash || (u.permissions && u.permissions !== "[]"))
    throw new Error("Conta da Dolores alterada fora da ponte (perfil, senha ou módulos); ponte bloqueada");
  cache = u.id;
  return u.id;
}

/** Só para testes: esquece o id guardado (banco novo a cada teste). */
export function esquecerUsuarioDolores() { cache = null; }

/**
 * Id da usuária Dolores SEM criar a linha (etapa 2): autora dos registros de mensagens recebidas no WhatsApp, que
 * acontecem mesmo com a Dolores pausada. Não existe ainda → null (o registro fica sem autora).
 */
export async function idDaDoloresSemCriar(): Promise<number | null> {
  if (cache) return cache;
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.openId, DOLORES_OPEN_ID)).limit(1);
  return u?.id ?? null;
}
