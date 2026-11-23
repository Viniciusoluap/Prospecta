// EPIC-029 S-5b (22/11/2026) — correções da revisão independente do PR #315 (captura do ADN ainda DESLIGADA). Cada achado é
// reproduzido primeiro (o comportamento antigo) e depois conferido com a correção:
//   1. evento de cancelamento do ADN virava "ignorada" e o NSU avançava (cancelamento perdido);
//   2. a mesma nota por grupo e pelo ADN virava "duplicada" e travava o arquivo do grupo;
//   3. exceção ao gravar um documento travava o CNPJ para sempre;
//   4. GZip quebrado/acima do teto virava null, igual a "sem XML";
//   5. notas do ADN fora do contador "sem conciliação" da ronda.
// Migrações 0163 + 0166 aplicadas duas vezes no PGlite. Nenhum teste chama rede (vigia de fetch).
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { drizzle } from "drizzle-orm/pglite";
import { getDb } from "../db.js";
import { CENARIO, MIGRACAO_0166, MIGRACAO_0170, criarBanco } from "../dolores/testes-banco.js";
import { apontarNotas, cancelamentosSemNotaDoAdn, notasDoBanco, paraConciliar } from "../dolores/leitura/notas.js";
import { REGRAS } from "../dolores/avisos.js";
import { contarNotasDaRonda } from "../dolores/rondas.js";
import { gravarNota } from "../dolores/notas-obra.js";
import { prepararConciliarNota, prepararSalvarNota } from "../dolores/acoes/notas.js";
import { executarConciliarAprovado } from "../dolores/conciliacao.js";
import { apontarConciliacao, type LeituraConferida } from "../../shared/dolores/notas.js";
import {
  MAX_TENTATIVAS_POR_NSU, capturarNotasRecebidas, gravarNotaRecebida, registrarClienteDistribuicao, xmlDoArquivoAdn,
  type ClienteDistribuicaoAdn, type DocumentoDistribuido,
} from "./distribuicao.js";
import { MAX_CARACTERES_XML, lerEventoNfse } from "./nfse-recebida.js";

const MIGRACAO_0154 = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("./fixtures/nfse-nacional-recebida.xml", import.meta.url), "utf8");
const CHAVE = "21053022112223330001810000000000123261112345678901";
const TOMADOR = "44556677000186";
const EMPREITEIRO = "11222333000181";
const AGORA = new Date("2026-11-22T13:00:00Z");
const SHA = "a".repeat(64);

let banco: Awaited<ReturnType<typeof criarBanco>>;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await banco.pg.query<T>(sql, p)).rows;
const db = () => banco.db as never;
const ctx = {} as never;

/** Evento distribuído pelo ADN (leiaute nacional `evento/infEvento/pedRegEvento/infPedReg`). */
function eventoXml(o: { chave?: string; tipo?: string; tpAmb?: string | null; idPedido?: string; extra?: string; raiz?: "evento" | "pedRegEvento"; autor?: string } = {}) {
  const chave = o.chave ?? CHAVE;
  const tipo = o.tipo ?? "101101";
  const amb = o.tpAmb === null ? "" : `<tpAmb>${o.tpAmb ?? "1"}</tpAmb>`;
  const pedido = `<pedRegEvento versao="1.01"><infPedReg Id="${o.idPedido ?? `PRE${chave}${tipo}001`}">${amb}<verAplic>Emissor</verAplic>`
    + `<dhEvento>2026-11-15T10:00:00-03:00</dhEvento><CNPJAutor>${o.autor ?? EMPREITEIRO}</CNPJAutor><chNFSe>${chave}</chNFSe><nPedRegEvento>001</nPedRegEvento>`
    + `<e${tipo}><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissão</xMotivo></e${tipo}>${o.extra ?? ""}</infPedReg></pedRegEvento>`;
  if (o.raiz === "pedRegEvento") return `<?xml version="1.0" encoding="UTF-8"?>${pedido.replace("<pedRegEvento", '<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse"')}`;
  return `<?xml version="1.0" encoding="UTF-8"?><evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infEvento Id="EVT${chave}${tipo}001">`
    + `<verAplic>ADN</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-11-15T10:01:00-03:00</dhProc><nDFe>1</nDFe>${pedido}</infEvento></evento>`;
}

async function mensagemDeGrupo(externo: string) {
  const [g] = await q<{ id: number }>("SELECT id FROM dolores_grupos WHERE grupo_jid = '120363000000000001@g.us'");
  const grupoId = g?.id ?? (await q<{ id: number }>("INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, obra_id) VALUES ('inst', '120363000000000001@g.us', 'Obra Casa Ana', true, 1) RETURNING id"))[0].id;
  const [m] = await q<{ id: number }>("INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, texto) VALUES ($1, 'inst', $2, 'documento', 'nota') RETURNING id", [grupoId, externo]);
  return { grupoId, mensagemId: m.id };
}

/** Leitura (já conferida) de uma nota de grupo com o mesmo emitente e número da fixture do ADN. */
const leituraDoGrupo = (numero = "123"): LeituraConferida => ({
  situacao: "rascunho", tipo: "nfse", emitenteNome: "Construtora Exemplo Ltda", emitenteDocumento: EMPREITEIRO, numero, dataEmissao: "2026-11-10",
  valorCentavos: 150_000, descricao: "alvenaria", itens: [], chaveAcesso: null, categoria: "empreiteiro", etapa: null, confianca: {}, duvidas: [], alertas: [],
});

async function notaDeGrupo(externo: string, numero = "123", sha = SHA, o: Partial<LeituraConferida> = {}) {
  const { grupoId, mensagemId } = await mensagemDeGrupo(externo);
  return gravarNota({ grupoId, mensagemId, obraId: 1, sha256: sha, mime: "application/pdf", bytes: 1000, leitura: { ...leituraDoGrupo(numero), ...o }, modelo: "m", lidaEm: AGORA });
}

beforeEach(async () => {
  banco = await criarBanco();
  await banco.pg.exec(CENARIO);
  // as notas EMITIDAS (fiscal_notas, 0154, já em produção): o evento de cancelamento confere se a chave é de nota emitida
  await banco.pg.exec(MIGRACAO_0154);
  await banco.pg.exec(`
    INSERT INTO users ("openId", name, role, active, "passwordHash", cpf) VALUES ('emp', 'Construtora Exemplo', 'empreiteiro', true, 'hash', '${EMPREITEIRO}');
    UPDATE construction_projects SET contractor_user_id = 3 WHERE id IN (1, 2);`);
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  registrarClienteDistribuicao(null);
});

afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  await banco.pg.close();
});

// ── Migração 0166 ──

describe("migração 0166 — só aditiva, idempotente, linhas existentes intactas", () => {
  it("texto: sem DROP de tabela/coluna/constraint, sem UPDATE/DELETE de dados; reaplicar não muda nada", async () => {
    const texto = MIGRACAO_0166().split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(texto).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|FUNCTION)/i);
    expect(texto).not.toMatch(/^\s*(UPDATE|DELETE|TRUNCATE)\b/im);
    expect(texto).not.toMatch(/NOT\s+VALID|DROP NOT NULL|SET DEFAULT/i);
    const drops = [...texto.matchAll(/DROP TRIGGER IF EXISTS (\w+)/g)].map(m => m[1]);
    expect(drops).not.toContain("obra_notas_guarda");
    expect(drops).not.toContain("obra_notas_guarda_origem");
    await notaDeGrupo("ANTES");
    const antes = await q("SELECT * FROM obra_notas ORDER BY id");
    await banco.pg.exec(MIGRACAO_0166());
    expect(await q("SELECT * FROM obra_notas ORDER BY id")).toEqual(antes);
    expect(antes[0]).toMatchObject({ cancelada_em: null, cancelamento_tipo: null, outra_origem_de: null });
  });

  it("guardas: cancelamento só uma vez e nunca desfeito; nota cancelada não é ligada ao BPO; evento não muda nem é apagado", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    await expect(banco.pg.query("UPDATE obra_notas SET cancelada_em = now()")).rejects.toThrow(/obra_notas_cancelamento_ck/);
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("cancelamento");
    await expect(banco.pg.query("UPDATE obra_notas SET cancelada_em = NULL, cancelamento_tipo = NULL")).rejects.toThrow(/OBRA_NOTAS_CANCELADA/);
    await expect(banco.pg.query("UPDATE obra_notas SET cancelamento_tipo = '105102'")).rejects.toThrow(/OBRA_NOTAS_CANCELADA/);
    // a guarda da 0128 (aprovação do dono) fica de lado só aqui, para provar a guarda nova sozinha
    await banco.pg.exec(`INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('X', '1', 'Z', '9', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar) VALUES (1, 'despesa', 'x', '1500.00', '0', '2026-11-12', true, '2026-11', false);
      ALTER TABLE obra_notas DISABLE TRIGGER obra_notas_guarda;`);
    await expect(banco.pg.query("UPDATE obra_notas SET bpo_lancamento_id = 1")).rejects.toThrow(/nota cancelada não é ligada/);
    await banco.pg.exec("ALTER TABLE obra_notas ENABLE TRIGGER obra_notas_guarda;");
    await expect(banco.pg.query("UPDATE obra_notas_eventos_adn SET tipo_evento = '105102'")).rejects.toThrow(/OBRA_NOTAS_EVENTOS_IMUTAVEL/);
    await expect(banco.pg.query("UPDATE obra_notas_eventos_adn SET nota_id = NULL, casado_em = NULL")).rejects.toThrow(/OBRA_NOTAS_EVENTOS_CASADO/);
    await expect(banco.pg.query("DELETE FROM obra_notas_eventos_adn")).rejects.toThrow(/OBRA_NOTAS_EVENTOS_SEM_EXCLUSAO/);
  });
});

// ── Achado 1: cancelamento perdido ──

describe("achado 1 — evento de cancelamento do ADN", () => {
  it("leitor do evento: chave, tipo e ambiente; mesmas proteções do leitor da nota", () => {
    expect(lerEventoNfse(eventoXml())).toEqual({ ok: true, evento: { chave: CHAVE, tipo: "101101", ambiente: "producao", autor: EMPREITEIRO } });
    expect(lerEventoNfse(eventoXml({ raiz: "pedRegEvento", tipo: "105102" }))).toMatchObject({ ok: true, evento: { tipo: "105102" } });
    expect(lerEventoNfse(eventoXml({ tpAmb: "2" }))).toMatchObject({ ok: true, evento: { ambiente: "producao_restrita" } });
    expect(lerEventoNfse(eventoXml({ tpAmb: null }))).toMatchObject({ ok: true, evento: { ambiente: null } });
    expect(lerEventoNfse(`<!DOCTYPE x [<!ENTITY e "y">]>${eventoXml()}`)).toEqual({ ok: false, motivo: "xml_com_doctype" });
    expect(lerEventoNfse(eventoXml({ extra: "x".repeat(MAX_CARACTERES_XML) }))).toEqual({ ok: false, motivo: "xml_grande_demais" });
    expect(lerEventoNfse("<evento><infEvento>")).toEqual({ ok: false, motivo: "xml_invalido" });
    expect(lerEventoNfse("<Outro/>")).toEqual({ ok: false, motivo: "nao_e_evento" });
    expect(lerEventoNfse(eventoXml({ chave: "123" }))).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(lerEventoNfse(eventoXml({ idPedido: `PRE${CHAVE}105102001` }))).toEqual({ ok: false, motivo: "id_do_evento_nao_confere" });
    expect(lerEventoNfse(eventoXml({ extra: "<e105102/>" }))).toEqual({ ok: false, motivo: "tipo_do_evento_invalido" });
  });

  it("REPRODUZ: antes, o evento virava 'ignorada' e o NSU avançava; agora a nota já gravada fica CANCELADA e o evento casado", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, chave: CHAVE, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const r = await gravarNotaRecebida(db(), { nsu: 2, chave: CHAVE, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA });
    expect(r).not.toBe("ignorada");
    expect(r).toBe("cancelamento");
    const [n] = await q<{ id: number; cancelada_em: Date | null; cancelamento_tipo: string }>("SELECT id, cancelada_em, cancelamento_tipo FROM obra_notas");
    expect(n.cancelamento_tipo).toBe("101101");
    expect(n.cancelada_em).not.toBeNull();
    expect((await q("SELECT nota_id, tipo_evento, nsu::int FROM obra_notas_eventos_adn"))).toEqual([{ nota_id: n.id, tipo_evento: "101101", nsu: 2 }]);
    // o mesmo evento relido não duplica nem muda nada
    expect(await gravarNotaRecebida(db(), { nsu: 3, chave: CHAVE, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ja_existia");
    expect((await q("SELECT count(*)::int n FROM obra_notas_eventos_adn"))[0].n).toBe(1);
  });

  it("cancelamento que chega ANTES da nota fica guardado; a nota já nasce cancelada e o evento é casado", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("cancelamento");
    expect(await q("SELECT nota_id, casado_em FROM obra_notas_eventos_adn")).toEqual([{ nota_id: null, casado_em: null }]);
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [n] = await q<{ id: number; cancelamento_tipo: string; situacao: string; alertas: string[] }>("SELECT id, cancelamento_tipo, situacao, alertas FROM obra_notas");
    expect(n).toMatchObject({ cancelamento_tipo: "101101", situacao: "confira" });
    expect(n.alertas.join(" ")).toMatch(/CANCELADA/);
    expect((await q<{ nota_id: number }>("SELECT nota_id FROM obra_notas_eventos_adn"))[0].nota_id).toBe(n.id);
  });

  it("cancelada não é apontada/conciliada como válida (nem pela leitura, nem pela fila) e gera o aviso ao dono", async () => {
    await banco.pg.exec(`
      INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('Construtora Exemplo', '11.222.333/0001-81', 'Zé', '9999', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, pago_em, competencia, a_classificar, categoria_operacional, vinculo_operacional_id, tipo_despesa_obra)
        VALUES ((SELECT max(id) FROM bpo_clients), 'despesa', 'Medição 2', '1500.00', '0', '2026-11-12', true, '2026-11-12 12:00', '2026-11', false, 'obras', '1', 'empreiteiro');`);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [antes] = await notasDoBanco(banco.db as never, { abertas: true });
    expect((await apontarNotas(banco.db as never, [paraConciliar(antes.n)], 30)).get(antes.n.id)!.apontamento.situacao).toBe("ja_lancado");
    await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA });
    const [depois] = await notasDoBanco(banco.db as never, { abertas: true });
    expect((await apontarNotas(banco.db as never, [paraConciliar(depois.n)], 30)).get(depois.n.id)!.apontamento.situacao).toBe("cancelada");
    await expect(prepararConciliarNota({ notaId: depois.n.id }, ctx)).rejects.toThrow(/CANCELADA/);
    // já ligada a um pagamento: continua "cancelada" (o dono confere o pagamento)
    expect(apontarConciliacao({ ...paraConciliar(depois.n), bpoLancamentoId: 9 }, [], 30)).toMatchObject({ situacao: "cancelada", texto: expect.stringMatching(/#9/) });
    const coleta = await REGRAS.nota_obra({ agora: AGORA, limites: { notaConfirmacaoDias: 7 } as never });
    expect(coleta.achados).toEqual(expect.arrayContaining([expect.objectContaining({ entidade: `nota:${depois.n.id}:cancelada`, dados: expect.objectContaining({ marca: "cancelada" }) })]));
    expect(coleta.achados.filter(a => a.entidade.includes(":divergencia") || a.entidade.includes(":confirmacao"))).toEqual([]);
    // depois de 30 dias, o aviso sai
    const tarde = await REGRAS.nota_obra({ agora: new Date(Date.now() + 31 * 86_400_000), limites: { notaConfirmacaoDias: 7 } as never });
    expect(tarde.achados.filter(a => a.entidade.endsWith(":cancelada"))).toEqual([]);
  });

  it("o cancelamento vale também para a MESMA nota lida no grupo (a que seria conciliada)", async () => {
    const g = await notaDeGrupo("G1");
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA });
    expect(await q("SELECT origem, cancelamento_tipo FROM obra_notas ORDER BY id")).toEqual([
      { origem: "grupo", cancelamento_tipo: "101101" }, { origem: "adn", cancelamento_tipo: "101101" },
    ]);
    expect(g).toMatchObject({ duplicadaDe: null, outraOrigemDe: null });
  });

  it("a nota de grupo que chega DEPOIS da NFS-e já cancelada nasce cancelada (e não é conciliada)", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA });
    const g = await notaDeGrupo("G1");
    const [linha] = await q<{ cancelamento_tipo: string; situacao: string; outra_origem_de: number }>("SELECT cancelamento_tipo, situacao, outra_origem_de FROM obra_notas WHERE id = $1", [g!.id]);
    expect(linha).toMatchObject({ cancelamento_tipo: "101101", situacao: "confira" });
    await expect(prepararConciliarNota({ notaId: g!.id }, ctx)).rejects.toThrow(/CANCELADA|outra origem/);
  });

  it("evento de outro tipo, raiz desconhecida: NSU guardado para o dono conferir (não some); de teste: ignorado", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml({ tipo: "101103" }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("a_conferir");
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: "<Outro/>" }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("a_conferir");
    expect(await gravarNotaRecebida(db(), { nsu: 3, xml: eventoXml({ tpAmb: "2" }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ignorada");
    expect(await gravarNotaRecebida(db(), { nsu: 4, xml: eventoXml({ tpAmb: null }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ilegivel");
    expect(await gravarNotaRecebida(db(), { nsu: 5, chave: "9".repeat(50), xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ilegivel");
    expect((await q("SELECT count(*)::int n FROM obra_notas_eventos_adn"))[0].n).toBe(0);
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const docs: DocumentoDistribuido[] = [{ nsu: 1, xml: eventoXml({ tipo: "101103" }) }, { nsu: 2, xml: "<Outro/>" }, { nsu: 3, xml: FIXTURE }, { nsu: 4, xml: eventoXml() }];
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: vi.fn(async ({ ultimoNsu }) => ({ documentos: docs.filter(d => d.nsu > ultimoNsu) })) };
    const r = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA });
    expect(r).toMatchObject({ aConferir: 2, nsusAConferir: [1, 2], gravadas: 1, cancelamentos: 1, ignoradas: 0 });
    expect((await q("SELECT ultimo_nsu::int, ultimo_resultado, nsus_a_conferir FROM fiscal_distribuicao_estado"))[0])
      .toEqual({ ultimo_nsu: 4, ultimo_resultado: "parcial", nsus_a_conferir: [1, 2] });
  });
});

// ── Achado 2: mesma nota por outra origem ──

describe("achado 2 — a mesma nota pelo grupo e pelo ADN não trava o arquivo", () => {
  it("REPRODUZ: NFS-e do ADN antes, nota do grupo depois → antes 'duplicada' (sem Drive); agora 'outra origem' e o arquivo pode ir ao Drive", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [adn] = await q<{ id: number }>("SELECT id FROM obra_notas WHERE origem = 'adn'");
    const g = await notaDeGrupo("G1");
    expect(g).toEqual({ id: expect.any(Number), duplicadaDe: null, outraOrigemDe: adn.id });
    const [linha] = await q<{ duplicada_de: number | null; outra_origem_de: number; situacao: string; alertas: string[] }>("SELECT duplicada_de, outra_origem_de, situacao, alertas FROM obra_notas WHERE id = $1", [g!.id]);
    expect(linha).toMatchObject({ duplicada_de: null, outra_origem_de: adn.id, situacao: "rascunho" });
    expect(linha.alertas.join(" ")).toMatch(/mesma nota já recebida pelo ADN/);
    const preparo = await prepararSalvarNota({ notaId: g!.id }, ctx);
    expect(preparo.itens).toHaveLength(1);
    // só uma das duas é conciliada: a da outra origem é recusada
    await expect(prepararConciliarNota({ notaId: g!.id }, ctx)).rejects.toThrow(/outra origem/);
  });

  it("nota do grupo antes, NFS-e do ADN depois → a do ADN é 'outra origem' (não duplicada), a do grupo continua salvável", async () => {
    const g = await notaDeGrupo("G1");
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    expect(await q("SELECT duplicada_de, outra_origem_de FROM obra_notas WHERE origem = 'adn'")).toEqual([{ duplicada_de: null, outra_origem_de: g!.id }]);
    expect((await prepararSalvarNota({ notaId: g!.id }, ctx)).itens).toHaveLength(1);
  });

  it("duplicata REAL dentro da mesma origem continua protegida (grupo × grupo e ADN × ADN)", async () => {
    const g1 = await notaDeGrupo("G1");
    const g2 = await notaDeGrupo("G2", "000123", "c".repeat(64));
    expect(g2).toMatchObject({ duplicadaDe: g1!.id, outraOrigemDe: null });
    await expect(prepararSalvarNota({ notaId: g2!.id }, ctx)).rejects.toThrow(/repete a nota/);
    // duas NFS-e do ADN com chaves diferentes e o mesmo emitente + número: a segunda é duplicada da primeira (nunca "outra origem")
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const outraChave = FIXTURE.replace(CHAVE, `${CHAVE.slice(0, 40)}9999999999`);
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: outraChave }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const adn = await q<{ id: number; duplicada_de: number | null; outra_origem_de: number | null }>("SELECT id, duplicada_de, outra_origem_de FROM obra_notas WHERE origem = 'adn' ORDER BY id");
    expect(adn[0]).toMatchObject({ duplicada_de: null, outra_origem_de: g1!.id });
    expect(adn[1]).toMatchObject({ duplicada_de: adn[0].id, outra_origem_de: null });
  });
});

// ── Achados 3 e 4: exceção que travava o CNPJ; GZip quebrado igual a "sem XML" ──

describe("achado 3 — exceção ao gravar não trava o CNPJ para sempre", () => {
  it("REPRODUZ: o NSU com exceção parava a captura; agora é registrado e, na 3ª tentativa, vai para os ilegíveis e a captura segue", async () => {
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada, ultimo_nsu) VALUES ($1, true, 10)", [TOMADOR]);
    const quebrado = Object.defineProperty({ nsu: 11 } as DocumentoDistribuido, "xml", { get() { throw new Error("quebra"); } });
    const docs: DocumentoDistribuido[] = [quebrado, { nsu: 12, xml: FIXTURE }];
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: vi.fn(async ({ ultimoNsu }) => ({ documentos: docs.filter(d => d.nsu > ultimoNsu) })) };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const estado = async () => (await q<Record<string, unknown>>("SELECT ultimo_nsu::int, ultimo_resultado, nsu_com_falha::int, tentativas_nsu_com_falha, nsus_ilegiveis FROM fiscal_distribuicao_estado"))[0];
    for (let i = 1; i < MAX_TENTATIVAS_POR_NSU; i++) {
      expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ erros: 1, gravadas: 0 });
      expect(await estado()).toEqual({ ultimo_nsu: 10, ultimo_resultado: "erro", nsu_com_falha: 11, tentativas_nsu_com_falha: i, nsus_ilegiveis: [] });
    }
    const r = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA });
    erro.mockRestore();
    expect(r).toMatchObject({ erros: 0, ilegiveis: 1, nsusIlegiveis: [11], gravadas: 1 });
    expect(await estado()).toEqual({ ultimo_nsu: 12, ultimo_resultado: "parcial", nsu_com_falha: null, tentativas_nsu_com_falha: 0, nsus_ilegiveis: [11] });
    expect(JSON.stringify(erro.mock.calls)).not.toMatch(/44556677000186/);
  });
});

describe("achado 4 — arquivo que não abre é ilegível, não 'sem XML'", () => {
  it("REPRODUZ: GZip quebrado e acima do teto voltavam null; agora voltam ilegível e entram na lista do dono", async () => {
    expect(xmlDoArquivoAdn("isto não é gzip")).toEqual({ ilegivel: "gzip_invalido" });
    expect(xmlDoArquivoAdn(gzipSync(Buffer.alloc(MAX_CARACTERES_XML * 4 + 10, 0x41)).toString("base64"))).toEqual({ ilegivel: "grande_demais" });
    expect(xmlDoArquivoAdn(gzipSync(Buffer.from(FIXTURE)).toString("base64"))).toBe(FIXTURE);
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const docs: DocumentoDistribuido[] = [{ nsu: 1, xml: xmlDoArquivoAdn("quebrado") }, { nsu: 2, xml: null }];
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: vi.fn(async ({ ultimoNsu }) => ({ documentos: docs.filter(d => d.nsu > ultimoNsu) })) };
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ ilegiveis: 1, nsusIlegiveis: [1], ignoradas: 1 });
  });
});

// ── Achado 5: contador da ronda ──

describe("achado 5 — notas do ADN no contador 'sem conciliação' da ronda", () => {
  it("REPRODUZ: a NFS-e do ADN pendente não contava; agora conta (a cancelada e a da outra origem, não)", async () => {
    expect(await contarNotasDaRonda(banco.db as never)).toMatchObject({ totais: { notas: { confirmadasSemConciliacao: 0 } } });
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    expect(await contarNotasDaRonda(banco.db as never)).toMatchObject({ totais: { notas: { confirmadasSemConciliacao: 1, semConfirmacao: 0 } } });
    // a mesma nota lida no grupo (outra origem) não conta de novo
    await notaDeGrupo("G1");
    await banco.pg.exec("UPDATE obra_notas SET confirmacao = 'confirmada', confirmacao_em = now() WHERE origem = 'grupo'");
    expect(await contarNotasDaRonda(banco.db as never)).toMatchObject({ totais: { notas: { confirmadasSemConciliacao: 1 } } });
    await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA });
    expect(await contarNotasDaRonda(banco.db as never)).toMatchObject({ totais: { notas: { confirmadasSemConciliacao: 0 } } });
  });
});

// ── Portão de QA da S-5b (CONCERNS): valor/data entre origens, todos os eventos casados, evento sem nota visível ──

describe("QA S-5b — mesma nota por outra origem com valor/data diferentes", () => {
  const conciliacaoDe = async (id: number) => {
    const [l] = await notasDoBanco(banco.db as never, { ids: [id] });
    return (await apontarNotas(banco.db as never, [paraConciliar(l.n)], 30)).get(id)!.apontamento.situacao;
  };

  it("ADN depois do grupo, valor diferente: a oficial fica 'confira' com o alerta e passa a ser a conciliada; a do grupo vira 'outra origem' (arquivo continua salvável)", async () => {
    const g = await notaDeGrupo("G1", "123", SHA, { valorCentavos: 950_000 });
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [adn] = await q<{ id: number; situacao: string; alertas: string[]; outra_origem_de: number | null }>("SELECT id, situacao, alertas, outra_origem_de FROM obra_notas WHERE origem = 'adn'");
    expect(adn).toMatchObject({ situacao: "confira", outra_origem_de: null });
    expect(adn.alertas.join(" ")).toMatch(/DIVERGE da nota \d+ lida no grupo \(valor: oficial R\$\s1\.500,00 × grupo R\$\s9\.500,00\)/);
    expect((await q("SELECT outra_origem_de FROM obra_notas WHERE id = $1", [g!.id]))[0].outra_origem_de).toBe(adn.id);
    expect(await conciliacaoDe(g!.id)).toBe("outra_origem");
    expect(await conciliacaoDe(adn.id)).not.toBe("outra_origem");
    expect((await prepararSalvarNota({ notaId: g!.id }, ctx)).itens).toHaveLength(1);
    const coleta = await REGRAS.nota_obra({ agora: AGORA, limites: { notaConfirmacaoDias: 7 } as never });
    expect(coleta.achados.filter(a => a.entidade.endsWith(":origem_divergente")).map(a => a.entidade)).toEqual([`nota:${adn.id}:origem_divergente`]);
  });

  it("data diferente também diverge; a do grupo já conciliada: a oficial fica 'outra origem' + 'confira' (o dono confere o pagamento)", async () => {
    const g = await notaDeGrupo("G1", "123", SHA, { dataEmissao: "2026-11-01" });
    await banco.pg.exec(`INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('X', '1', 'Z', '9', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar) VALUES (1, 'despesa', 'x', '1500.00', '0', '2026-11-12', true, '2026-11', false);
      ALTER TABLE obra_notas DISABLE TRIGGER obra_notas_guarda; UPDATE obra_notas SET bpo_lancamento_id = 1; ALTER TABLE obra_notas ENABLE TRIGGER obra_notas_guarda;`);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [adn] = await q<{ situacao: string; alertas: string[]; outra_origem_de: number }>("SELECT situacao, alertas, outra_origem_de FROM obra_notas WHERE origem = 'adn'");
    expect(adn).toMatchObject({ situacao: "confira", outra_origem_de: g!.id });
    expect(adn.alertas.join(" ")).toMatch(/data de emissão: oficial 10\/11\/2026 × grupo 01\/11\/2026.*confira esse pagamento/);
    expect((await q("SELECT outra_origem_de FROM obra_notas WHERE id = $1", [g!.id]))[0].outra_origem_de).toBeNull();
  });

  it("grupo depois do ADN, valor diferente: a do grupo fica 'confira' com o alerta; a conciliação fica na oficial", async () => {
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [adn] = await q<{ id: number }>("SELECT id FROM obra_notas WHERE origem = 'adn'");
    const g = await notaDeGrupo("G1", "123", SHA, { valorCentavos: 100 });
    const [linha] = await q<{ situacao: string; alertas: string[] }>("SELECT situacao, alertas FROM obra_notas WHERE id = $1", [g!.id]);
    expect(g).toMatchObject({ outraOrigemDe: adn.id });
    expect(linha.situacao).toBe("confira");
    expect(linha.alertas.join(" ")).toMatch(/DIVERGE da nota oficial \d+ recebida pelo ADN \(valor: oficial R\$\s1\.500,00 × grupo R\$\s1,00\)/);
    expect(await conciliacaoDe(g!.id)).toBe("outra_origem");
  });

  it("sem divergência segue como antes (ADN é a outra origem, sem alerta de divergência nem aviso)", async () => {
    const g = await notaDeGrupo("G1");
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [adn] = await q<{ situacao: string; alertas: string[]; outra_origem_de: number }>("SELECT situacao, alertas, outra_origem_de FROM obra_notas WHERE origem = 'adn'");
    expect(adn).toMatchObject({ situacao: "rascunho", outra_origem_de: g!.id });
    expect(adn.alertas.join(" ")).not.toMatch(/DIVERGE/);
    const coleta = await REGRAS.nota_obra({ agora: AGORA, limites: { notaConfirmacaoDias: 7 } as never });
    expect(coleta.achados.filter(a => a.entidade.endsWith(":origem_divergente"))).toEqual([]);
  });

  it("gatilho: a única troca de outra_origem_de aceita é grupo (sem vínculo, não conciliado) → NFS-e oficial do ADN", async () => {
    const g = await notaDeGrupo("G1", "123", SHA, { valorCentavos: 950_000 });
    const g2 = await notaDeGrupo("G2", "777", "b".repeat(64));
    await expect(q("UPDATE obra_notas SET outra_origem_de = $2 WHERE id = $1", [g!.id, g2!.id])).rejects.toThrow(/OBRA_NOTAS_VINCULO/);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [adn] = await q<{ id: number }>("SELECT id FROM obra_notas WHERE origem = 'adn'");
    // já ligada: não troca; e outra nota de grupo não pode apontar para a oficial que já tem par... só sem vínculo e não duplicada
    await expect(q("UPDATE obra_notas SET outra_origem_de = NULL WHERE id = $1", [g!.id])).resolves.toBeTruthy();
    await expect(q("UPDATE obra_notas SET outra_origem_de = $2 WHERE id = $1", [adn.id, g!.id])).rejects.toThrow(/OBRA_NOTAS_VINCULO/);
    await expect(q("UPDATE obra_notas SET outra_origem_de = $2 WHERE id = $1", [g2!.id, adn.id])).resolves.toBeTruthy();
    await expect(q("UPDATE obra_notas SET outra_origem_de = $2 WHERE id = $1", [g2!.id, g!.id])).rejects.toThrow(/OBRA_NOTAS_VINCULO/);
  });
});

describe("QA S-5b — eventos pendentes: todos casados; sem nota há mais de 7 dias, visíveis ao dono", () => {
  it("dois cancelamentos antes da nota: os dois são casados", async () => {
    await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml() }, { tomadorCnpj: TOMADOR, agora: AGORA });
    await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml({ tipo: "305101" }) }, { tomadorCnpj: TOMADOR, agora: AGORA });
    expect(await gravarNotaRecebida(db(), { nsu: 3, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    expect(await q("SELECT tipo_evento, nota_id IS NOT NULL casado FROM obra_notas_eventos_adn ORDER BY id")).toEqual([
      { tipo_evento: "101101", casado: true }, { tipo_evento: "305101", casado: true },
    ]);
    expect((await q("SELECT cancelamento_tipo FROM obra_notas"))[0].cancelamento_tipo).toBe("101101");
  });

  it("evento sem nota há mais de 7 dias: aviso (só a quantidade) e lista na leitura (NSU, tipo e data — sem chave nem CNPJ)", async () => {
    const outra = `${CHAVE.slice(0, 40)}5555555555`;
    await gravarNotaRecebida(db(), { nsu: 9, xml: eventoXml({ chave: outra }) }, { tomadorCnpj: TOMADOR, agora: AGORA });
    const cedo = await REGRAS.nota_obra({ agora: AGORA, limites: { notaConfirmacaoDias: 7 } as never });
    expect(cedo.achados.filter(a => a.entidade === "eventos_adn:sem_nota")).toEqual([]);
    expect(await cancelamentosSemNotaDoAdn(banco.db as never, AGORA)).toEqual([]);
    const depois = new Date(AGORA.getTime() + 8 * 86_400_000);
    const coleta = await REGRAS.nota_obra({ agora: depois, limites: { notaConfirmacaoDias: 7 } as never });
    const achado = coleta.achados.filter(a => a.entidade === "eventos_adn:sem_nota");
    expect(achado).toEqual([expect.objectContaining({ dados: expect.objectContaining({ quantidade: 1, marca: "evento_sem_nota" }) })]);
    const lista = await cancelamentosSemNotaDoAdn(banco.db as never, depois);
    expect(lista).toEqual([expect.objectContaining({ nsu: 9, tipoEvento: "101101" })]);
    for (const sensivel of [outra, EMPREITEIRO, TOMADOR]) expect(JSON.stringify([achado, lista])).not.toContain(sensivel);
  });
});

// ── Ponto de atenção do portão: conciliação × chegada da oficial divergente, com a mesma trava ──

describe("QA S-5b — conciliar a nota de grupo × NFS-e oficial divergente: nunca as duas conciliáveis", () => {
  async function aprovacao(): Promise<number> {
    return (await q<{ id: number }>(`INSERT INTO dolores_aprovacoes (codigo, vence_em, funcao, alvo, argumentos, resumo) VALUES ('C' || floor(random()*100000)::int, now() + interval '1 day', 'conciliar_nota_obra', 'nota:c:' || floor(random()*1000000)::int, '{}', 'x') RETURNING id`))[0].id;
  }
  async function lancamento(): Promise<number> {
    await banco.pg.exec(`INSERT INTO bank_accounts (banco, conta) VALUES ('Banco', '1') ON CONFLICT DO NOTHING;
      INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo) VALUES (1, '2026-11-12', 'PIX', '-1500.00', 'debito');
      INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('Construtora Exemplo', '11.222.333/0001-81', 'Zé', '9999', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, pago_em, competencia, a_classificar, categoria_operacional, vinculo_operacional_id, tipo_despesa_obra, bank_transaction_id)
        VALUES ((SELECT max(id) FROM bpo_clients), 'despesa', 'Medição 2', '1500.00', '0', '2026-11-12', true, '2026-11-12 12:00', '2026-11', false, 'obras', '1', 'empreiteiro', (SELECT max(id) FROM bank_transactions));`);
    return (await q<{ id: number }>("SELECT max(id)::int id FROM bpo_lancamentos"))[0].id;
  }
  // nota de grupo com a data lida diferente da oficial (mesmo valor): conciliável, e a oficial que chegar diverge
  const preparar = async () => ({ lanc: await lancamento(), g: (await notaDeGrupo("G1", "123", SHA, { dataEmissao: "2026-11-08" }))! });
  const conciliar = async (notaId: number, lanc: number) => executarConciliarAprovado({ notaId, obraId: 1, valorCentavos: 150_000, lancamentoId: lanc },
    { aprovacaoId: await aprovacao(), agora: AGORA, autorId: 1, mensagemId: null, pedidoId: null } as never);
  const chegaOficial = () => gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA });
  /** Quantas das duas ainda podem ser (ou já foram) conciliadas: nunca mais de uma. */
  async function conciliaveis() {
    const linhas = await q<{ id: number; origem: string; outra_origem_de: number | null; bpo_lancamento_id: number | null }>("SELECT id, origem, outra_origem_de, bpo_lancamento_id FROM obra_notas ORDER BY id");
    return linhas.filter(l => l.outra_origem_de === null);
  }

  it("conciliar ANTES: a do grupo fica ligada e a oficial nasce 'outra origem' (o dono confere o pagamento)", async () => {
    const { lanc, g } = await preparar();
    expect(await conciliar(g.id, lanc)).toMatchObject({ resumo: { conciliada: true } });
    expect(await chegaOficial()).toBe("gravada");
    const c = await conciliaveis();
    expect(c.map(l => l.id)).toEqual([g.id]);
    const [adn] = await q<{ id: number; alertas: string[] }>("SELECT id, alertas FROM obra_notas WHERE origem = 'adn'");
    expect(adn.alertas.join(" ")).toMatch(/já foi ligada a um pagamento/);
    await expect(prepararConciliarNota({ notaId: adn.id }, ctx)).rejects.toThrow(/outra origem/);
  });

  it("oficial ANTES: a conciliação da do grupo (já aprovada) é recusada; só a oficial fica conciliável", async () => {
    const { lanc, g } = await preparar();
    expect(await chegaOficial()).toBe("gravada");
    await expect(conciliar(g.id, lanc)).rejects.toThrow(/outra origem/);
    const c = await conciliaveis();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ origem: "adn", bpo_lancamento_id: null });
    expect((await q("SELECT bpo_lancamento_id FROM obra_notas WHERE id = $1", [g.id]))[0].bpo_lancamento_id).toBeNull();
  });

  it("ao MESMO tempo (4 rodadas, as duas ordens): sempre uma só conciliável, e nunca a do grupo ligada com a oficial livre", async () => {
    for (let i = 0; i < 4; i++) {
      if (i) {
        await banco.pg.close();
        banco = await criarBanco();
        await banco.pg.exec(CENARIO);
        await banco.pg.exec(MIGRACAO_0154);
        await banco.pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash", cpf) VALUES ('emp', 'Construtora Exemplo', 'empreiteiro', true, 'hash', '${EMPREITEIRO}');
          UPDATE construction_projects SET contractor_user_id = 3 WHERE id IN (1, 2);`);
        vi.mocked(getDb).mockReturnValue(banco.db as never);
      }
      const { lanc, g } = await preparar();
      const tarefas = i % 2 ? [conciliar(g.id, lanc), chegaOficial()] : [chegaOficial(), conciliar(g.id, lanc)];
      const r = await Promise.allSettled(tarefas);
      expect(r.map(x => x.status)).toContain("fulfilled");
      const c = await conciliaveis();
      expect(c).toHaveLength(1);
      const ligadas = (await q<{ n: number }>("SELECT count(*)::int n FROM obra_notas WHERE bpo_lancamento_id IS NOT NULL"))[0].n;
      expect(ligadas).toBeLessThanOrEqual(1);
      if (ligadas) expect(c[0]).toMatchObject({ id: g.id, bpo_lancamento_id: lanc });
    }
  }, 180_000);

  it("a trava 250005 é pega ANTES de ler a nota, no preparo e na execução", async () => {
    const { lanc, g } = await preparar();
    // o mesmo banco com um registro de cada SQL, na ordem em que saem
    const consultas: string[] = [];
    vi.mocked(getDb).mockReturnValue(drizzle(banco.pg, { logger: { logQuery: (texto: string) => { consultas.push(texto); } } }) as never);
    await prepararConciliarNota({ notaId: g.id }, ctx).catch(() => undefined);
    await conciliar(g.id, lanc);
    const trava = (desde: number) => consultas.findIndex((c, i) => i >= desde && /pg_advisory_xact_lock/.test(c));
    const leNota = (desde: number) => consultas.findIndex((c, i) => i >= desde && /from "obra_notas"/i.test(c));
    const t1 = trava(0);
    expect(t1).toBeGreaterThanOrEqual(0);
    expect(t1).toBeLessThan(leNota(0));
    const t2 = trava(t1 + 1);
    expect(t2).toBeGreaterThan(t1);
    expect(t2).toBeLessThan(leNota(t2));
  });
});

// ── Revisão do Codex (#318): cancelamento de nota EMITIDA pela empresa; janela do aviso de divergência ──

describe("Codex #318 — evento de nota EMITIDA pela própria empresa não vira 'nota recebida faltando'", () => {
  const OITO_DIAS = new Date(AGORA.getTime() + 8 * 86_400_000);
  const semNotaNoAviso = async (agora: Date) => (await REGRAS.nota_obra({ agora, limites: { notaConfirmacaoDias: 7 } as never })).achados.filter(a => a.entidade === "eventos_adn:sem_nota");

  it("REPRODUZ: autor do cancelamento = CNPJ consultado → guardado como 'emitida', fora da lista e do aviso mesmo depois de 7 dias", async () => {
    const minha = `${CHAVE.slice(0, 40)}7777777777`;
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml({ chave: minha, autor: TOMADOR }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("cancelamento");
    expect(await q("SELECT papel, nota_id FROM obra_notas_eventos_adn")).toEqual([{ papel: "emitida", nota_id: null }]);
    expect(await semNotaNoAviso(OITO_DIAS)).toEqual([]);
    expect(await cancelamentosSemNotaDoAdn(banco.db as never, OITO_DIAS)).toEqual([]);
    // o de nota RECEBIDA (autor = o emitente terceiro) continua aparecendo
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: eventoXml({ chave: `${CHAVE.slice(0, 40)}8888888888` }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("cancelamento");
    expect(await semNotaNoAviso(OITO_DIAS)).toEqual([expect.objectContaining({ dados: expect.objectContaining({ quantidade: 1 }) })]);
    expect(await cancelamentosSemNotaDoAdn(banco.db as never, OITO_DIAS)).toEqual([expect.objectContaining({ nsu: 2 })]);
  });

  it("inscrição federal da chave = CNPJ consultado (sem autor no XML) → 'emitida'; cancelamento gerado pela Sefin (105102) também", async () => {
    const minha = `2105302${"2"}${"2"}${TOMADOR}${"0".repeat(27)}`;
    expect(minha).toHaveLength(50);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml({ chave: minha, tipo: "105102", autor: "00000000000000" }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("cancelamento");
    expect((await q("SELECT papel FROM obra_notas_eventos_adn"))[0].papel).toBe("emitida");
  });

  it("chave que já está nas notas EMITIDAS (fiscal_notas) → 'emitida', mesmo com outro autor (município, de ofício)", async () => {
    const minha = `${CHAVE.slice(0, 40)}6666666666`;
    await q(`INSERT INTO fiscal_notas (emissor_id, origem_tipo, origem_id, data_evento, status, chave_acesso) VALUES (NULL, 'bpo_lancamento', 1, '2026-11-10', 'A_DECIDIR', $1)`, [minha]); // a emissão real (EMITIDA) ainda está travada pela S-4
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml({ chave: minha, tipo: "305101", autor: "99887766000105" }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("cancelamento");
    expect((await q("SELECT papel FROM obra_notas_eventos_adn"))[0].papel).toBe("emitida");
  });

  it("0170: papel não muda, evento emitido não é casado com nota recebida; reaplicar não muda nada", async () => {
    await gravarNotaRecebida(db(), { nsu: 1, xml: eventoXml({ chave: `${CHAVE.slice(0, 40)}7777777777`, autor: TOMADOR }) }, { tomadorCnpj: TOMADOR, agora: AGORA });
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [nota] = await q<{ id: number }>("SELECT id FROM obra_notas");
    await expect(q("UPDATE obra_notas_eventos_adn SET papel = 'recebida'")).rejects.toThrow(/OBRA_NOTAS_EVENTOS_IMUTAVEL/);
    await expect(q("UPDATE obra_notas_eventos_adn SET nota_id = $1, casado_em = now()", [nota.id])).rejects.toThrow(/nota emitida não é casado/);
    const antes = await q("SELECT * FROM obra_notas_eventos_adn ORDER BY id");
    await banco.pg.exec(MIGRACAO_0170());
    expect(await q("SELECT * FROM obra_notas_eventos_adn ORDER BY id")).toEqual(antes);
  });
});

describe("Codex #318 — janela do aviso 'origem_divergente' conta da nota mais nova do par", () => {
  it("REPRODUZ: nota de grupo antiga (40 dias) + oficial divergente que chega hoje → o aviso aparece (antes sumia na hora)", async () => {
    await notaDeGrupo("G1", "123", SHA, { valorCentavos: 950_000 });
    await banco.pg.exec("ALTER TABLE obra_notas DISABLE TRIGGER obra_notas_guarda; UPDATE obra_notas SET criado_em = now() - interval '40 days'; ALTER TABLE obra_notas ENABLE TRIGGER obra_notas_guarda;");
    const agora = new Date();
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora })).toBe("gravada");
    const [adn] = await q<{ id: number }>("SELECT id FROM obra_notas WHERE origem = 'adn'");
    const achados = async (quando: Date) => (await REGRAS.nota_obra({ agora: quando, limites: { notaConfirmacaoDias: 7 } as never })).achados.filter(a => a.entidade.endsWith(":origem_divergente"));
    expect((await achados(agora)).map(a => a.entidade)).toEqual([`nota:${adn.id}:origem_divergente`]);
    // e sai 30 dias depois do vínculo
    expect(await achados(new Date(agora.getTime() + 31 * 86_400_000))).toEqual([]);
  });
});
