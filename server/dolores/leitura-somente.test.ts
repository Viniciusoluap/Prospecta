// EPIC-025 (Dolores, etapa 1) — guarda: nada em server/dolores/leitura/ grava no banco.
// (1) estático: nenhum insert/update/delete/execute/transaction/SQL de escrita no código e só importações permitidas;
// (2) em tempo de execução: todas as funções liberadas rodam sobre um banco que recusa qualquer comando de escrita.
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { users } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { FUNCOES } from "./funcoes.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { criarTabelasDaMaquete } from "./testes-maquete.js";

const PASTA = new URL("./leitura/", import.meta.url);
const arquivos = readdirSync(PASTA).filter(a => a.endsWith(".ts"));
const ESCRITA_SQL = /^\s*(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|call|do|vacuum|reindex|comment|lock|set|reset|refresh)\b/i;

describe("leitura: estático", () => {
  it("há arquivos de leitura e nenhum usa comando de escrita", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(8);
    for (const a of arquivos) {
      const fonte = readFileSync(new URL(a, PASTA), "utf8").replace(/\/\/.*$/gm, "");
      expect(fonte, a).not.toMatch(/\.(insert|update|delete)\s*\(/);
      expect(fonte, a).not.toMatch(/\b(execute|transaction|onConflictDoUpdate|onConflictDoNothing|returning)\s*\(/);
      expect(fonte, a).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i);
    }
  });

  it("só importa schema, regras puras, a conexão somente leitura e as outras leituras (nunca db.js direto)", () => {
    for (const a of arquivos) {
      const fonte = readFileSync(new URL(a, PASTA), "utf8");
      for (const [, origem] of fonte.matchAll(/from\s+"([^"]+)"/g)) {
        const permitido = ["drizzle-orm", "drizzle-orm/pg-core", "zod"].includes(origem) || /^\.\.\/\.\.\/\.\.\/(drizzle\/schema|shared\/)/.test(origem)
          || origem === "../somente-leitura.js" || /^\.\/[\w-]+\.js$/.test(origem)
          // o interruptor dos dados pessoais (opção B, 16/11): só lê a variável de ambiente e formata; não toca o banco
          || origem === "../dados-pessoais.js"
          // EPIC-029 S-6: a soma das receitas por empresa (mesma conta da aba Contabilidade) recebe a conexão SOMENTE LEITURA como argumento
          || origem === "../../fiscal/teto.js";
        expect(permitido, `${a} importa ${origem}`).toBe(true);
      }
    }
    // …e ela mesma não abre conexão própria: só drizzle-orm e regras puras
    const teto = readFileSync(new URL("../fiscal/teto.ts", import.meta.url), "utf8");
    for (const [, origem] of teto.matchAll(/from\s+"([^"]+)"/g)) expect(["drizzle-orm", "../../shared/fiscal/regimes.js"], `teto.ts importa ${origem}`).toContain(origem);
  });
});

/** Banco que recusa escrita: toda consulta passa por aqui antes de chegar ao PGlite. */
function somenteLeitura(pg: Awaited<ReturnType<typeof criarBanco>>["pg"], tentativas: string[]) {
  const conferir = (sql: unknown) => {
    const texto = String(sql);
    if (ESCRITA_SQL.test(texto) || /\bnextval\s*\(/i.test(texto) || /;\s*\S/.test(texto.trim().replace(/;$/, ""))) {
      tentativas.push(texto);
      throw new Error(`ESCRITA RECUSADA: ${texto.slice(0, 80)}`);
    }
  };
  return new Proxy(pg, {
    get(alvo, prop, receptor) {
      const v = Reflect.get(alvo, prop, receptor);
      if (prop === "query" || prop === "exec") return (sql: unknown, ...resto: unknown[]) => { conferir(sql); return (v as Function).call(alvo, sql, ...resto); };
      if (prop === "transaction") return () => { throw new Error("ESCRITA RECUSADA: transação"); };
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  });
}

describe("leitura: em tempo de execução", () => {
  let tentativas: string[];
  let bancoLeitura: ReturnType<typeof drizzle>;
  beforeEach(async () => {
    const banco = await criarBanco();
    await banco.pg.exec(CENARIO);
    // EPIC-027 C5-COM: as leituras da maquete por lote leem maquete_3d_lotes/itens (0146/0147)
    await criarTabelasDaMaquete(banco.pg);
    tentativas = [];
    bancoLeitura = drizzle(somenteLeitura(banco.pg, tentativas) as never);
    vi.mocked(getDb).mockReturnValue(bancoLeitura as never);
  });

  it("o banco de teste recusa escrita de verdade", async () => {
    // o drizzle embrulha o erro ("Failed query: …"); a recusa fica registrada em `tentativas`
    await expect(bancoLeitura.insert(users).values({ openId: "x" })).rejects.toThrow();
    await expect(bancoLeitura.update(users).set({ name: "y" })).rejects.toThrow();
    await expect(bancoLeitura.delete(users)).rejects.toThrow();
    expect(tentativas.map(t => t.split(" ")[0].toLowerCase())).toEqual(["insert", "update", "delete"]);
    expect((await bancoLeitura.select().from(users)).length).toBe(2);
  });

  it("todas as funções liberadas rodam (com os argumentos padrão e com filtros) sem nenhuma escrita", async () => {
    const argumentos: Record<string, Record<string, unknown>[]> = {
      detalhar_processo_regularizacao: [{ id: 1 }, { id: 2 }],
      consultar_cliente: [{ leadId: 1 }, { busca: "Atrasado" }],
      historico_atendimento: [{ leadId: 2 }],
      conversas_whatsapp: [{}, { leadId: 1 }],
      listar_documentos: [{}, { leadId: 1, situacao: "todos" }],
      listar_medicoes: [{}, { obraId: 1, situacao: "recebidas" }],
      listar_tarefas: [{}, { situacao: "todas" }],
      listar_processos_regularizacao: [{}, { situacao: "todos" }],
      listar_grupos: [{}, { situacao: "todos" }],
      ler_grupo_cliente: [{ grupoId: 1 }, { grupoId: 1, conteudo: "documentos" }],
      // EPIC-027 C5-COM
      consultar_maquete_lote: [{ busca: "lote 4 da quadra 18" }, { loteId: 1 }],
      rascunhar_mensagem_lote: [{ loteId: 1 }],
    };
    for (const fn of FUNCOES) {
      for (const a of argumentos[fn.nome] ?? [{}]) {
        const r = await fn.executar(fn.entrada.parse(a) as never, { agora: AGORA, canal: "whatsapp" });
        expect(r.resumo, fn.nome).toBeTypeOf("object");
      }
    }
    expect(tentativas).toEqual([]);
  });
});
