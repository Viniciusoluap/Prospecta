// Pedido de 29/10: "Organizar Drive" (envio do que está só no banco, reorganização,
// pastas órfãs na lixeira) e lixeira nas exclusões. Sem chamar o Google: as
// dependências do Drive e do banco são falsas.
import { describe, expect, it, vi } from "vitest";
import type { ArquivoNoDrive, ArquivoPendente, FonteArquivos } from "./drive-arquivos.js";
import {
  copiarParaDrive, lixeiraDaEntidade, lixeiraDoArquivo, lixeiraDoLead, lixeiraDoProjeto, organizarDrive, type CursorOrganizacao, type DependenciasOrganizador, type RelatorioOrganizacao,
} from "./drive-organizacao.js";

vi.mock("./db.js", () => ({ getDb: vi.fn(() => ({ execute: vi.fn(() => Promise.resolve({ rows: [] })) })) }));

const destino = { caminho: [{ chave: "equipe", nome: "Equipe" }, { chave: "equipe:4", nome: "Ana (nº 4)" }, { chave: "equipe:4:outros", nome: "Outros" }], nome: "Outros — 29-10-2026.pdf" };

/** Fonte falsa: `banco` = ids só no banco; `drive` = id → driveFileId já no Drive. */
function fonteFalsa(tipo: string, banco: number[], drive: Record<number, string> = {}): FonteArquivos & { gravados: Record<number, string> } {
  const gravados: Record<number, string> = {};
  return {
    tipo, gravados,
    async pendentes({ aposId, limite, id }) {
      return banco.filter((x) => (id ? x === id : x > aposId) && !gravados[x]).slice(0, limite).map((x): ArquivoPendente => ({
        tipo, id: x, mime: "application/pdf", destino: async () => destino,
        carregar: async () => Buffer.from(`arquivo ${x}`),
        gravar: async (d) => { gravados[x] = d; },
      }));
    },
    async noDrive(aposId, limite) {
      return Object.entries(drive).map(([k, v]) => ({ id: Number(k), v })).filter((x) => x.id > aposId).slice(0, limite)
        .map((x): ArquivoNoDrive => ({ tipo, id: x.id, driveFileId: x.v, destino: async () => destino }));
    },
  };
}

function depsFalsas(extra: Partial<DependenciasOrganizador> = {}) {
  let estado: CursorOrganizacao = {};
  let relatorio: RelatorioOrganizacao | null = null;
  let relogio = 0;
  let enviados = 0;
  const lixeira = vi.fn(async (_id: string) => undefined);
  const upload = vi.fn(async () => `drive-${++enviados}`);
  const deps: DependenciasOrganizador = {
    configurado: async () => true,
    fontes: [],
    upload,
    mover: vi.fn(async () => "no_lugar" as const),
    adotar: async () => null,
    subpastas: async () => ({ pastas: [], proximaPagina: null }),
    arquivosNaPasta: async () => [],
    pastaPorChave: async () => null,
    emUso: async () => new Set(),
    existentes: async (_e, ids) => new Set(ids),
    lixeira,
    fila: { listar: async () => [], remover: async () => undefined, falhou: async () => undefined },
    estado: { ler: async () => estado, gravar: async (c, r) => { estado = c; relatorio = r; } },
    agora: () => relogio,
    ...extra,
  };
  return { deps, lixeira, upload, avancar: (ms: number) => { relogio += ms; }, estado: () => estado, relatorio: () => relatorio };
}

describe("Organizar Drive — envio do que está só no banco", () => {
  it("envia os pendentes, grava a referência e ignora os já enviados na execução seguinte", async () => {
    const docs = fonteFalsa("usuario_documento", [1, 2, 3]);
    const f = depsFalsas({ fontes: [docs] });
    const r1 = await organizarDrive(f.deps);
    expect(r1).toMatchObject({ enviados: 3, falhas: 0, concluido: true });
    expect(docs.gravados).toEqual({ 1: "drive-1", 2: "drive-2", 3: "drive-3" });
    expect(f.relatorio()).toMatchObject({ enviados: 3 });
    const r2 = await organizarDrive(f.deps);
    expect(r2.enviados).toBe(0);
    expect(f.upload).toHaveBeenCalledTimes(3);
  });

  it("alterna as fontes e respeita o prazo: para no meio e a próxima execução continua", async () => {
    const a = fonteFalsa("a", [1, 2, 3, 4, 5, 6]);
    const b = fonteFalsa("b", [1, 2, 3, 4, 5, 6]);
    const f = depsFalsas({ fontes: [a, b] });
    f.deps.upload = vi.fn(async () => { f.avancar(10); return `x${Math.random()}`; });
    const r1 = await organizarDrive(f.deps, { prazoMs: 45, lote: 2 });
    expect(r1.concluido).toBe(false);
    expect(r1.enviados).toBe(5); // 0,10,20,30,40 ms → o 6º já passa do prazo
    expect(Object.keys(a.gravados).length).toBeGreaterThan(0);
    expect(Object.keys(b.gravados).length).toBeGreaterThan(0); // as duas fontes tiveram vez
    const r2 = await organizarDrive(f.deps, { prazoMs: 10_000, lote: 2 });
    expect(r2.enviados).toBe(7);
    expect(r2.concluido).toBe(true);
  });

  it("falha no Drive não para o lote: conta a falha e segue para o próximo", async () => {
    const docs = fonteFalsa("x", [1, 2]);
    const f = depsFalsas({ fontes: [docs] });
    f.deps.upload = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValueOnce("ok-2");
    const r = await organizarDrive(f.deps);
    expect(r).toMatchObject({ enviados: 1, falhas: 1 });
    expect(docs.gravados).toEqual({ 2: "ok-2" });
  });

  it("cópia antiga já no Drive (PCI original) é reconhecida em vez de enviada de novo", async () => {
    const fonte = fonteFalsa("pci_original", [9]);
    const original = fonte.pendentes!.bind(fonte);
    fonte.pendentes = async (filtro) => (await original(filtro)).map((i) => ({ ...i, adotarPrefixo: "PCI original — " }));
    const f = depsFalsas({ fontes: [fonte], adotar: async (pasta, prefixo) => (pasta === "equipe:4:outros" && prefixo === "PCI original — " ? "antigo" : null) });
    const r = await organizarDrive(f.deps);
    expect(r).toMatchObject({ enviados: 0, reconhecidos: 1 });
    expect(fonte.gravados).toEqual({ 9: "antigo" });
  });

  it("sem Drive configurado não faz nada e explica", async () => {
    const f = depsFalsas({ configurado: async () => false, fontes: [fonteFalsa("x", [1])] });
    const r = await organizarDrive(f.deps);
    expect(r.enviados).toBe(0);
    expect(r.motivo).toContain("não configurado");
  });
});

describe("Organizar Drive — reorganização com cursor", () => {
  it("move o que está fora do lugar e guarda o cursor quando o prazo acaba", async () => {
    const fonte = fonteFalsa("x", [], { 1: "a", 2: "b", 3: "c" });
    const f = depsFalsas({ fontes: [fonte] });
    f.deps.mover = vi.fn(async () => { f.avancar(20); return "movido" as const; });
    const r1 = await organizarDrive(f.deps, { prazoMs: 30, lote: 10 });
    expect(r1.movidos).toBe(2);
    expect(f.estado().mover).toEqual({ fonte: 0, aposId: 2 });
    const r2 = await organizarDrive(f.deps, { prazoMs: 10_000 });
    expect(r2.movidos).toBe(1);
    expect(f.estado().mover).toEqual({ fonte: 0, aposId: 0 }); // passada completa: recomeça do início
  });
});

describe("Organizar Drive — pastas órfãs", () => {
  const pastas = {
    clientes: [
      { id: "p1", chave: "cliente:1" },   // lead existe (ativo)
      { id: "p2", chave: "cliente:2" },   // lead só arquivado: existe no banco
      { id: "p3", chave: "cliente:3" },   // lead apagado → órfã
      { id: "p4", chave: null },          // pasta criada à mão: nunca tocada
      { id: "p5", chave: "cliente:3:atendimento" }, // subpasta: não é pasta de entidade
    ],
    obras: [{ id: "o9", chave: "obra:9" }],
  } as Record<string, { id: string; chave: string | null }[]>;

  it("manda para a lixeira só as pastas cujo registro não existe; lead arquivado não é órfão; pasta sem etiqueta fica", async () => {
    const existentes = vi.fn(async (entidade: string, ids: number[]) => new Set(ids.filter((id) => !(entidade === "cliente" && id === 3) && !(entidade === "obra" && id === 9))));
    const f = depsFalsas({ subpastas: async (cat) => ({ pastas: pastas[cat] ?? [], proximaPagina: null }), existentes });
    const r = await organizarDrive(f.deps);
    expect(f.lixeira.mock.calls.map((c) => c[0]).sort()).toEqual(["o9", "p3"]);
    expect(r).toMatchObject({ pastasOrfasNaLixeira: 2, concluido: true });
    expect(existentes).toHaveBeenCalledWith("cliente", [1, 2, 3]);
  });

  it("pasta órfã com arquivo ainda usado por algum registro não vai para a lixeira", async () => {
    const f = depsFalsas({
      subpastas: async (cat) => ({ pastas: cat === "clientes" ? [{ id: "p3", chave: "cliente:3" }] : [], proximaPagina: null }),
      existentes: async () => new Set(),
      arquivosNaPasta: async () => ["arq-1", "arq-2"],
      emUso: async (ids) => new Set(ids.filter((i) => i === "arq-2")),
    });
    const r = await organizarDrive(f.deps);
    expect(f.lixeira).not.toHaveBeenCalled();
    expect(r.pastasAguardando).toBe(1);
  });

  it("respeita o teto de pastas órfãs por execução", async () => {
    const muitas = Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, chave: `cliente:${i + 1}` }));
    const f = depsFalsas({ subpastas: async (cat) => ({ pastas: cat === "clientes" ? muitas : [], proximaPagina: null }), existentes: async () => new Set() });
    const r = await organizarDrive(f.deps, { maxOrfas: 2 });
    expect(f.lixeira).toHaveBeenCalledTimes(2);
    expect(r.concluido).toBe(false);
    expect(f.estado().orfaos).toEqual({ categoria: 0, pagina: null });
  });
});

describe("Organizar Drive — proteções dos órfãos (paridade com o Santa Fé)", () => {
  it("portfólio de projeto sem lead (cliente:projeto-<id>) é conferido contra os projetos", async () => {
    const existentes = vi.fn(async (entidade: string, ids: number[]) => new Set(entidade === "projeto" ? ids.filter((i) => i === 1) : ids));
    const f = depsFalsas({
      subpastas: async (cat) => ({ pastas: cat === "clientes" ? [{ id: "c1", chave: "cliente:1" }, { id: "pp1", chave: "cliente:projeto-1" }, { id: "pp2", chave: "cliente:projeto-2" }] : [], proximaPagina: null }),
      existentes,
    });
    await organizarDrive(f.deps);
    expect(existentes).toHaveBeenCalledWith("projeto", [1, 2]);
    expect(f.lixeira.mock.calls.map((c) => c[0])).toEqual(["pp2"]);
  });

  it("mais de 25 órfãs numa página e mais da metade dela: nada é apagado e o relatório avisa", async () => {
    const pastas = Array.from({ length: 40 }, (_, i) => ({ id: `p${i + 1}`, chave: `cliente:${i + 1}` }));
    const f = depsFalsas({
      subpastas: async (cat) => ({ pastas: cat === "clientes" ? pastas : [], proximaPagina: null }),
      existentes: async (_e, ids) => new Set(ids.filter((i) => i > 30)), // 30 de 40 "sem registro"
    });
    const r = await organizarDrive(f.deps, { maxOrfas: 100 });
    expect(f.lixeira).not.toHaveBeenCalled();
    expect(r.aviso).toContain("Nada foi apagado");
  });

  it("até 25 órfãs (ou menos da metade) segue normalmente", async () => {
    const pastas = Array.from({ length: 60 }, (_, i) => ({ id: `p${i + 1}`, chave: `cliente:${i + 1}` }));
    const f = depsFalsas({
      subpastas: async (cat) => ({ pastas: cat === "clientes" ? pastas : [], proximaPagina: null }),
      existentes: async (_e, ids) => new Set(ids.filter((i) => i > 26)), // 26 de 60: menos da metade
    });
    const r = await organizarDrive(f.deps, { maxOrfas: 100 });
    expect(f.lixeira).toHaveBeenCalledTimes(26);
    expect(r.aviso).toBeNull();
  });
});

describe("Lixeira nas exclusões", () => {
  it("lead: tira da pasta os arquivos ainda usados (doc compartilhado, mídia) e depois manda a pasta para a lixeira", async () => {
    const ordem: string[] = [];
    let devolvida = false;
    const f = depsFalsas({
      emUso: async (ids) => new Set(ids.filter((i) => i !== "so-do-lead")),
      mover: vi.fn(async (id: string) => { ordem.push(`mover:${id}`); return "movido" as const; }),
      pastaPorChave: async (c) => { if (devolvida || c !== "cliente:5") return null; devolvida = true; return { id: "pasta-lead" }; },
      lixeira: vi.fn(async (id: string) => { ordem.push(`lixeira:${id}`); }),
    });
    await lixeiraDoLead(5, ["so-do-lead", "copia", "midia"], f.deps, async () => destino);
    expect(ordem).toEqual(["mover:copia", "mover:midia", "lixeira:pasta-lead"]);
  });

  it("lead: se não der para mover algo, a pasta NÃO vai para a lixeira agora (fica para o sincronizador)", async () => {
    const f = depsFalsas({
      emUso: async (ids) => new Set(ids),
      mover: vi.fn(async () => "falha" as const),
      pastaPorChave: async () => ({ id: "pasta-lead" }),
    });
    await lixeiraDoLead(5, ["copia"], f.deps, async () => destino);
    expect(f.lixeira).not.toHaveBeenCalled();
  });

  it("projeto: pasta de portfólio projeto-<id>", async () => {
    const pedidas: string[] = [];
    const f = depsFalsas({ pastaPorChave: async (c) => { pedidas.push(c); return pedidas.length === 1 ? { id: "pf" } : null; } });
    await lixeiraDoProjeto(12, f.deps);
    expect(pedidas[0]).toBe("projeto-12");
    expect(f.lixeira).toHaveBeenCalledWith("pf");
  });

  it("lead/obra/estudo/imóvel/usuário: a pasta da entidade (pela etiqueta) vai para a lixeira", async () => {
    for (const [entidade, chave] of [["cliente", "cliente:5"], ["obra", "obra:5"], ["incorporacao", "incorporacao:5"], ["imovel", "imovel:5"], ["equipe", "equipe:5"]] as const) {
      const pedidas: string[] = [];
      let devolvida = false;
      const f = depsFalsas({ pastaPorChave: async (c) => { pedidas.push(c); if (devolvida) return null; devolvida = true; return { id: `pasta-${c}` }; } });
      await lixeiraDaEntidade(entidade, 5, f.deps);
      expect(pedidas[0]).toBe(chave);
      expect(f.lixeira).toHaveBeenCalledWith(`pasta-${chave}`);
    }
  });

  it("falha no Drive nunca lança (a exclusão no banco já aconteceu)", async () => {
    const f = depsFalsas({ pastaPorChave: async () => { throw new Error("Drive fora"); } });
    await expect(lixeiraDaEntidade("obra", 1, f.deps)).resolves.toBeUndefined();
    const g = depsFalsas({ lixeira: vi.fn(async () => { throw new Error("Drive fora"); }) });
    await expect(lixeiraDoArquivo("abc", g.deps)).resolves.toBeUndefined();
  });

  it("arquivo individual só vai para a lixeira se nenhum outro registro usa o mesmo arquivo", async () => {
    const f = depsFalsas({ emUso: async () => new Set(["abc"]) });
    await lixeiraDoArquivo("abc", f.deps);
    expect(f.lixeira).not.toHaveBeenCalled();
    const g = depsFalsas();
    await lixeiraDoArquivo("abc", g.deps);
    expect(g.lixeira).toHaveBeenCalledWith("abc");
  });
});

describe("Cópia ao gravar", () => {
  it("documento do engenheiro vai para Equipe/<Nome (nº id)>/<categoria>", async () => {
    const docs = fonteFalsa("usuario_documento", [7]);
    const f = depsFalsas({ fontes: [docs] });
    expect(await copiarParaDrive("usuario_documento", 7, f.deps)).toBe(true);
    expect(f.upload).toHaveBeenCalledWith(destino, "application/pdf", Buffer.from("arquivo 7"), expect.any(Map));
    expect(docs.gravados).toEqual({ 7: "drive-1" });
  });

  it("sem Drive ou com falha: devolve false e fica pendente", async () => {
    const docs = fonteFalsa("usuario_documento", [7]);
    expect(await copiarParaDrive("usuario_documento", 7, depsFalsas({ fontes: [docs], configurado: async () => false }).deps)).toBe(false);
    const f = depsFalsas({ fontes: [docs] });
    f.deps.upload = vi.fn(async () => { throw new Error("quota"); });
    expect(await copiarParaDrive("usuario_documento", 7, f.deps)).toBe(false);
    expect(docs.gravados).toEqual({});
  });
});
