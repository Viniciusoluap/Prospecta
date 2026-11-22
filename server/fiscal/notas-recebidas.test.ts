// EPIC-029 S-5 (22/11/2026) — NFS-e RECEBIDAS como origem 'adn' de "obra_notas": migração 0163 aditiva (aplicada 2× no
// PGlite), regras antigas da origem 'grupo' intactas, CNPJ alfanumérico, leitura do XML nacional por fixture, vínculo por
// CNPJ, idempotência por chave, último NSU, espera de 1 h depois de consulta vazia, captura desligada sem chamar nada e
// conciliação com o BPO que só aponta. Nenhum teste chama rede (vigia de fetch); nada aqui toca banco real.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CENARIO, criarBanco } from "../dolores/testes-banco.js";
import { apontarNotas, documentoDoFornecedor, notasDoBanco, paraConciliar } from "../dolores/leitura/notas.js";
import { cnpjValido as cnpjDosContratos } from "../../shared/contratos/modelos.js";
import { cnpjValido as cnpjDasNotasDeGrupo, documentoConferido } from "../../shared/dolores/notas.js";
import { cnpjValido, cpfValido, digitosVerificadoresCnpj, documentoFiscalConferido } from "../../shared/fiscal/documento.js";
import { cnpjParaConsulta } from "../../shared/consulta-cadastral.js";
import {
  ESPERA_DEPOIS_DE_CONSULTA_VAZIA_MS, capturarNotasRecebidas, capturarRecebidasNoCron, gravarNotaRecebida, registrarClienteDistribuicao,
  xmlDoArquivoAdn, type ClienteDistribuicaoAdn, type DocumentoDistribuido,
} from "./distribuicao.js";
import { centavosDoXml, lerNfseRecebida, mapearNotaRecebida, vincularPorDocumento } from "./nfse-recebida.js";

const MIGRACAO = readFileSync(new URL("../../drizzle/0163_obra_notas_origem_adn.sql", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("./fixtures/nfse-nacional-recebida.xml", import.meta.url), "utf8");
const CHAVE_FIXTURE = "21053022112223330001810000000000123261112345678901";
const TOMADOR = "44556677000186"; // empresa do grupo (tomadora)
const EMPREITEIRO = "11222333000181";
const FORNECEDOR_ALFA = "AB1CD2EF000170";
const AGORA = new Date("2026-11-22T13:00:00Z");

let banco: Awaited<ReturnType<typeof criarBanco>>;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await banco.pg.query<T>(sql, p)).rows;
const db = () => banco.db as never;

/** XML da fixture com outra chave/número/emitente/valor (só o que o teste precisa mudar). */
function xmlDe(o: { seq?: number; emitente?: string; tomador?: string; valor?: string; tpAmb?: string } = {}) {
  let x = FIXTURE;
  if (o.seq !== undefined) {
    x = x.replace(CHAVE_FIXTURE, `${CHAVE_FIXTURE.slice(0, 40)}${String(o.seq).padStart(10, "0")}`).replace("<nNFSe>123</nNFSe>", `<nNFSe>${o.seq}</nNFSe>`);
  }
  if (o.emitente) x = x.split(`<CNPJ>${EMPREITEIRO}</CNPJ>`).join(`<CNPJ>${o.emitente}</CNPJ>`);
  if (o.tomador) x = x.replace(`<CNPJ>${TOMADOR}</CNPJ>`, `<CNPJ>${o.tomador}</CNPJ>`);
  if (o.valor) x = x.replace("<vServ>1500.00</vServ>", `<vServ>${o.valor}</vServ>`);
  if (o.tpAmb) x = x.replace("<tpAmb>1</tpAmb>", `<tpAmb>${o.tpAmb}</tpAmb>`);
  return x;
}
const chaveDe = (seq: number) => `${CHAVE_FIXTURE.slice(0, 40)}${String(seq).padStart(10, "0")}`;

/** Servidor falso do ADN: `total` documentos, até 50 por chamada, NSU crescente. */
function clienteFalso(total: number, gerar: (nsu: number) => DocumentoDistribuido = nsu => ({ nsu, chave: chaveDe(nsu), xml: xmlDe({ seq: nsu }) })) {
  const docs = Array.from({ length: total }, (_, i) => gerar(i + 1));
  const buscarDesde = vi.fn<ClienteDistribuicaoAdn["buscarDesde"]>(async ({ ultimoNsu }) => ({ documentos: docs.filter(d => d.nsu > ultimoNsu).slice(0, 50) }));
  return { buscarDesde } satisfies ClienteDistribuicaoAdn;
}

async function aplicarMigracao() {
  await banco.pg.exec(MIGRACAO);
  await banco.pg.exec(MIGRACAO); // idempotente
}

/** Grupo de obra + mensagem, para notas de origem 'grupo'. */
async function mensagemDeGrupo(externo: string) {
  const [g] = await q<{ id: number }>("SELECT id FROM dolores_grupos WHERE grupo_jid = '120363000000000001@g.us'");
  const grupoId = g?.id ?? (await q<{ id: number }>("INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, obra_id) VALUES ('inst', '120363000000000001@g.us', 'Obra Casa Ana', true, 1) RETURNING id"))[0].id;
  const [m] = await q<{ id: number }>("INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, texto) VALUES ($1, 'inst', $2, 'documento', 'nota') RETURNING id", [grupoId, externo]);
  return { grupoId, mensagemId: m.id };
}

beforeEach(async () => {
  // sem a 0163: cada teste a aplica (duas vezes) por conta própria, alguns depois de gravar notas no formato antigo
  banco = await criarBanco({ sem0163: true });
  await banco.pg.exec(CENARIO);
  // empreiteiro PJ (o CNPJ fica no campo de documento do usuário, como as notas de grupo já conferem) da obra 1 (ativa) e 2 (encerrada)
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

describe("CNPJ alfanumérico — validador único", () => {
  it("confere o exemplo da Receita (12.ABC.345/01DE-35) e o numérico; recusa DV errado, forma errada e repetido", () => {
    expect(digitosVerificadoresCnpj("12ABC34501DE")).toBe("35");
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12abc34501de35")).toBe(true);
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
    expect(cnpjValido("12ABC34501DEA5")).toBe(false); // DV com letra
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cnpjValido(FORNECEDOR_ALFA)).toBe(true);
    expect(documentoFiscalConferido("12.ABC.345/01DE-35")).toEqual({ tipo: "cnpj", valor: "12ABC34501DE35", alfanumerico: true });
    expect(documentoFiscalConferido("529.982.247-25")).toEqual({ tipo: "cpf", valor: "52998224725", alfanumerico: false });
    expect(cpfValido("52998224725")).toBe(true);
  });

  it("os usos trocados mantêm a regra: contratos e consulta aceitam o alfanumérico; nota de grupo continua só numérica", () => {
    expect(cnpjDosContratos("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjParaConsulta("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(cnpjDasNotasDeGrupo("12ABC34501DE35")).toBe(false); // a coluna da 0128 é numérica: regra da origem 'grupo' igual
    expect(cnpjDasNotasDeGrupo(EMPREITEIRO)).toBe(true);
    expect(documentoConferido("11.222.333/0001-81")).toBe(EMPREITEIRO);
    // para números, o cálculo novo é o mesmo do antigo
    for (let i = 0; i < 300; i++) {
      const base = String(100_000_000_000 + i * 7_919_113).padStart(12, "0").slice(0, 12);
      const c = base + digitosVerificadoresCnpj(base);
      expect(cnpjDasNotasDeGrupo(c)).toBe(true);
      expect(cnpjDasNotasDeGrupo(c.slice(0, 13) + ((Number(c[13]) + 1) % 10))).toBe(false);
    }
  });

  it("o fornecedor do BPO com CNPJ alfanumérico fica com as letras; o numérico e o CPF ficam como antes (só dígitos)", () => {
    expect(documentoDoFornecedor("AB.1CD.2EF/0001-70")).toBe(FORNECEDOR_ALFA);
    expect(documentoDoFornecedor("11.222.333/0001-81")).toBe(EMPREITEIRO);
    expect(documentoDoFornecedor("529.982.247-25")).toBe("52998224725");
    expect(documentoDoFornecedor(null)).toBe("");
  });
});

describe("migração 0163 — aditiva, idempotente e sem afrouxar a origem 'grupo'", () => {
  it("nota de grupo gravada ANTES da migração continua igual e fica com origem 'grupo'", async () => {
    const { grupoId, mensagemId } = await mensagemDeGrupo("ANTIGA");
    await banco.pg.exec(`INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao, tipo, emitente_documento, numero, data_emissao, valor_centavos)
      VALUES (${grupoId}, ${mensagemId}, 1, 'rascunho', 'nfe', '${EMPREITEIRO}', '55', '2026-11-01', 250000)`);
    const antes = await q("SELECT * FROM obra_notas");
    await aplicarMigracao();
    const [depois] = await q<Record<string, unknown>>("SELECT * FROM obra_notas");
    expect(depois).toMatchObject({ ...antes[0], origem: "grupo", chave_nfse: null, nsu: null, emitente_cnpj_alfa: null });
  });

  it("origem 'grupo' continua exigindo grupo e mensagem; chave de 44 e documento só numérico continuam valendo", async () => {
    await aplicarMigracao();
    const { grupoId, mensagemId } = await mensagemDeGrupo("M1");
    await expect(q("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao) VALUES (NULL, $1, 'rascunho')", [mensagemId])).rejects.toThrow(/obra_notas_grupo_exige_mensagem_ck/);
    await expect(q("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao) VALUES ($1, NULL, 'rascunho')", [grupoId])).rejects.toThrow(/obra_notas_grupo_exige_mensagem_ck/);
    await expect(q("INSERT INTO obra_notas (origem, grupo_id, mensagem_id, situacao) VALUES ('grupo', NULL, NULL, 'rascunho')")).rejects.toThrow(/obra_notas_grupo_exige_mensagem_ck/);
    await expect(q("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao, chave_acesso) VALUES ($1, $2, 'rascunho', $3)", [grupoId, mensagemId, "1".repeat(50)])).rejects.toThrow();
    await expect(q("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao, emitente_documento) VALUES ($1, $2, 'rascunho', $3)", [grupoId, mensagemId, FORNECEDOR_ALFA])).rejects.toThrow();
    await expect(q("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao, origem) VALUES ($1, $2, 'rascunho', 'outra')", [grupoId, mensagemId])).rejects.toThrow(/obra_notas_origem_ck/);
    const [ok] = await q<{ id: number }>("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao) VALUES ($1, $2, 'rascunho') RETURNING id", [grupoId, mensagemId]);
    // a guarda antiga continua: o que foi lido não muda, nada é apagado
    await expect(q("UPDATE obra_notas SET grupo_id = NULL WHERE id = $1", [ok.id])).rejects.toThrow(/OBRA_NOTAS_IMUTAVEL/);
    await expect(q("UPDATE obra_notas SET origem = 'adn' WHERE id = $1", [ok.id])).rejects.toThrow();
    await expect(q("DELETE FROM obra_notas WHERE id = $1", [ok.id])).rejects.toThrow(/OBRA_NOTAS_SEM_EXCLUSAO/);
  });

  it("origem 'adn': sem grupo/mensagem/arquivo, NFS-e com chave de 50 (aceita letras na inscrição) e NSU; imutável", async () => {
    await aplicarMigracao();
    const base = "INSERT INTO obra_notas (origem, situacao, tipo, chave_nfse, nsu, emitente_cnpj_alfa) VALUES ('adn', 'rascunho', $1, $2, $3, $4) RETURNING id";
    await expect(q(base, ["nfse", null, 1, null])).rejects.toThrow(/obra_notas_adn_ck/);
    await expect(q(base, ["nfe", CHAVE_FIXTURE, 1, null])).rejects.toThrow(/obra_notas_adn_ck/);
    await expect(q(base, ["nfse", CHAVE_FIXTURE, null, null])).rejects.toThrow(/obra_notas_adn_ck/);
    await expect(q(base, ["nfse", "1".repeat(44), 1, null])).rejects.toThrow(/obra_notas_chave_nfse_ck/);
    await expect(q(base, ["nfse", `123456${"A".repeat(14)}${"1".repeat(29)}X`, 1, null])).rejects.toThrow(/obra_notas_chave_nfse_ck/);
    await expect(q(base, ["nfse", CHAVE_FIXTURE, 1, EMPREITEIRO])).rejects.toThrow(/obra_notas_cnpj_alfa_ck/); // numérico vai na coluna antiga
    const { grupoId, mensagemId } = await mensagemDeGrupo("M2");
    await expect(q("INSERT INTO obra_notas (origem, grupo_id, mensagem_id, situacao, tipo, chave_nfse, nsu) VALUES ('adn', $1, $2, 'rascunho', 'nfse', $3, 1)", [grupoId, mensagemId, CHAVE_FIXTURE])).rejects.toThrow(/obra_notas_adn_ck/);
    await expect(q("INSERT INTO obra_notas (origem, situacao, tipo, chave_nfse, nsu, emitente_documento, emitente_cnpj_alfa) VALUES ('adn', 'rascunho', 'nfse', $1, 1, $2, $3)", [CHAVE_FIXTURE, EMPREITEIRO, FORNECEDOR_ALFA])).rejects.toThrow(/obra_notas_um_documento_ck/);
    const chaveComLetras = `123456${"AB1CD2EF000170"}${"0".repeat(30)}`;
    const [{ id }] = await q<{ id: number }>(base, ["nfse", chaveComLetras, 7, FORNECEDOR_ALFA]);
    await expect(q(base, ["nfse", chaveComLetras, 8, null])).rejects.toThrow(/obra_notas_chave_nfse_uidx/);
    for (const set of ["chave_nfse = '" + CHAVE_FIXTURE + "'", "nsu = 9", "emitente_cnpj_alfa = NULL", "origem = 'grupo'"]) {
      await expect(q(`UPDATE obra_notas SET ${set} WHERE id = $1`, [id])).rejects.toThrow();
    }
    // XML: só inserção e só para nota 'adn'
    await q("INSERT INTO obra_notas_adn (nota_id, tomador_cnpj, xml, xml_sha256) VALUES ($1, $2, '<x/>', $3)", [id, TOMADOR, "a".repeat(64)]);
    await expect(q("UPDATE obra_notas_adn SET xml = '<y/>' WHERE nota_id = $1", [id])).rejects.toThrow(/OBRA_NOTAS_ADN_SOMENTE_INSERCAO/);
    await expect(q("DELETE FROM obra_notas_adn WHERE nota_id = $1", [id])).rejects.toThrow(/OBRA_NOTAS_ADN_SOMENTE_INSERCAO/);
    const [g] = await q<{ id: number }>("INSERT INTO obra_notas (grupo_id, mensagem_id, situacao) VALUES ($1, $2, 'rascunho') RETURNING id", [grupoId, mensagemId]);
    await expect(q("INSERT INTO obra_notas_adn (nota_id, tomador_cnpj, xml, xml_sha256) VALUES ($1, $2, '<x/>', $3)", [g.id, TOMADOR, "a".repeat(64)])).rejects.toThrow(/OBRA_NOTAS_ADN_ORIGEM/);
  });

  it("estado da captura: desligada por padrão, NSU não volta, não é apagado", async () => {
    await aplicarMigracao();
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj) VALUES ($1)", [TOMADOR]);
    expect((await q("SELECT ligada, ultimo_nsu FROM fiscal_distribuicao_estado"))[0]).toEqual({ ligada: false, ultimo_nsu: 0 });
    await q("UPDATE fiscal_distribuicao_estado SET ultimo_nsu = 10");
    await expect(q("UPDATE fiscal_distribuicao_estado SET ultimo_nsu = 9")).rejects.toThrow(/FISCAL_DISTRIBUICAO_NSU/);
    await expect(q("DELETE FROM fiscal_distribuicao_estado")).rejects.toThrow(/FISCAL_DISTRIBUICAO_SEM_EXCLUSAO/);
  });
});

describe("leitura do XML nacional (fixture) e mapeamento — puro", () => {
  it("lê chave, número, datas, emitente, tomador, valores e descrição", () => {
    const r = lerNfseRecebida(FIXTURE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nota).toMatchObject({
      chave: CHAVE_FIXTURE, numero: "123", dataEmissao: "2026-11-10", competencia: "2026-11-10", ambiente: "producao",
      emitente: { documento: { tipo: "cnpj", valor: EMPREITEIRO, alfanumerico: false }, nome: "Construtora Exemplo Ltda" },
      tomador: { documento: { valor: TOMADOR } }, valorServicoCentavos: 150000, valorLiquidoCentavos: 142500,
      descricao: "Execução de alvenaria da obra, medição 2", codigoTributacaoNacional: "070201",
    });
  });

  it("recusa XML vazio, com DOCTYPE/ENTITY, malformado, que não é NFS-e ou com chave errada", () => {
    expect(lerNfseRecebida("")).toEqual({ ok: false, motivo: "xml_vazio" });
    expect(lerNfseRecebida(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${FIXTURE}`)).toEqual({ ok: false, motivo: "xml_com_doctype" });
    expect(lerNfseRecebida("<NFSe><infNFSe>")).toMatchObject({ ok: false });
    expect(lerNfseRecebida("<evento/>")).toEqual({ ok: false, motivo: "nao_e_nfse" });
    expect(lerNfseRecebida(FIXTURE.replace(`NFS${CHAVE_FIXTURE}`, "NFS123"))).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(lerNfseRecebida("x".repeat(300_001))).toEqual({ ok: false, motivo: "xml_grande_demais" });
  });

  it("valores sem ponto flutuante; fora do formato, zero ou acima do teto → null", () => {
    expect(centavosDoXml("1500.00")).toBe(150000);
    expect(centavosDoXml("0.1")).toBe(10);
    expect(centavosDoXml("1500,00")).toBeNull();
    expect(centavosDoXml("0.00")).toBeNull();
    expect(centavosDoXml("-1.00")).toBeNull();
    expect(centavosDoXml("99999999.00")).toBeNull();
  });

  it("vínculo por documento: uma obra → obra e empreiteiro; duas → só o empreiteiro e a dúvida; dois usuários → nada", () => {
    expect(vincularPorDocumento([])).toEqual({ obraId: null, empreiteiroUserId: null, duvida: null });
    expect(vincularPorDocumento([{ obraId: 1, empreiteiroUserId: 3 }])).toEqual({ obraId: 1, empreiteiroUserId: 3, duvida: null });
    expect(vincularPorDocumento([{ obraId: 1, empreiteiroUserId: 3 }, { obraId: 4, empreiteiroUserId: 3 }])).toMatchObject({ obraId: null, empreiteiroUserId: 3, duvida: expect.stringContaining("2 obras") });
    expect(vincularPorDocumento([{ obraId: 1, empreiteiroUserId: 3 }, { obraId: 4, empreiteiroUserId: 5 }])).toMatchObject({ obraId: null, empreiteiroUserId: null });
  });

  it("só grava nota em que a empresa é TOMADORA e de produção; CNPJ alfanumérico vai para a coluna própria", () => {
    const ler = (x: string) => { const r = lerNfseRecebida(x); if (!r.ok) throw new Error(r.motivo); return r.nota; };
    const sem = { obraId: null, empreiteiroUserId: null, duvida: null };
    expect(mapearNotaRecebida(ler(FIXTURE), { tomadorCnpj: EMPREITEIRO, nsu: 1, agora: AGORA, vinculo: sem })).toEqual({ gravar: false, motivo: "emitida_pela_empresa" });
    expect(mapearNotaRecebida(ler(FIXTURE), { tomadorCnpj: "99887766000105", nsu: 1, agora: AGORA, vinculo: sem })).toEqual({ gravar: false, motivo: "outro_tomador" });
    expect(mapearNotaRecebida(ler(xmlDe({ tpAmb: "2" })), { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: sem })).toEqual({ gravar: false, motivo: "producao_restrita" });
    const m = mapearNotaRecebida(ler(xmlDe({ emitente: FORNECEDOR_ALFA })), { tomadorCnpj: TOMADOR, nsu: 5, agora: AGORA, vinculo: sem });
    expect(m.gravar && m.linha).toMatchObject({
      origem: "adn", grupoId: null, mensagemId: null, tipo: "nfse", situacao: "rascunho", emitenteDocumento: null, emitenteCnpjAlfa: FORNECEDOR_ALFA,
      chaveNfse: CHAVE_FIXTURE, nsu: 5, valorCentavos: 150000, alertas: [expect.stringContaining("valor líquido")],
    });
  });

  it("descrição com dado bancário: o filtro das notas de grupo tira e alerta", () => {
    const r = lerNfseRecebida(FIXTURE.replace("medição 2", "medição 2. PIX 529.982.247-25 agência 1234 conta 56789-0"));
    if (!r.ok) throw new Error(r.motivo);
    const m = mapearNotaRecebida(r.nota, { tomadorCnpj: TOMADOR, nsu: 1, agora: AGORA, vinculo: { obraId: null, empreiteiroUserId: null, duvida: null } });
    if (!m.gravar) throw new Error("devia gravar");
    expect(m.linha.descricao).not.toMatch(/56789|529\.982/);
    expect(m.linha.alertas.join(" ")).toMatch(/dados bancários/);
  });

  it("XML do ADN: GZip + Base64", () => {
    expect(xmlDoArquivoAdn(gzipSync(Buffer.from(FIXTURE)).toString("base64"))).toBe(FIXTURE);
    expect(xmlDoArquivoAdn("não é base64 de gzip")).toBeNull();
  });
});

describe("captura por NSU — desligada, idempotente, com último NSU e espera de 1 h", () => {
  it("sem cliente (hoje): não toca no banco nem na rede, nem pelo cron", async () => {
    const dbVigia = vi.fn(db);
    expect(await capturarNotasRecebidas(dbVigia, { cliente: null, prazoEm: Date.now() + 30_000 })).toEqual({ executou: false, motivo: "sem_cliente" });
    expect(await capturarRecebidasNoCron(dbVigia, 10_000)).toEqual({ desligada: true });
    expect(dbVigia).not.toHaveBeenCalled();
  });

  it("com cliente, mas sem CNPJ ligado (sem linha ou desligado): o cliente não é chamado", async () => {
    await aplicarMigracao();
    const cliente = clienteFalso(10);
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toEqual({ executou: false, motivo: "nenhum_cnpj_ligado" });
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, false)", [TOMADOR]);
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toEqual({ executou: false, motivo: "nenhum_cnpj_ligado" });
    expect(cliente.buscarDesde).not.toHaveBeenCalled();
  });

  it("120 documentos em 3 páginas → 120 notas; NSU 120 gravado; de novo (depois de 1 h) → zero novas", async () => {
    await aplicarMigracao();
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const cliente = clienteFalso(120);
    const r1 = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA });
    expect(r1).toMatchObject({ executou: true, gravadas: 120, jaExistiam: 0, erros: 0, parcial: false });
    expect(cliente.buscarDesde).toHaveBeenCalledTimes(4); // 50 + 50 + 20 + a vazia
    expect((await q("SELECT count(*)::int n FROM obra_notas WHERE origem = 'adn'"))[0].n).toBe(120);
    expect((await q("SELECT count(*)::int n FROM obra_notas_adn"))[0].n).toBe(120);
    const [estado] = await q<{ ultimo_nsu: number; documentos_gravados: number; ultimo_resultado: string; ultima_consulta_vazia_em: Date }>("SELECT * FROM fiscal_distribuicao_estado");
    expect(estado).toMatchObject({ ultimo_nsu: 120, documentos_gravados: 120, ultimo_resultado: "ok" });
    expect(new Date(estado.ultima_consulta_vazia_em).toISOString()).toBe(AGORA.toISOString());
    // antes de 1 h depois da consulta vazia: nada é chamado
    cliente.buscarDesde.mockClear();
    const r2 = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: new Date(AGORA.getTime() + ESPERA_DEPOIS_DE_CONSULTA_VAZIA_MS - 1) });
    expect(r2).toMatchObject({ aguardando: 1, gravadas: 0 });
    expect(cliente.buscarDesde).not.toHaveBeenCalled();
    // depois de 1 h: consulta, nada novo
    const r3 = await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: new Date(AGORA.getTime() + ESPERA_DEPOIS_DE_CONSULTA_VAZIA_MS) });
    expect(r3).toMatchObject({ aguardando: 0, gravadas: 0 });
    expect(cliente.buscarDesde).toHaveBeenCalledTimes(1);
    expect((await q("SELECT count(*)::int n FROM obra_notas"))[0].n).toBe(120);
  });

  it("idempotente por chave: o mesmo documento com outro NSU (ou reenviado) não duplica", async () => {
    await aplicarMigracao();
    const doc = { nsu: 1, chave: CHAVE_FIXTURE, xml: FIXTURE };
    expect(await gravarNotaRecebida(db(), doc, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    expect(await gravarNotaRecebida(db(), doc, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ja_existia");
    expect(await gravarNotaRecebida(db(), { ...doc, nsu: 99 }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ja_existia");
    expect(await gravarNotaRecebida(db(), { nsu: 2, chave: "1".repeat(50), xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ilegivel");
    expect(await gravarNotaRecebida(db(), { nsu: 3, xml: null }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ignorada");
    expect(await gravarNotaRecebida(db(), { nsu: 4, xml: xmlDe({ seq: 4, tomador: "99887766000105" }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("ignorada");
    expect((await q("SELECT count(*)::int n FROM obra_notas"))[0].n).toBe(1);
  });

  it("vínculo no banco: empreiteiro com obra única → vinculada; com duas obras ativas → sem obra e com a dúvida", async () => {
    await aplicarMigracao();
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: xmlDe({ seq: 1 }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [a] = await q("SELECT obra_id, empreiteiro_user_id, categoria, situacao, grupo_id, mensagem_id, emitente_documento FROM obra_notas WHERE nsu = 1");
    // obra 2 está encerrada: não conta
    expect(a).toEqual({ obra_id: 1, empreiteiro_user_id: 3, categoria: "empreiteiro", situacao: "rascunho", grupo_id: null, mensagem_id: null, emitente_documento: EMPREITEIRO });
    await banco.pg.exec(`INSERT INTO construction_projects (title, status, progress, contractor_user_id) VALUES ('Casa Nova', 'in_progress', 0, 3)`);
    expect(await gravarNotaRecebida(db(), { nsu: 2, xml: xmlDe({ seq: 2 }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [b] = await q<{ obra_id: number | null; empreiteiro_user_id: number; situacao: string; duvidas: string[] }>("SELECT obra_id, empreiteiro_user_id, situacao, duvidas FROM obra_notas WHERE nsu = 2");
    expect(b).toMatchObject({ obra_id: null, empreiteiro_user_id: 3, situacao: "confira" });
    expect(b.duvidas.join(" ")).toMatch(/2 obras ativas/);
  });

  it("nota de grupo com o mesmo emitente e número já registrada → a do ADN entra como duplicada (não concilia duas vezes)", async () => {
    await aplicarMigracao();
    const { grupoId, mensagemId } = await mensagemDeGrupo("DUP");
    const [g] = await q<{ id: number }>(`INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao, tipo, emitente_documento, numero) VALUES ($1, $2, 1, 'rascunho', 'nfse', $3, '000123') RETURNING id`, [grupoId, mensagemId, EMPREITEIRO]);
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const [n] = await q<{ duplicada_de: number; situacao: string }>("SELECT duplicada_de, situacao FROM obra_notas WHERE origem = 'adn'");
    expect(n).toEqual({ duplicada_de: g.id, situacao: "confira" });
  });

  it("falha do ADN: registra 'erro', não avança o NSU e não lança", async () => {
    await aplicarMigracao();
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: vi.fn(async () => { throw new Error("tempo esgotado"); }) };
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ executou: true, erros: 1, gravadas: 0 });
    expect((await q("SELECT ultimo_nsu, ultimo_resultado, ultima_consulta_vazia_em FROM fiscal_distribuicao_estado"))[0]).toEqual({ ultimo_nsu: 0, ultimo_resultado: "erro", ultima_consulta_vazia_em: null });
  });

  it("ilegíveis: a rodada fica 'parcial' e só os 20 NSUs mais recentes ficam guardados para o dono", async () => {
    await aplicarMigracao();
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const cliente = clienteFalso(25, nsu => ({ nsu, xml: "<NFSe><infNFSe Id='lixo'/></NFSe>" }));
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ ilegiveis: 25, gravadas: 0 });
    const [e] = await q<{ ultimo_nsu: number; ultimo_resultado: string; nsus_ilegiveis: number[] }>("SELECT ultimo_nsu, ultimo_resultado, nsus_ilegiveis FROM fiscal_distribuicao_estado");
    expect(e).toEqual({ ultimo_nsu: 25, ultimo_resultado: "parcial", nsus_ilegiveis: Array.from({ length: 20 }, (_, i) => i + 6) });
  });

  it("prazo do cron: sem tempo, nada é chamado e o resultado fica 'parcial'", async () => {
    await aplicarMigracao();
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    const cliente = clienteFalso(5);
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now(), agora: AGORA })).toMatchObject({ parcial: true, gravadas: 0 });
    expect(cliente.buscarDesde).not.toHaveBeenCalled();
    expect(await capturarRecebidasNoCron(db, 1_000, cliente)).toEqual({ pulado: true });
  });
});

describe("conciliação com o BPO — a nota do ADN entra na MESMA regra e só aponta", () => {
  it("valor do BPO diferente (líquido) com o mesmo fornecedor e obra → divergente; nenhum lançamento muda", async () => {
    await aplicarMigracao();
    await banco.pg.exec(`
      INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('Construtora Exemplo', '11.222.333/0001-81', 'Zé', '9999', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, pago_em, competencia, a_classificar, categoria_operacional, vinculo_operacional_id, tipo_despesa_obra)
        VALUES ((SELECT max(id) FROM bpo_clients), 'despesa', 'Medição 2', '1425.00', '0', '2026-11-12', true, '2026-11-12 12:00', '2026-11', false, 'obras', '1', 'empreiteiro');`);
    const antes = await q("SELECT * FROM bpo_lancamentos ORDER BY id");
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: FIXTURE }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const linhas = await notasDoBanco(banco.db as never, { abertas: true });
    expect(linhas).toHaveLength(1); // a nota sem mensagem de grupo aparece (leftJoin)
    expect(linhas[0]).toMatchObject({ enviadaEm: null, remetente: null });
    const aps = await apontarNotas(banco.db as never, linhas.map(l => paraConciliar(l.n)), 30);
    const ap = aps.get(linhas[0].n.id)!.apontamento;
    expect(ap.situacao).toBe("divergente");
    expect("divergencias" in ap && ap.divergencias.join(" ")).toMatch(/valor: nota R\$\s1\.500,00 × BPO R\$\s1\.425,00/);
    expect(await q("SELECT * FROM bpo_lancamentos ORDER BY id")).toEqual(antes);
    expect((await q("SELECT bpo_lancamento_id FROM obra_notas"))[0].bpo_lancamento_id).toBeNull();
  });

  it("fornecedor com CNPJ alfanumérico no BPO e na nota → confere (já lançado), sem ligar nada", async () => {
    await aplicarMigracao();
    await banco.pg.exec(`
      INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('Fornecedor Alfa', 'AB.1CD.2EF/0001-70', 'X', '9999', '0', '2026-01-01');
      INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar)
        VALUES ((SELECT max(id) FROM bpo_clients), 'despesa', 'Serviço', '1500.00', '0', '2026-11-12', false, '2026-11', false);`);
    const lancamentoId = (await q<{ id: number }>("SELECT max(id)::int id FROM bpo_lancamentos"))[0].id;
    expect(await gravarNotaRecebida(db(), { nsu: 1, xml: xmlDe({ emitente: FORNECEDOR_ALFA }) }, { tomadorCnpj: TOMADOR, agora: AGORA })).toBe("gravada");
    const linhas = await notasDoBanco(banco.db as never, { abertas: true });
    expect(linhas[0].n).toMatchObject({ emitenteDocumento: null, emitenteCnpjAlfa: FORNECEDOR_ALFA, obraId: null });
    const ap = (await apontarNotas(banco.db as never, linhas.map(l => paraConciliar(l.n)), 30)).get(linhas[0].n.id)!.apontamento;
    expect(ap).toMatchObject({ situacao: "ja_lancado", lancamentoId, podeConciliar: false });
  });
});
