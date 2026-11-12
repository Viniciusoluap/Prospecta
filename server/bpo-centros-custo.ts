// Pedido de 12/11 (noite): cadastro de centros de custo do BPO (listar, criar, renomear, ativar/desativar).
// O lançamento continua guardando o nome em texto (bpo_lancamentos.centro_custos; "A / B" = dois centros), então
// renomear também atualiza os lançamentos — só a parte correspondente nos combinados. Regras em
// shared/financeiro/centros-custo.ts.
import { asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bpoCentrosCusto, bpoLancamentos } from "../drizzle/schema.js";
import { centrosDoLancamento, chaveCentro, normalizarNomeCentro, renomearCentroNoTexto } from "../shared/financeiro/centros-custo.js";

/** Centros com quantos lançamentos (ativos no BPO) usam cada um. */
export async function listarCentrosCusto() {
  const d = getDb();
  const [centros, usados] = await Promise.all([
    d.select().from(bpoCentrosCusto).orderBy(asc(bpoCentrosCusto.nome)),
    d.select({ centroCustos: bpoLancamentos.centroCustos, n: sql<number>`count(*)::int` }).from(bpoLancamentos)
      .where(isNotNull(bpoLancamentos.centroCustos)).groupBy(bpoLancamentos.centroCustos),
  ]);
  const uso = new Map<string, number>();
  for (const u of usados) for (const c of centrosDoLancamento(u.centroCustos)) uso.set(chaveCentro(c), (uso.get(chaveCentro(c)) ?? 0) + Number(u.n));
  return centros.map(c => ({ ...c, lancamentos: uso.get(chaveCentro(c.nome)) ?? 0 }));
}

async function exigirNomeLivre(nome: string, exceto?: number) {
  const todos = await getDb().select({ id: bpoCentrosCusto.id, nome: bpoCentrosCusto.nome }).from(bpoCentrosCusto);
  const igual = todos.find(c => c.id !== exceto && chaveCentro(c.nome) === chaveCentro(nome));
  if (igual) throw new Error(`Já existe o centro de custo "${igual.nome}".`);
}

function validarNome(nome: string) {
  const n = normalizarNomeCentro(nome);
  if (n.length < 2) throw new Error("Informe o nome do centro de custo.");
  if (n.includes("/")) throw new Error("O nome não pode ter \"/\" (é o separador de dois centros no mesmo lançamento).");
  return n;
}

export async function criarCentroCusto(nome: string) {
  const n = validarNome(nome);
  await exigirNomeLivre(n);
  const [c] = await getDb().insert(bpoCentrosCusto).values({ nome: n }).onConflictDoNothing().returning();
  if (!c) throw new Error(`Já existe um centro de custo com o nome "${n}".`);
  return c;
}

export async function ativarCentroCusto(id: number, ativo: boolean) {
  const [c] = await getDb().update(bpoCentrosCusto).set({ ativo }).where(eq(bpoCentrosCusto.id, id)).returning();
  if (!c) throw new Error("Centro de custo não encontrado.");
  return c;
}

/** Renomeia o centro e os lançamentos que o usam (inclusive arquivados e combinados "A / B"), numa transação. */
export async function renomearCentroCusto(id: number, novoNome: string) {
  const n = validarNome(novoNome);
  return getDb().transaction(async tx => {
    const [c] = await tx.select().from(bpoCentrosCusto).where(eq(bpoCentrosCusto.id, id)).for("update");
    if (!c) throw new Error("Centro de custo não encontrado.");
    const todos = await tx.select({ id: bpoCentrosCusto.id, nome: bpoCentrosCusto.nome }).from(bpoCentrosCusto);
    const igual = todos.find(x => x.id !== id && chaveCentro(x.nome) === chaveCentro(n));
    if (igual) throw new Error(`Já existe o centro de custo "${igual.nome}".`);
    if (c.nome === n) return { centro: c, lancamentos: 0 };
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bpo_centros_custo'))`);
    const comTexto = await tx.select({ id: bpoLancamentos.id, centroCustos: bpoLancamentos.centroCustos }).from(bpoLancamentos)
      .where(isNotNull(bpoLancamentos.centroCustos));
    const porTexto = new Map<string, number[]>();
    for (const l of comTexto) {
      const novo = renomearCentroNoTexto(l.centroCustos, c.nome, n);
      if (novo !== null && novo !== l.centroCustos) porTexto.set(novo, [...(porTexto.get(novo) ?? []), l.id]);
    }
    let lancamentos = 0;
    for (const [texto, ids] of Array.from(porTexto.entries())) {
      for (let i = 0; i < ids.length; i += 500) {
        const r = await tx.update(bpoLancamentos).set({ centroCustos: texto, updatedAt: new Date() }).where(inArray(bpoLancamentos.id, ids.slice(i, i + 500))).returning({ id: bpoLancamentos.id });
        lancamentos += r.length;
      }
    }
    const [atualizado] = await tx.update(bpoCentrosCusto).set({ nome: n }).where(eq(bpoCentrosCusto.id, id)).returning();
    return { centro: atualizado, lancamentos };
  });
}
