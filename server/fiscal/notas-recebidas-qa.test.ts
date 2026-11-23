// QA (Quinn) — portão de SEGURANÇA e INTEGRIDADE do EPIC-029 S-5 parte 1 (NFS-e recebidas = origem 'adn' de obra_notas).
// Testes de verificação independentes do dev. Os ACHADOS ficam como `it.fails` (o corpo descreve o comportamento esperado
// e hoje falha); quando o achado for corrigido, o `it.fails` passa a falhar e deve virar `it`.
// Nada aqui chama rede (vigia de fetch) nem toca banco real (PGlite).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CENARIO, MIGRACAO_0166, MIGRACAO_0170, criarBanco } from "../dolores/testes-banco.js";
import { notasDoBanco } from "../dolores/leitura/notas.js";
import { cnpjValido as cnpjDosContratos } from "../../shared/contratos/modelos.js";
import { cnpjValido as cnpjDasNotasDeGrupo, cpfValido as cpfDasNotas } from "../../shared/dolores/notas.js";
import { cnpjValido, digitosVerificadoresCnpj } from "../../shared/fiscal/documento.js";
import { isValidCPF } from "../../shared/cpf.js";
import {
  capturarNotasRecebidas, capturarRecebidasNoCron, gravarNotaRecebida, registrarClienteDistribuicao,
  type ClienteDistribuicaoAdn, type DocumentoDistribuido,
} from "./distribuicao.js";
import { lerNfseRecebida, mapearNotaRecebida } from "./nfse-recebida.js";

const MIGRACAO = readFileSync(new URL("../../drizzle/0163_obra_notas_origem_adn.sql", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("./fixtures/nfse-nacional-recebida.xml", import.meta.url), "utf8");
const CHAVE_FIXTURE = "21053022112223330001810000000000123261112345678901";
const TOMADOR = "44556677000186";
const EMPREITEIRO = "11222333000181";
const AGORA = new Date("2026-11-22T13:00:00Z");
const SEM_VINCULO = { obraId: null, empreiteiroUserId: null, duvida: null };

let banco: Awaited<ReturnType<typeof criarBanco>>;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await banco.pg.query<T>(sql, p)).rows;
const db = () => banco.db as never;
const chaveDe = (seq: number) => `${CHAVE_FIXTURE.slice(0, 40)}${String(seq).padStart(10, "0")}`;
const xmlDe = (seq: number) => FIXTURE.replace(CHAVE_FIXTURE, chaveDe(seq)).replace("<nNFSe>123</nNFSe>", `<nNFSe>${seq}</nNFSe>`);
const ler = (x: string) => { const r = lerNfseRecebida(x); if (!r.ok) throw new Error(r.motivo); return r.nota; };

function clienteFalso(total: number) {
  const docs: DocumentoDistribuido[] = Array.from({ length: total }, (_, i) => ({ nsu: i + 1, chave: chaveDe(i + 1), xml: xmlDe(i + 1) }));
  return { buscarDesde: vi.fn<ClienteDistribuicaoAdn["buscarDesde"]>(async ({ ultimoNsu }) => ({ documentos: docs.filter(d => d.nsu > ultimoNsu).slice(0, 50) })) };
}

async function mensagemDeGrupo(externo: string) {
  const [g] = await q<{ id: number }>("SELECT id FROM dolores_grupos WHERE grupo_jid = '120363000000000009@g.us'");
  const grupoId = g?.id ?? (await q<{ id: number }>("INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, obra_id) VALUES ('inst', '120363000000000009@g.us', 'Obra QA', true, 1) RETURNING id"))[0].id;
  const [m] = await q<{ id: number }>("INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, texto) VALUES ($1, 'inst', $2, 'documento', 'nota') RETURNING id", [grupoId, externo]);
  return { grupoId, mensagemId: m.id };
}

beforeEach(async () => {
  banco = await criarBanco({ sem0163: true });
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`
    INSERT INTO users ("openId", name, role, active, "passwordHash", cpf) VALUES ('emp', 'Construtora Exemplo', 'empreiteiro', true, 'hash', '11222333000181');
    UPDATE construction_projects SET contractor_user_id = 3 WHERE id IN (1, 2);`);
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  registrarClienteDistribuicao(null);
});

afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  registrarClienteDistribuicao(null);
  await banco.pg.close();
});

// ── 1. Migração 0163 ──

describe("QA 0163 — só aditiva, CHECK validado, idempotente, guardas convivem", () => {
  it("texto da migração: sem DROP de coluna/tabela, sem UPDATE/DELETE/TRUNCATE de dados, sem NOT VALID", () => {
    const semComentarios = MIGRACAO.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(semComentarios).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|FUNCTION)/i);
    expect(semComentarios).not.toMatch(/^\s*(UPDATE|DELETE|TRUNCATE)\b/im);
    expect(semComentarios).not.toMatch(/NOT\s+VALID/i);
    expect(semComentarios).not.toMatch(/SET\s+DEFAULT|ALTER\s+COLUMN\s+"\w+"\s+TYPE/i);
    // a única troca de regra existente é o DROP NOT NULL de grupo_id/mensagem_id, e ela vem DEPOIS do CHECK equivalente
    const dropNotNull = [...semComentarios.matchAll(/ALTER COLUMN "(\w+)" DROP NOT NULL/g)].map(m => m[1]);
    expect(dropNotNull).toEqual(["grupo_id", "mensagem_id"]);
    expect(semComentarios.indexOf("obra_notas_grupo_exige_mensagem_ck")).toBeLessThan(semComentarios.indexOf("DROP NOT NULL"));
    // DROP TRIGGER só dos gatilhos novos (o da 0128 não é recriado)
    const drops = [...semComentarios.matchAll(/DROP TRIGGER IF EXISTS (\w+)/g)].map(m => m[1]);
    expect(drops).not.toContain("obra_notas_guarda");
    expect(semComentarios).not.toMatch(/FUNCTION obra_notas_guarda\(\)/);
  });

  it("linhas existentes (várias, com conciliação e confirmação) ficam idênticas; os CHECKs novos estão VALIDADOS contra elas", async () => {
    const a = await mensagemDeGrupo("A1");
    const b = await mensagemDeGrupo("B1");
    await banco.pg.exec(`
      INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao, tipo, emitente_documento, numero, valor_centavos, chave_acesso)
        VALUES (${a.grupoId}, ${a.mensagemId}, 1, 'rascunho', 'nfe', '${EMPREITEIRO}', '1', 1000, NULL);
      INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao, tipo, confirmacao, confirmacao_em)
        VALUES (${b.grupoId}, ${b.mensagemId}, NULL, 'confira', 'recibo', 'confirmada', now());`);
    const antes = await q("SELECT * FROM obra_notas ORDER BY id");
    await banco.pg.exec(MIGRACAO);
    await banco.pg.exec(MIGRACAO);
    await banco.pg.exec(MIGRACAO);
    const depois = await q<Record<string, unknown>>("SELECT * FROM obra_notas ORDER BY id");
    expect(depois.map(d => { const { origem, chave_nfse, nsu, emitente_cnpj_alfa, ...resto } = d; expect({ origem, chave_nfse, nsu, emitente_cnpj_alfa }).toEqual({ origem: "grupo", chave_nfse: null, nsu: null, emitente_cnpj_alfa: null }); return resto; })).toEqual(antes);
    const cks = await q<{ conname: string; convalidated: boolean }>("SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'obra_notas'::regclass AND conname LIKE 'obra_notas_%_ck' ORDER BY conname");
    expect(cks.map(c => c.conname)).toEqual(expect.arrayContaining([
      "obra_notas_adn_ck", "obra_notas_chave_nfse_ck", "obra_notas_cnpj_alfa_ck", "obra_notas_grupo_exige_mensagem_ck", "obra_notas_nsu_ck", "obra_notas_origem_ck", "obra_notas_um_documento_ck",
    ]));
    expect(cks.every(c => c.convalidated)).toBe(true);
    // repetir não duplica constraint, índice nem gatilho
    expect((await q<{ n: number }>("SELECT count(*)::int n FROM pg_constraint WHERE conname = 'obra_notas_grupo_exige_mensagem_ck'"))[0].n).toBe(1);
    const gat = await q<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE tgrelid = 'obra_notas'::regclass AND NOT tgisinternal ORDER BY tgname");
    expect(gat.map(g => g.tgname)).toEqual(expect.arrayContaining(["obra_notas_guarda", "obra_notas_guarda_origem"]));
    expect(new Set(gat.map(g => g.tgname)).size).toBe(gat.length);
  });

  it("nota de grupo continua impossível sem grupo/mensagem — também por UPDATE (CHECK + guarda da 0128)", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    const m = await mensagemDeGrupo("U1");
    const [{ id }] = await q<{ id: number }>("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao) VALUES ($1, $2, 'rascunho') RETURNING id", [m.grupoId, m.mensagemId]);
    await expect(q("UPDATE obra_notas SET mensagem_id = NULL WHERE id = $1", [id])).rejects.toThrow();
    // mesmo com o gatilho da 0128 desligado (cenário hipotético), o CHECK segura sozinho
    await banco.pg.exec("ALTER TABLE obra_notas DISABLE TRIGGER obra_notas_guarda");
    await expect(q("UPDATE obra_notas SET mensagem_id = NULL WHERE id = $1", [id])).rejects.toThrow(/obra_notas_grupo_exige_mensagem_ck/);
    await expect(q("UPDATE obra_notas SET grupo_id = NULL WHERE id = $1", [id])).rejects.toThrow(/obra_notas_grupo_exige_mensagem_ck/);
    await banco.pg.exec("ALTER TABLE obra_notas ENABLE TRIGGER obra_notas_guarda");
  });

  it("as duas guardas convivem: nota 'adn' aceita a conciliação (vínculo BPO) e recusa mexer no que foi lido", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [{ id }] = await q<{ id: number }>("SELECT id FROM obra_notas WHERE origem = 'adn'");
    await expect(q("UPDATE obra_notas SET valor_centavos = 1 WHERE id = $1", [id])).rejects.toThrow(/OBRA_NOTAS_IMUTAVEL/);
    await expect(q("UPDATE obra_notas SET nsu = 2 WHERE id = $1", [id])).rejects.toThrow(/OBRA_NOTAS_IMUTAVEL/);
    // campo que a 0128 deixa mudar (confirmação pendente → confirmada, com a data) passa pelas DUAS guardas
    await expect(q("UPDATE obra_notas SET confirmacao = 'confirmada', confirmacao_em = now() WHERE id = $1", [id])).resolves.toBeDefined();
    await expect(q("DELETE FROM obra_notas WHERE id = $1", [id])).rejects.toThrow(/OBRA_NOTAS_SEM_EXCLUSAO/);
    await expect(q("TRUNCATE obra_notas_adn")).rejects.toThrow(/OBRA_NOTAS_ADN_SOMENTE_INSERCAO/);
    await expect(q("TRUNCATE fiscal_distribuicao_estado")).rejects.toThrow(/FISCAL_DISTRIBUICAO_SEM_EXCLUSAO/);
  });

  it("leftJoin × innerJoin: para notas de grupo o resultado de notasDoBanco é o mesmo de antes", async () => {
    for (let i = 0; i < 5; i++) {
      const m = await mensagemDeGrupo(`J${i}`);
      await q("INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao) VALUES ($1, $2, $3, 'rascunho')", [m.grupoId, m.mensagemId, i % 2 ? 1 : null]);
    }
    const inner = await q<{ id: number }>("SELECT n.id FROM obra_notas n INNER JOIN dolores_grupo_mensagens m ON m.id = n.mensagem_id ORDER BY n.id DESC");
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    const linhas = await notasDoBanco(banco.db as never, {});
    expect(linhas.map(l => l.n.id)).toEqual(inner.map(r => r.id));
    expect(linhas.every(l => l.enviadaEm !== undefined)).toBe(true);
  });
});

// ── 2. Parser ──

describe("QA parser — XXE, tamanho, ambiente, tomador, textos", () => {
  it("DOCTYPE/ENTITY em qualquer caixa e posição são recusados; xmldom não resolve entidade externa", () => {
    for (const x of [
      `<?xml version="1.0"?><!doctype NFSe SYSTEM "http://x/evil.dtd">${FIXTURE.replace(/^<\?xml[^>]*\?>/, "")}`,
      FIXTURE.replace("<nNFSe>123</nNFSe>", "<nNFSe>123</nNFSe><!ENTITY x 'y'>"),
      `<!DoCtYpE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><NFSe/>`,
    ]) expect(lerNfseRecebida(x)).toMatchObject({ ok: false });
    // entidade não declarada não vira conteúdo
    const r = lerNfseRecebida(FIXTURE.replace("<xNome>Construtora Exemplo Ltda</xNome>", "<xNome>&xxe;</xNome>"));
    if (r.ok) expect(r.nota.emitente.nome ?? "").not.toMatch(/root:|passwd/);
  });

  it("tamanho: exatamente no limite passa pela checagem de tamanho; um a mais é recusado antes de qualquer parse", () => {
    const pad = (n: number) => FIXTURE + " ".repeat(n - FIXTURE.length);
    expect(lerNfseRecebida(pad(300_000))).toMatchObject({ ok: true });
    expect(lerNfseRecebida(pad(300_001))).toEqual({ ok: false, motivo: "xml_grande_demais" });
  });

  it("produção restrita, emitida pela própria empresa e de outro tomador não gravam; tomador sem documento também não", () => {
    expect(mapearNotaRecebida(ler(FIXTURE.replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO })).toMatchObject({ gravar: false });
    expect(mapearNotaRecebida(ler(FIXTURE.replace(`<CNPJ>${TOMADOR}</CNPJ>`, "")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO })).toMatchObject({ gravar: false, motivo: "outro_tomador" });
    expect(mapearNotaRecebida(ler(FIXTURE.replace(`<CNPJ>${TOMADOR}</CNPJ>`, "<CNPJ>44556677000187</CNPJ>")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO })).toMatchObject({ gravar: false, motivo: "outro_tomador" });
    // tomador com máscara no estado é normalizado
    expect(mapearNotaRecebida(ler(FIXTURE), { tomadorCnpj: "44.556.677/0001-86", nsu: 1, agora: AGORA, vinculo: SEM_VINCULO })).toMatchObject({ gravar: true });
  });

  it("chave: Id com letra fora das 14 posições, minúscula ou tamanho errado é recusado", () => {
    expect(lerNfseRecebida(FIXTURE.replace(`NFS${CHAVE_FIXTURE}`, `NFS${CHAVE_FIXTURE.slice(0, 49)}A`))).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(lerNfseRecebida(FIXTURE.replace(`NFS${CHAVE_FIXTURE}`, `NFS${CHAVE_FIXTURE.slice(0, 8)}ab${CHAVE_FIXTURE.slice(10)}`))).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(lerNfseRecebida(FIXTURE.replace(`NFS${CHAVE_FIXTURE}`, `NFS${CHAVE_FIXTURE}0`))).toEqual({ ok: false, motivo: "chave_invalida" });
  });

  it("CNPJ do emitente com DV errado não é gravado (vira dúvida, situação 'confira')", () => {
    const m = mapearNotaRecebida(ler(FIXTURE.split(`<CNPJ>${EMPREITEIRO}</CNPJ>`).join("<CNPJ>11222333000182</CNPJ>")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO });
    expect(m.gravar && m.linha).toMatchObject({ emitenteDocumento: null, emitenteCnpjAlfa: null, situacao: "confira" });
  });

  it("CORRIGIDO (médio): o NÚMERO da nota entra cru (sem numeroConferido das notas de grupo) — texto, HTML e conta bancária passam", () => {
    const m = mapearNotaRecebida(ler(FIXTURE.replace("<nNFSe>123</nNFSe>", "<nNFSe>&lt;b&gt;Ag 1234 CC 56789-0</nNFSe>")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO });
    if (!m.gravar) throw new Error("devia gravar");
    expect(m.linha.numero === null || /^[0-9A-Za-z./-]{1,30}$/.test(m.linha.numero)).toBe(true);
  });

  it("CORRIGIDO (baixo): marcação HTML no nome/descrição não é retirada (só escapada na tela)", () => {
    const m = mapearNotaRecebida(ler(FIXTURE.replace("Construtora Exemplo Ltda", "&lt;img src=x onerror=alert(1)&gt;")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO });
    if (!m.gravar) throw new Error("devia gravar");
    expect(m.linha.emitenteNome ?? "").not.toMatch(/[<>]/);
  });

  it("CORRIGIDO (baixo): XML sem tpAmb (ambiente desconhecido) é gravado como rascunho em vez de recusado", () => {
    const m = mapearNotaRecebida(ler(FIXTURE.replace("<tpAmb>1</tpAmb>", "")), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: SEM_VINCULO });
    expect(m.gravar).toBe(false);
  });
});

// ── 3. Captura ──

describe("QA captura — desligada, NSU, prazo, concorrência, log", () => {
  it("com o cliente registrado globalmente mas nenhum CNPJ ligado, não chama o cliente; NoCron nunca lança se o banco cair", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    const cliente = clienteFalso(3);
    registrarClienteDistribuicao(cliente);
    expect(await capturarRecebidasNoCron(db, 10_000)).toEqual({ executou: false, motivo: "nenhum_cnpj_ligado" });
    expect(cliente.buscarDesde).not.toHaveBeenCalled();
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const quebrado = () => { throw new Error(`banco fora ${TOMADOR}`); };
    expect(await capturarRecebidasNoCron(quebrado as never, 10_000, cliente)).toEqual({ erro: true });
    expect(JSON.stringify(erro.mock.calls)).not.toContain(TOMADOR);
    erro.mockRestore();
  });

  it("erro do ADN: o log não leva a mensagem (que pode ter CNPJ/CPF), só o nome do erro", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: async () => { throw new Error(`falhou para ${TOMADOR} cpf 529.982.247-25`); } };
    await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA });
    expect(JSON.stringify(erro.mock.calls)).not.toMatch(/44556677000186|529\.982/);
    erro.mockRestore();
  });

  it("NSU nunca volta: documentos com NSU <= último, NaN ou fracionário são descartados; erro no meio da página avança só até o último tratado", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada, ultimo_nsu) VALUES ($1, true, 10)", [TOMADOR]);
    let chamada = 0;
    const cliente: ClienteDistribuicaoAdn = {
      buscarDesde: async () => {
        chamada++;
        if (chamada > 1) return { documentos: [] };
        return { documentos: [
          { nsu: 5, xml: xmlDe(5) }, { nsu: Number.NaN, xml: xmlDe(6) }, { nsu: 11.5, xml: xmlDe(7) },
          { nsu: 11, xml: xmlDe(11) }, { nsu: 12, xml: xmlDe(12) },
          // XML que quebra a gravação (valor fora do CHECK não acontece pelo parser; usamos um getter que lança)
          Object.defineProperty({ nsu: 13 } as DocumentoDistribuido, "xml", { get() { throw new Error("quebra"); } }),
          { nsu: 14, xml: xmlDe(14) },
        ] };
      },
    };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA });
    erro.mockRestore();
    expect(r).toMatchObject({ gravadas: 2, erros: 1 });
    const [e] = await q<{ ultimo_nsu: number; ultimo_resultado: string }>("SELECT ultimo_nsu, ultimo_resultado FROM fiscal_distribuicao_estado");
    expect(e).toEqual({ ultimo_nsu: 12, ultimo_resultado: "erro" });
    expect((await q<{ nsu: number }>("SELECT nsu FROM obra_notas ORDER BY nsu")).map(x => Number(x.nsu))).toEqual([11, 12]);
  });

  it("idempotência sob concorrência na GRAVAÇÃO: 5 gravações simultâneas da mesma chave → 1 nota, 1 XML", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    const doc = { nsu: 1, chave: CHAVE_FIXTURE, xml: FIXTURE };
    const r = await Promise.all(Array.from({ length: 5 }, () => gravarNotaRecebida(db(), doc, { tomadorCnpj: TOMADOR, agora: AGORA })));
    expect(r.filter(x => x === "gravada")).toHaveLength(1);
    expect((await q<{ n: number }>("SELECT count(*)::int n FROM obra_notas"))[0].n).toBe(1);
    expect((await q<{ n: number }>("SELECT count(*)::int n FROM obra_notas_adn"))[0].n).toBe(1);
  });

  it("CORRIGIDO (médio): duas capturas simultâneas do mesmo CNPJ — a mais atrasada tenta voltar o NSU, o gatilho lança e a rodada termina em exceção", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const rapido = clienteFalso(150);
    let liberar!: () => void;
    const segura = new Promise<void>(r => { liberar = r; });
    const lentoBase = clienteFalso(150);
    const lento: ClienteDistribuicaoAdn = { buscarDesde: async p => { await segura; return lentoBase.buscarDesde(p); } };
    const pLento = capturarNotasRecebidas(db, { cliente: lento, prazoEm: Date.now() + 30_000, agora: AGORA });
    const rRapido = await capturarNotasRecebidas(db, { cliente: rapido, prazoEm: Date.now() + 30_000, agora: AGORA });
    expect(rRapido).toMatchObject({ gravadas: 150 });
    liberar();
    // esperado: a rodada atrasada termina sem exceção (só "ja_existia"), sem tentar escrever um NSU menor
    await expect(pLento).resolves.toMatchObject({ executou: true, gravadas: 0 });
    expect((await q<{ n: number }>("SELECT count(*)::int n FROM obra_notas"))[0].n).toBe(150);
  });

  it("CORRIGIDO (médio): cliente que ignora o AbortSignal estoura o prazo total (sem Promise.race / corte do lado de cá)", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const surdo: ClienteDistribuicaoAdn = { buscarDesde: () => new Promise(r => setTimeout(() => r({ documentos: [] }), 3_200)) };
    const prazoEm = Date.now() + 2_600;
    await capturarNotasRecebidas(db, { cliente: surdo, prazoEm, agora: AGORA });
    expect(Date.now()).toBeLessThanOrEqual(prazoEm);
  }, 10_000);

  it("CORRIGIDO (médio): documento ilegível avança o NSU e some sem rastro — a rodada fica 'ok'", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    let n = 0;
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: async () => (n++ ? { documentos: [] } : { documentos: [
      { nsu: 1, chave: "9".repeat(50), xml: xmlDe(1) }, // chave do ADN não confere com a do XML → ilegível
      { nsu: 2, xml: "<NFSe><infNFSe Id='lixo'/></NFSe>" },
    ] }) };
    const r = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA });
    expect(r).toMatchObject({ ilegiveis: 2 });
    const [e] = await q<{ ultimo_nsu: number; ultimo_resultado: string }>("SELECT ultimo_nsu, ultimo_resultado FROM fiscal_distribuicao_estado");
    expect(Number(e.ultimo_nsu)).toBe(2); // avançou (aceitável para não travar), mas…
    expect(e.ultimo_resultado).not.toBe("ok"); // …devia ficar marcado para o dono conferir
    expect(r).toMatchObject({ nsusIlegiveis: [1, 2] });
    expect((await q<{ nsus_ilegiveis: number[] }>("SELECT nsus_ilegiveis FROM fiscal_distribuicao_estado"))[0].nsus_ilegiveis).toEqual([1, 2]);
  });

  it("api/index.ts: a captura roda depois dos rascunhos, com teto de 10 s, e o modelo padrão continua com orçamento até 55 s", () => {
    const api = readFileSync(new URL("../../api/index.ts", import.meta.url), "utf8");
    const i1 = api.indexOf("gerarRascunhosNoCron(getDb, Math.min(15_000, 45_000");
    const i2 = api.indexOf("capturarRecebidasNoCron(getDb, Math.min(10_000, 45_000 - (Date.now() - inicio)))");
    const i3 = api.indexOf("garantirModeloPadraoNoCron(Math.min(10_000, 55_000", i2);
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect((api.match(/capturarRecebidasNoCron\(/g) ?? []).length).toBe(1); // só no cron lead-card-due
  });
});

// ── 4. Vínculo e conciliação ──

describe("QA vínculo e conciliação", () => {
  it("dois empreiteiros ativos com o mesmo documento, ambos com obra → sem vínculo nenhum", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await banco.pg.exec(`
      INSERT INTO users ("openId", name, role, active, "passwordHash", cpf) VALUES ('emp2', 'Clone', 'empreiteiro', true, 'hash', '11222333000181');
      INSERT INTO construction_projects (title, status, progress, contractor_user_id) VALUES ('Outra', 'in_progress', 0, 4);`);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    expect((await q("SELECT obra_id, empreiteiro_user_id, categoria, situacao FROM obra_notas"))[0]).toEqual({ obra_id: null, empreiteiro_user_id: null, categoria: null, situacao: "confira" });
  });

  it("CORRIGIDO (baixo): documento em dois usuários, mas só um com obra ativa → vincula a esse (a regra diz: dois usuários → nada)", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await banco.pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash", cpf) VALUES ('emp2', 'Clone', 'empreiteiro', true, 'hash', '11222333000181');`);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    expect((await q("SELECT obra_id, empreiteiro_user_id FROM obra_notas"))[0]).toEqual({ obra_id: null, empreiteiro_user_id: null });
  });

  it("nenhum lançamento do BPO é criado ou alterado pela captura inteira", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    await banco.pg.exec(`
      INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('Construtora Exemplo', '11.222.333/0001-81', 'Zé', '9999', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar)
        VALUES ((SELECT max(id) FROM bpo_clients), 'despesa', 'Medição', '1500.00', '0', '2026-11-12', true, '2026-11', false);`);
    const antes = await q("SELECT * FROM bpo_lancamentos ORDER BY id");
    const antesClientes = await q("SELECT * FROM bpo_clients ORDER BY id");
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    await capturarNotasRecebidas(db, { cliente: clienteFalso(60), prazoEm: Date.now() + 30_000, agora: AGORA });
    expect(await q("SELECT * FROM bpo_lancamentos ORDER BY id")).toEqual(antes);
    expect(await q("SELECT * FROM bpo_clients ORDER BY id")).toEqual(antesClientes);
    expect((await q<{ n: number }>("SELECT count(*)::int n FROM obra_notas WHERE bpo_lancamento_id IS NOT NULL"))[0].n).toBe(0);
    // e nada vai para a fila de aprovação nem para envio
    expect((await q<{ n: number }>("SELECT count(*)::int n FROM dolores_aprovacoes"))[0].n).toBe(0);
  });

  it("nota 'adn' não pode ser religada a grupo/mensagem (não vira mensagem de grupo nem resposta de empreiteiro)", async () => {
    await banco.pg.exec(MIGRACAO); await banco.pg.exec(MIGRACAO_0166()); await banco.pg.exec(MIGRACAO_0170());
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const m = await mensagemDeGrupo("X1");
    await expect(q("UPDATE obra_notas SET grupo_id = $1, mensagem_id = $2 WHERE origem = 'adn'", [m.grupoId, m.mensagemId])).rejects.toThrow();
    expect((await q("SELECT arquivo_sha256 FROM obra_notas WHERE origem = 'adn'"))[0].arquivo_sha256).toBeNull(); // proporSalvar recusa sem arquivo
  });
});

// ── 5. Validador único: as 4 cópias antigas × a nova ──

describe("QA validador único — equivalência com as cópias antigas; CPF intacto", () => {
  // cópias LITERAIS do código removido (53a2344)
  const antigoNotas = (d: string) => {
    if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
    const dv = (base: string, pesos: number[]) => { const s = pesos.reduce((t, p, i) => t + Number(base[i]) * p, 0) % 11; return s < 2 ? 0 : 11 - s; };
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(d, p1) === Number(d[12]) && dv(d, [6, ...p1]) === Number(d[13]);
  };
  const semMascara = (v: string) => v.replace(/[.\-/\s]/g, "").toUpperCase();
  const antigoContratos = (v: string) => {
    const cnpj = semMascara(v);
    if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
    const digito = (base: string, pesos: number[]) => { const resto = Array.from(base).reduce((t, c, i) => t + (c.charCodeAt(0) - 48) * pesos[i], 0) % 11; return resto < 2 ? 0 : 11 - resto; };
    return Number(cnpj[12]) === digito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) && Number(cnpj[13]) === digito(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  };

  it("milhares de entradas (válidas, DV errado, letras, máscara, repetidos, minúsculas): resultado idêntico", () => {
    let semente = 12345;
    const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alfabeto = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const casos: string[] = ["00000000000000", "11111111111111", "11.222.333/0001-81", "12.abc.345/01de-35", "12ABC34501DE35", "", " ", "1122233300018", "112223330001811"];
    for (let i = 0; i < 3000; i++) {
      const numerico = rnd() < 0.5;
      const base = Array.from({ length: 12 }, () => (numerico ? alfabeto[Math.floor(rnd() * 10)] : alfabeto[Math.floor(rnd() * 36)])).join("");
      const certo = base + digitosVerificadoresCnpj(base);
      casos.push(certo, certo.slice(0, 13) + ((Number(certo[13]) + 1) % 10), certo.toLowerCase());
    }
    for (const c of casos) {
      expect(cnpjDosContratos(c)).toBe(antigoContratos(c));
      expect(cnpjDasNotasDeGrupo(c)).toBe(antigoNotas(c));
      if (/^\d{14}$/.test(c)) expect(cnpjValido(c)).toBe(antigoNotas(c));
    }
  });

  it("CPF: nenhuma regra mudou (cpfValido das notas = isValidCPF com 11 dígitos)", () => {
    for (const c of ["52998224725", "52998224724", "11111111111", "529.982.247-25", "5299822472"]) {
      expect(cpfDasNotas(c)).toBe(/^\d{11}$/.test(c) && isValidCPF(c));
    }
  });
});
