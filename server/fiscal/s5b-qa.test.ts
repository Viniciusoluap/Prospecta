// EPIC-029 S-5b — portão de QA (Quinn, 22/11/2026). Tenta QUEBRAR as correções da S-5b: migração 0166 e gatilhos, leitor de
// evento, cancelamento, "mesma nota por outra origem" e NSU com falha. Achado confirmado = `it.fails` (o teste descreve o
// comportamento CERTO e falha hoje; quando a correção entrar, o vitest acusa e o `.fails` sai).
// Migrações 0163 + 0166 aplicadas duas vezes no PGlite (criarBanco). Nenhum teste chama rede (vigia de fetch).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { getDb } from "../db.js";
import { CENARIO, MIGRACAO_0166, criarBanco } from "../dolores/testes-banco.js";
import { REGRAS } from "../dolores/avisos.js";
import { gravarNota } from "../dolores/notas-obra.js";
import { prepararConciliarNota, prepararSalvarNota } from "../dolores/acoes/notas.js";
import { executarConciliarAprovado } from "../dolores/conciliacao.js";
import type { LeituraConferida } from "../../shared/dolores/notas.js";
import {
  capturarNotasRecebidas, gravarNotaRecebida, registrarClienteDistribuicao, type ClienteDistribuicaoAdn, type DocumentoDistribuido,
} from "./distribuicao.js";
import { lerEventoNfse } from "./nfse-recebida.js";

const MIGRACAO_0154 = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("./fixtures/nfse-nacional-recebida.xml", import.meta.url), "utf8");
const CHAVE = "21053022112223330001810000000000123261112345678901";
const OUTRA_CHAVE = `${CHAVE.slice(0, 40)}9999999999`;
const TOMADOR = "44556677000186";
const EMPREITEIRO = "11222333000181";
const OUTRO_EMITENTE = "11444777000161";
const AGORA = new Date("2026-11-22T13:00:00Z");
const SHA = "a".repeat(64);

let banco: Awaited<ReturnType<typeof criarBanco>>;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await banco.pg.query<T>(sql, p)).rows;
const db = () => banco.db as never;
const ctx = {} as never;
const gravar = (nsu: number, xml: string, chave?: string) => gravarNotaRecebida(db(), { nsu, xml, chave }, { tomadorCnpj: TOMADOR, agora: AGORA });

function eventoXml(o: { chave?: string; chavePedido?: string; tipo?: string; tpAmb?: string; idPedido?: string; idEvento?: string; ns?: string } = {}) {
  const chave = o.chave ?? CHAVE;
  const tipo = o.tipo ?? "101101";
  const ns = o.ns ?? "http://www.sped.fazenda.gov.br/nfse";
  const pedido = `<pedRegEvento versao="1.01"><infPedReg Id="${o.idPedido ?? `PRE${o.chavePedido ?? chave}${tipo}001`}"><tpAmb>${o.tpAmb ?? "1"}</tpAmb><verAplic>E</verAplic>`
    + `<dhEvento>2026-11-15T10:00:00-03:00</dhEvento><CNPJAutor>${EMPREITEIRO}</CNPJAutor><chNFSe>${o.chavePedido ?? chave}</chNFSe><nPedRegEvento>001</nPedRegEvento>`
    + `<e${tipo}><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo></e${tipo}></infPedReg></pedRegEvento>`;
  return `<?xml version="1.0" encoding="UTF-8"?><evento xmlns="${ns}" versao="1.01"><infEvento Id="${o.idEvento ?? `EVT${chave}${tipo}001`}">`
    + `<verAplic>ADN</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento>${pedido}</infEvento></evento>`;
}

async function mensagemDeGrupo(externo: string) {
  const [g] = await q<{ id: number }>("SELECT id FROM dolores_grupos WHERE grupo_jid = '120363000000000001@g.us'");
  const grupoId = g?.id ?? (await q<{ id: number }>("INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, obra_id) VALUES ('inst', '120363000000000001@g.us', 'Obra Casa Ana', true, 1) RETURNING id"))[0].id;
  const [m] = await q<{ id: number }>("INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, texto) VALUES ($1, 'inst', $2, 'documento', 'nota') RETURNING id", [grupoId, externo]);
  return { grupoId, mensagemId: m.id };
}

const leitura = (o: Partial<LeituraConferida> = {}): LeituraConferida => ({
  situacao: "rascunho", tipo: "nfse", emitenteNome: "Construtora Exemplo Ltda", emitenteDocumento: EMPREITEIRO, numero: "123", dataEmissao: "2026-11-10",
  valorCentavos: 150_000, descricao: "alvenaria", itens: [], chaveAcesso: null, categoria: "empreiteiro", etapa: null, confianca: {}, duvidas: [], alertas: [], ...o,
});

async function notaDeGrupo(externo: string, o: Partial<LeituraConferida> = {}, sha = SHA) {
  const { grupoId, mensagemId } = await mensagemDeGrupo(externo);
  return gravarNota({ grupoId, mensagemId, obraId: 1, sha256: sha, mime: "application/pdf", bytes: 1000, leitura: leitura(o), modelo: "m", lidaEm: AGORA });
}

async function aprovacao(): Promise<number> {
  return (await q<{ id: number }>(`INSERT INTO dolores_aprovacoes (codigo, vence_em, funcao, alvo, argumentos, resumo) VALUES ('QA' || floor(random()*100000)::int, now() + interval '1 day', 'conciliar_nota_obra', 'nota:qa:' || floor(random()*1000000)::int, '{}', 'x') RETURNING id`))[0].id;
}
async function lancamento(): Promise<number> {
  await banco.pg.exec(`INSERT INTO bank_accounts (banco, conta) VALUES ('Banco', '1') ON CONFLICT DO NOTHING;
    INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo) VALUES (1, '2026-11-12', 'PIX', '-1500.00', 'debito');
    INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio) VALUES ('Construtora Exemplo', '11.222.333/0001-81', 'Zé', '9999', '0', '2026-01-01');
    INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, pago_em, competencia, a_classificar, categoria_operacional, vinculo_operacional_id, tipo_despesa_obra, bank_transaction_id)
      VALUES ((SELECT max(id) FROM bpo_clients), 'despesa', 'Medição 2', '1500.00', '0', '2026-11-12', true, '2026-11-12 12:00', '2026-11', false, 'obras', '1', 'empreiteiro', (SELECT max(id) FROM bank_transactions));`);
  return (await q<{ id: number }>("SELECT max(id)::int id FROM bpo_lancamentos"))[0].id;
}

beforeEach(async () => {
  banco = await criarBanco();
  await banco.pg.exec(CENARIO);
  // as notas EMITIDAS (fiscal_notas, 0154, já em produção): o evento de cancelamento confere se a chave é de nota emitida
  await banco.pg.exec(MIGRACAO_0154);
  await banco.pg.exec(`
    INSERT INTO users ("openId", name, role, active, "passwordHash", cpf) VALUES ('emp', 'Construtora Exemplo', 'empreiteiro', true, 'hash', '${EMPREITEIRO}');
    UPDATE construction_projects SET contractor_user_id = 3 WHERE id = 1;`);
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  registrarClienteDistribuicao(null);
});

afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  await banco.pg.close();
});

// ── 1. Migração 0166 e gatilhos ──

describe("QA 1 — 0166: aditiva, idempotente; o gatilho novo não bloqueia operações legítimas", () => {
  it("reaplicar a 0166 com dados já gravados (nota cancelada, evento casado, estado com falha) não muda nenhuma linha", async () => {
    await notaDeGrupo("G1");
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await gravar(2, eventoXml())).toBe("cancelamento");
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada, nsu_com_falha, tentativas_nsu_com_falha, nsus_a_conferir) VALUES ($1, true, 7, 2, '[5]')", [TOMADOR]);
    const fotos = async () => [await q("SELECT * FROM obra_notas ORDER BY id"), await q("SELECT * FROM obra_notas_eventos_adn ORDER BY id"), await q("SELECT * FROM fiscal_distribuicao_estado")];
    const antes = await fotos();
    await banco.pg.exec(MIGRACAO_0166());
    expect(await fotos()).toEqual(antes);
  });

  it("nota NÃO cancelada: confirmação do empreiteiro, Drive e conciliação continuam funcionando com o gatilho novo", async () => {
    const g = await notaDeGrupo("G1");
    const ap = await aprovacao();
    const lanc = await lancamento();
    await q("UPDATE obra_notas SET confirmacao = 'confirmada', confirmacao_em = now() WHERE id = $1", [g!.id]);
    await q("UPDATE obra_notas SET drive_file_id = 'f1', salva_em = now(), salva_aprovacao_id = $2 WHERE id = $1", [g!.id, ap]);
    await q("UPDATE obra_notas SET bpo_lancamento_id = $2, conciliada_em = now(), conciliada_aprovacao_id = $3 WHERE id = $1", [g!.id, lanc, ap]);
    expect((await q("SELECT confirmacao, drive_file_id, bpo_lancamento_id FROM obra_notas WHERE id = $1", [g!.id]))[0]).toEqual({ confirmacao: "confirmada", drive_file_id: "f1", bpo_lancamento_id: lanc });
  });

  it("nota CANCELADA: ainda recebe a resposta do empreiteiro e o arquivo no Drive; o vínculo já existente pode cair (lançamento excluído)", async () => {
    const g = await notaDeGrupo("G1");
    const ap = await aprovacao();
    const lanc = await lancamento();
    // já conciliada ANTES do cancelamento: o cancelamento entra (sem desfazer o vínculo)
    await q("UPDATE obra_notas SET bpo_lancamento_id = $2, conciliada_em = now(), conciliada_aprovacao_id = $3 WHERE id = $1", [g!.id, lanc, ap]);
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await gravar(2, eventoXml())).toBe("cancelamento");
    expect((await q("SELECT cancelamento_tipo, bpo_lancamento_id FROM obra_notas WHERE id = $1", [g!.id]))[0]).toEqual({ cancelamento_tipo: "101101", bpo_lancamento_id: lanc });
    await q("UPDATE obra_notas SET confirmacao = 'correcao', confirmacao_em = now() WHERE id = $1", [g!.id]);
    await q("UPDATE obra_notas SET drive_file_id = 'f1', salva_em = now(), salva_aprovacao_id = $2 WHERE id = $1", [g!.id, ap]);
    await q("UPDATE obra_notas SET bpo_lancamento_id = NULL WHERE id = $1", [g!.id]);
    // e não volta a ser ligada (nem por uma nova aprovação)
    const ap2 = await aprovacao();
    await expect(q("UPDATE obra_notas SET bpo_lancamento_id = $2, conciliada_em = now(), conciliada_aprovacao_id = $3 WHERE id = $1", [g!.id, lanc, ap2])).rejects.toThrow(/OBRA_NOTAS_CANCELADA/);
  });

  it("outra_origem_de: não é preenchido nem trocado por UPDATE; eventos: sem TRUNCATE, casar só uma vez", async () => {
    const g = await notaDeGrupo("G1");
    const g2 = await notaDeGrupo("G2", { numero: "777", emitenteDocumento: OUTRO_EMITENTE }, "b".repeat(64));
    await expect(q("UPDATE obra_notas SET outra_origem_de = $2 WHERE id = $1", [g!.id, g2!.id])).rejects.toThrow(/OBRA_NOTAS_VINCULO/);
    expect(await gravar(1, eventoXml())).toBe("cancelamento");
    await expect(banco.pg.exec("TRUNCATE obra_notas_eventos_adn")).rejects.toThrow(/SEM_EXCLUSAO/);
    await q("UPDATE obra_notas_eventos_adn SET nota_id = $1, casado_em = now()", [g!.id]);
    await expect(q("UPDATE obra_notas_eventos_adn SET nota_id = $1", [g2!.id])).rejects.toThrow(/OBRA_NOTAS_EVENTOS_CASADO/);
    await expect(q("UPDATE obra_notas_eventos_adn SET xml = 'x'")).rejects.toThrow(/IMUTAVEL/);
  });
});

// ── 2. Leitor do evento ──

describe("QA 2 — lerEventoNfse: XXE, Id × chave/tipo, ambiente; evento forjado não cancela outra nota", () => {
  it("XXE (entidade externa/parâmetro) e DOCTYPE em minúsculas são recusados antes do parser", () => {
    expect(lerEventoNfse(`<?xml version="1.0"?><!DOCTYPE evento SYSTEM "file:///etc/passwd">${eventoXml().replace(/^<\?xml[^>]*>/, "")}`)).toEqual({ ok: false, motivo: "xml_com_doctype" });
    expect(lerEventoNfse(`<!doctype x [<!entity % p SYSTEM "http://x/">%p;]><x/>`)).toEqual({ ok: false, motivo: "xml_com_doctype" });
  });

  it("Id do evento (EVT) ou do pedido (PRE) de OUTRA chave/tipo → recusado; chNFSe divergente do Id → recusado", () => {
    expect(lerEventoNfse(eventoXml({ idEvento: `EVT${OUTRA_CHAVE}101101001` }))).toEqual({ ok: false, motivo: "id_do_evento_nao_confere" });
    expect(lerEventoNfse(eventoXml({ idEvento: `EVT${CHAVE}105102001` }))).toEqual({ ok: false, motivo: "id_do_evento_nao_confere" });
    expect(lerEventoNfse(eventoXml({ idPedido: `PRE${OUTRA_CHAVE}101101001` }))).toEqual({ ok: false, motivo: "id_do_evento_nao_confere" });
    // infEvento diz uma chave; o pedido dentro dele, outra
    expect(lerEventoNfse(eventoXml({ chavePedido: OUTRA_CHAVE }))).toEqual({ ok: false, motivo: "id_do_evento_nao_confere" });
    expect(lerEventoNfse(eventoXml({ idPedido: `PRE${CHAVE}101101` }))).toEqual({ ok: false, motivo: "id_do_evento_nao_confere" });
  });

  it("evento de OUTRA nota não cancela a nota gravada; chave do ADN divergente do XML → ilegível; produção restrita → nada muda", async () => {
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await gravar(2, eventoXml({ chave: OUTRA_CHAVE }))).toBe("cancelamento");
    expect(await gravar(3, eventoXml(), OUTRA_CHAVE)).toBe("ilegivel");
    expect(await gravar(4, eventoXml({ tpAmb: "2" }))).toBe("ignorada");
    expect(await gravar(5, eventoXml({ tpAmb: "9" }))).toBe("ilegivel");
    expect(await q("SELECT cancelada_em, cancelamento_tipo FROM obra_notas")).toEqual([{ cancelada_em: null, cancelamento_tipo: null }]);
    // o evento da outra chave ficou guardado, à espera, sem tocar em nada
    expect(await q("SELECT chave_nfse, nota_id FROM obra_notas_eventos_adn")).toEqual([{ chave_nfse: OUTRA_CHAVE, nota_id: null }]);
  });

  it("evento que não cancela (101103, 105105) não marca a nota; vai para conferir", async () => {
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await gravar(2, eventoXml({ tipo: "101103" }))).toBe("a_conferir");
    expect(await gravar(3, eventoXml({ tipo: "105105" }))).toBe("a_conferir");
    expect((await q("SELECT cancelamento_tipo FROM obra_notas"))[0].cancelamento_tipo).toBeNull();
  });
});

// ── 3. Cancelamento ──

describe("QA 3 — cancelamento: nem preparo, nem execução, nem BPO; aviso sem dado sensível", () => {
  it("evento chega ENTRE o pedido e a aprovação: a execução aprovada recusa e nada é ligado", async () => {
    const lanc = await lancamento();
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    const [n] = await q<{ id: number; obra_id: number }>("SELECT id, obra_id FROM obra_notas");
    expect(n.obra_id).toBe(1);
    const preparo = await prepararConciliarNota({ notaId: n.id }, ctx);
    expect(preparo.itens).toHaveLength(1);
    expect(await gravar(2, eventoXml())).toBe("cancelamento");
    const ap = await aprovacao();
    await expect(executarConciliarAprovado({ notaId: n.id, obraId: 1, valorCentavos: 150_000, lancamentoId: lanc }, { aprovacaoId: ap, agora: AGORA } as never))
      .rejects.toThrow(/CANCELADA/);
    expect((await q("SELECT bpo_lancamento_id FROM obra_notas"))[0].bpo_lancamento_id).toBeNull();
  });

  it("a mesma nota da OUTRA origem (grupo) também recusa na execução aprovada", async () => {
    const lanc = await lancamento();
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    const g = await notaDeGrupo("G1");
    const ap = await aprovacao();
    await expect(executarConciliarAprovado({ notaId: g!.id, obraId: 1, valorCentavos: 150_000, lancamentoId: lanc }, { aprovacaoId: ap, agora: AGORA } as never))
      .rejects.toThrow(/outra origem/);
  });

  it("aviso da cancelada ao dono: sem CNPJ, CPF, valor ou chave — só nome limpo e marca fixa", async () => {
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await gravar(2, eventoXml())).toBe("cancelamento");
    const coleta = await REGRAS.nota_obra({ agora: AGORA, limites: { notaConfirmacaoDias: 7 } as never });
    const canceladas = coleta.achados.filter(a => a.entidade.endsWith(":cancelada"));
    expect(canceladas).toHaveLength(1);
    const texto = JSON.stringify(canceladas);
    for (const sensivel of [EMPREITEIRO, TOMADOR, CHAVE, "1500", "150000"]) expect(texto).not.toContain(sensivel);
  });

  it("dois cancelamentos da mesma nota (101101 e depois 105102): sem exceção, o primeiro tipo fica e os dois eventos são casados", async () => {
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await gravar(2, eventoXml())).toBe("cancelamento");
    expect(await gravar(3, eventoXml({ tipo: "105102" }))).toBe("cancelamento");
    expect((await q("SELECT cancelamento_tipo FROM obra_notas"))[0].cancelamento_tipo).toBe("101101");
    expect((await q("SELECT count(*)::int n FROM obra_notas_eventos_adn WHERE nota_id IS NULL"))[0].n).toBe(0);
  });

  // ACHADO (baixo, CORRIGIDO): com DOIS eventos de cancelamento guardados antes da nota, só o primeiro é casado; o outro fica pendente
  // para sempre (distribuicao.ts:191-193, `.limit(1)`), embora a 0166 prometa que o evento "é casado quando ela chegar".
  it("dois cancelamentos que chegam ANTES da nota: os dois são casados quando ela chega", async () => {
    expect(await gravar(1, eventoXml())).toBe("cancelamento");
    expect(await gravar(2, eventoXml({ tipo: "105102" }))).toBe("cancelamento");
    expect(await gravar(3, FIXTURE)).toBe("gravada");
    expect((await q("SELECT count(*)::int n FROM obra_notas_eventos_adn WHERE nota_id IS NULL"))[0].n).toBe(0);
  });
});

// ── 4. Outra origem ──

describe("QA 4 — mesma nota por outra origem × duplicata real", () => {
  it("emitentes diferentes com o mesmo número NÃO são ligados (nos dois sentidos)", async () => {
    const g = await notaDeGrupo("G1", { emitenteDocumento: OUTRO_EMITENTE });
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    expect(await q("SELECT duplicada_de, outra_origem_de FROM obra_notas WHERE origem = 'adn'")).toEqual([{ duplicada_de: null, outra_origem_de: null }]);
    const g2 = await notaDeGrupo("G2", { emitenteDocumento: OUTRO_EMITENTE }, "c".repeat(64));
    expect(g2).toMatchObject({ duplicadaDe: g!.id, outraOrigemDe: null });
    const g3 = await notaDeGrupo("G3", { numero: "124" }, "d".repeat(64));
    expect(g3).toMatchObject({ duplicadaDe: null, outraOrigemDe: null });
  });

  it("a do ADN (sem arquivo) não vai ao Drive; a cópia duplicada do grupo também não; só uma pode ser conciliada", async () => {
    await lancamento();
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    const [adn] = await q<{ id: number }>("SELECT id FROM obra_notas WHERE origem = 'adn'");
    const g1 = await notaDeGrupo("G1");
    const g2 = await notaDeGrupo("G2", {}, "e".repeat(64));
    expect(g1).toMatchObject({ outraOrigemDe: adn.id, duplicadaDe: null });
    expect(g2).toMatchObject({ duplicadaDe: g1!.id, outraOrigemDe: null });
    await expect(prepararSalvarNota({ notaId: adn.id }, ctx)).rejects.toThrow(/não é PDF/);
    await expect(prepararSalvarNota({ notaId: g2!.id }, ctx)).rejects.toThrow(/repete a nota/);
    expect((await prepararSalvarNota({ notaId: g1!.id }, ctx)).itens).toHaveLength(1);
    expect((await prepararConciliarNota({ notaId: adn.id }, ctx)).itens).toHaveLength(1);
    await expect(prepararConciliarNota({ notaId: g1!.id }, ctx)).rejects.toThrow(/outra origem/);
    await expect(prepararConciliarNota({ notaId: g2!.id }, ctx)).rejects.toThrow(/duplicada/);
  });

  // ACHADO (médio, CORRIGIDO): a NFS-e OFICIAL do ADN que chega depois de uma nota de grupo com o mesmo emitente + número vira a
  // "outra origem" e a conciliação fica na nota do GRUPO — cujos valor e data vieram da leitura por IA de um arquivo enviado
  // por terceiro no grupo. Se o valor diverge (leitura errada ou arquivo adulterado), nada sinaliza: a do ADN nasce
  // "rascunho" sem dúvida/alerta de divergência (distribuicao.ts:181-200, nfse-recebida.ts:274-286). O certo é, no mínimo,
  // apontar a divergência (confira + alerta) — ou conciliar pela nota oficial.
  it("NFS-e do ADN com VALOR diferente da nota de grupo ligada: a divergência é sinalizada", async () => {
    await notaDeGrupo("G1", { valorCentavos: 950_000 });
    expect(await gravar(1, FIXTURE)).toBe("gravada");
    const [adn] = await q<{ situacao: string; alertas: string[]; duvidas: string[] }>("SELECT situacao, alertas, duvidas FROM obra_notas WHERE origem = 'adn'");
    expect(adn.situacao).toBe("confira");
    expect([...adn.alertas, ...adn.duvidas].join(" ")).toMatch(/valor/i);
  });
});

// ── 5. NSU com falha ──

describe("QA 5 — NSU com falha", () => {
  it("falha passageira: na 2ª rodada o documento grava normalmente (não vira ilegível) e o contador zera", async () => {
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada) VALUES ($1, true)", [TOMADOR]);
    let quebra = true;
    const doc = Object.defineProperty({ nsu: 1 } as DocumentoDistribuido, "xml", { get() { if (quebra) throw new Error("passageira"); return FIXTURE; } });
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: vi.fn(async ({ ultimoNsu }) => ({ documentos: [doc].filter(d => d.nsu > ultimoNsu) })) };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ erros: 1, gravadas: 0 });
    quebra = false;
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ erros: 0, gravadas: 1, ilegiveis: 0 });
    erro.mockRestore();
    expect((await q("SELECT ultimo_nsu::int, nsu_com_falha, tentativas_nsu_com_falha, nsus_ilegiveis FROM fiscal_distribuicao_estado"))[0])
      .toEqual({ ultimo_nsu: 1, nsu_com_falha: null, tentativas_nsu_com_falha: 0, nsus_ilegiveis: [] });
  });

  it("a falha de OUTRO NSU não herda as tentativas do anterior", async () => {
    await q("INSERT INTO fiscal_distribuicao_estado (cnpj, ligada, nsu_com_falha, tentativas_nsu_com_falha) VALUES ($1, true, 1, 2)", [TOMADOR]);
    const quebrado = Object.defineProperty({ nsu: 2 } as DocumentoDistribuido, "xml", { get() { throw new Error("quebra"); } });
    const docs: DocumentoDistribuido[] = [{ nsu: 1, xml: FIXTURE }, quebrado];
    const cliente: ClienteDistribuicaoAdn = { buscarDesde: vi.fn(async ({ ultimoNsu }) => ({ documentos: docs.filter(d => d.nsu > ultimoNsu) })) };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + 30_000, agora: AGORA })).toMatchObject({ gravadas: 1, erros: 1, ilegiveis: 0 });
    erro.mockRestore();
    expect((await q("SELECT ultimo_nsu::int, nsu_com_falha::int, tentativas_nsu_com_falha FROM fiscal_distribuicao_estado"))[0])
      .toEqual({ ultimo_nsu: 1, nsu_com_falha: 2, tentativas_nsu_com_falha: 1 });
  });

  it("concorrência: a mesma NFS-e e o mesmo evento gravados ao mesmo tempo entram uma vez só", async () => {
    const r = await Promise.all([gravar(1, FIXTURE), gravar(1, FIXTURE)]);
    expect([...r].sort()).toEqual(["gravada", "ja_existia"]);
    const e = await Promise.all([gravar(2, eventoXml()), gravar(3, eventoXml())]);
    expect([...e].sort()).toEqual(["cancelamento", "ja_existia"]);
    expect((await q("SELECT count(*)::int n FROM obra_notas_eventos_adn"))[0].n).toBe(1);
    expect((await q("SELECT cancelamento_tipo FROM obra_notas"))[0].cancelamento_tipo).toBe("101101");
  });
});
