// QA S-7 (23/11/2026, @qa Quinn) — portão de segurança e integridade fiscal da S-7 "fechar a emissão". Tenta quebrar as travas,
// a idempotência, o cancelamento, a alíquota oficial e o retorno da Sefin. Nenhuma chamada ao governo: mesma Sefin SIMULADA (HTTPS
// local com mTLS, certificados de TESTE) de emissao-s7.test.ts. Achados abertos ficam como `it.fails` (passam enquanto o defeito existir;
// quando o @dev corrigir, viram falha e devem ser trocados por `it`).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { router } from "../_core/trpc.js";
import { fiscalRouter } from "./router.js";
import { certificadoFiscalRouter } from "./certificado-router.js";
import { gerarRascunhos } from "./gerador.js";
import { abrirPfx, credencialDoEmissor, FRASE_EMISSOR_INATIVO, FRASE_ENVIO_SIMULTANEO, FRASE_SEM_CADEIA_ICP, FRASE_VARIOS_EMISSORES, guardarCertificado, type CredencialA1 } from "./certificado.js";
import { gerarCertificado, pastaDeTeste, SENHA_TESTE } from "./certificados-teste.helper.js";
import { verificarAssinaturaXml } from "./assinatura.js";
import { cancelarNota, emitirNota, FRASE_EMISSOR_DESLIGADO, FRASE_PRODUCAO, TRAVA_EMITINDO_MS, type DepsEmissao } from "./emissao.js";
import { ajustarAncoras, fraseDoErro, validarLeiaute } from "./leiaute.js";
import { montarPedidoCancelamento, PADRAO_ID_PEDIDO } from "./evento.js";
import { ErroDanfse, gerarDanfsePdf, URL_CONSULTA_PUBLICA } from "./danfse.js";
import { FRASES_ERRO, lerNfse } from "./retorno.js";
import { FALTA_ALIQUOTA_SIMPLES, FALTA_REGIME, resolverAliquotaIss } from "./aliquota.js";
import { compactarXml, descompactarXml, ENDERECOS, type MapaEnderecos } from "./sefin.js";
import { montarDps, MAX_NOME } from "./dps.js";
import { AVISO_EMISSAO_INDISPONIVEL, EMISSAO_DISPONIVEL } from "../../shared/fiscal/status.js";
import { ibgeDoMunicipio } from "../../shared/fiscal/municipios.js";
import { SERIE_PADRAO_API } from "../../shared/fiscal/dps-campos.js";
import { motivoDoSerio, nivelDoItem } from "../../shared/dolores/confirmacao.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0154 = ler("0154_fiscal_notas.sql"), M0162 = ler("0162_fiscal_certificados.sql"), M0167 = ler("0167_fiscal_emissao.sql"), M0171 = ler("0171_fiscal_historico_sem_xml.sql"), M0168 = ler("0168_fiscal_folha_fator_r.sql");

const pasta = pastaDeTeste();
let ddl = "";
let cred: CredencialA1;
let certEmissor: ReturnType<typeof gerarCertificado>;
let servidorCert: ReturnType<typeof gerarCertificado>;
beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  certEmissor = gerarCertificado(pasta.dir, "emissor-s7", { cnpj: "11222333000181" });
  cred = await abrirPfx(certEmissor.pfx, SENHA_TESTE);
  servidorCert = gerarCertificado(pasta.dir, "sefin-local", { cn: "localhost", cnpj: "", uso: "serverAuth" });
}, 90_000);

// ── Sefin simulada (HTTPS local com mTLS: só aceita o certificado de teste do emissor) ──
type Modo = "sucesso" | "rejeicao" | "pendurar" | "pendurar_sem_gerar" | "erro500" | "rejeicao_E0822";
let modo: Modo = "sucesso";
let modoEvento: "sucesso" | "rejeicao_E0822" = "sucesso";
let parametros: Record<string, { status: number; corpo: unknown }> = {};
const geradas = new Map<string, { chave: string; xml: string }>();
const recebidos: { metodo: string; caminho: string; corpo?: unknown; clienteCn?: string | null }[] = [];
let servidor: Server; let porta = 0; let nNfse = 0;

function chaveDe(dpsId: string, numero: number): string {
  // mun (7) + ambGer (1) + tpInsc (1) + CNPJ (14) + nNFSe (13) + AAMM (4) + código (9) + DV (1) = 50
  return `${dpsId.slice(3, 10)}2${dpsId.slice(10, 11)}${dpsId.slice(11, 25)}${String(numero).padStart(13, "0")}2611${"123456789"}7`;
}
function nfseDe(dpsAssinada: string, chave: string, numero: number): string {
  const dps = dpsAssinada.replace(/^<\?xml[^>]*\?>/, "");
  return `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}">`
    + `<xLocEmi>Imperatriz</xLocEmi><xLocPrestacao>Imperatriz</xLocPrestacao><nNFSe>${numero}</nNFSe><cLocIncid>2105302</cLocIncid><xLocIncid>Imperatriz</xLocIncid>`
    + `<xTribNac>Serviço de teste</xTribNac><verAplic>SefinNac_Teste</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>100</cStat>`
    + `<dhProc>2026-11-22T10:00:05-03:00</dhProc><nDFSe>99887766</nDFSe>`
    + `<emit><CNPJ>11222333000181</CNPJ><xNome>EMPRESA TESTE SEM VALOR LTDA</xNome><enderNac><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>2105302</cMun><UF>MA</UF><CEP>65900000</CEP></enderNac></emit>`
    + `<valores><vBC>1500.00</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>75.00</vISSQN><vLiq>1500.00</vLiq></valores>${dps}</infNFSe></NFSe>`;
}
const corpoJson = (c: unknown) => JSON.stringify(c);

beforeAll(async () => {
  servidor = createServer({ key: servidorCert.chavePem, cert: servidorCert.certPem, requestCert: true, rejectUnauthorized: true, ca: [certEmissor.certPem] }, (req, res) => {
    const clienteCn = (req.socket as unknown as { getPeerCertificate(): { subject?: { CN?: string } } }).getPeerCertificate().subject?.CN ?? null;
    const partes: Buffer[] = [];
    req.on("data", p => partes.push(p));
    req.on("end", () => {
      const caminho = (req.url ?? "").replace(/^\/API\/SefinNacional/, "");
      const bruto = Buffer.concat(partes).toString("utf8");
      const corpo = bruto ? JSON.parse(bruto) : undefined;
      recebidos.push({ metodo: req.method ?? "", caminho, corpo, clienteCn });
      const responder = (status: number, c: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(corpoJson(c)); };
      if (req.method === "POST" && caminho === "/nfse") {
        const dps = descompactarXml(corpo.dpsXmlGZipB64);
        const id = /Id="(DPS[0-9A-Z]+)"/.exec(dps)![1]!;
        if (modo === "rejeicao") return responder(400, { erros: [{ Codigo: "E0120", Descricao: "Inscricao municipal do CPF 12345678909 nao cadastrada" }] });
        if (modo === "erro500") return responder(500, { mensagem: "erro interno" });
        if (modo === "pendurar_sem_gerar") return; // não responde e NÃO gera
        const ja = geradas.get(id);
        const g = ja ?? (() => { nNfse++; const chave = chaveDe(id, nNfse); const x = { chave, xml: nfseDe(dps, chave, nNfse) }; geradas.set(id, x); return x; })();
        if (modo === "pendurar") return; // gera, mas não responde (queda depois do envio)
        return responder(201, { tipoAmbiente: 2, idDps: id, chaveAcesso: g.chave, nfseXmlGZipB64: compactarXml(g.xml) });
      }
      const dps = /^\/dps\/(DPS[0-9A-Z]+)$/.exec(caminho);
      if (req.method === "GET" && dps) { const g = geradas.get(dps[1]!); return g ? responder(200, { chaveAcesso: g.chave }) : responder(404, { erro: "nao encontrada" }); }
      const nf = /^\/nfse\/([0-9A-Z]{50})$/.exec(caminho);
      if (req.method === "GET" && nf) { const g = Array.from(geradas.values()).find(x => x.chave === nf[1]); return g ? responder(200, { chaveAcesso: g.chave, nfseXmlGZipB64: compactarXml(g.xml) }) : responder(404, {}); }
      const ev = /^\/nfse\/([0-9A-Z]{50})\/eventos$/.exec(caminho);
      if (req.method === "POST" && ev) {
        if (modoEvento === "rejeicao_E0822") return responder(400, { erros: [{ codigo: "E0822", descricao: "prazo" }] });
        const ped = descompactarXml(corpo.pedidoRegistroEventoXmlGZipB64);
        const evento = `<?xml version="1.0" encoding="UTF-8"?><evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infEvento Id="EVT${ev[1]}1011011"><verAplic>SefinNac_Teste</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-11-22T11:00:00-03:00</dhProc><nDFSe>55443322</nDFSe>${ped.replace(/^<\?xml[^>]*\?>/, "")}</infEvento></evento>`;
        return responder(201, { eventoXmlGZipB64: compactarXml(evento) });
      }
      if (req.method === "GET" && /^\/nfse\/[0-9A-Z]{50}\/eventos\/101101\/1$/.test(caminho)) return responder(404, {});
      const pm = parametros[caminho];
      if (req.method === "GET" && pm) return responder(pm.status, pm.corpo);
      return responder(404, {});
    });
  });
  await new Promise<void>(r => servidor.listen(0, "127.0.0.1", () => r()));
  porta = (servidor.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>(r => { servidor.closeAllConnections(); servidor.close(() => { pasta.limpar(); r(); }); }));

const local = (): MapaEnderecos => ({
  producao_restrita: {
    sefin: { host: "localhost", porta, base: "/API/SefinNacional", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
    adn: { host: "localhost", porta, base: "/contribuintes", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
  },
  // Produção apontando para o MESMO servidor local: nenhum teste sai para o governo.
  producao: {
    sefin: { host: "localhost", porta, base: "/API/SefinNacional", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
    adn: ENDERECOS.producao.adn,
  },
});

let agora = new Date("2026-11-22T13:00:00.000Z");
const deps = (o: Partial<DepsEmissao> = {}): DepsEmissao => ({
  emissaoDisponivel: true, enderecos: local(), ca: [servidorCert.certPem], credencial: async () => cred, tempoLimiteMs: 400, agoraFn: () => agora, ...o,
});

let pg: PGlite;
let logs: string[] = [];
const q = async <T = Record<string, unknown>>(t: string, p: unknown[] = []) => (await pg.query<T>(t, p)).rows;
beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(ddl);
  for (const m of [M0154, M0154, M0162, M0167, M0167]) await pg.exec(m);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  modo = "sucesso"; modoEvento = "sucesso"; parametros = {}; geradas.clear(); recebidos.length = 0; nNfse = 0; agora = new Date("2026-11-22T13:00:00.000Z");
  logs = [];
  for (const m of ["log", "warn", "error", "info", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  await pg.exec(`
    INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora', 'colaborador');
    INSERT INTO fiscal_config (id, ligado, inicio_em) VALUES (true, false, '2026-11-01');
    INSERT INTO tax_profiles (company_name, cnpj, regime, effective_from) VALUES ('EMPRESA TESTE SEM VALOR LTDA', '11.222.333/0001-81', 'lucro_presumido', '2026-01-01');
    INSERT INTO fiscal_emissores (id, cnpj, municipio_nome, municipio_uf, municipio_ibge, ambiente, emissao_liberada, parametros_dps)
      VALUES (1, '11222333000181', 'Imperatriz', 'MA', '2105302', 'producao_restrita', true, '{"opSimpNac":"1","regEspTrib":"0"}');
    UPDATE fiscal_tipos_servico SET codigo_tributacao_nacional = '171901', aliquota_iss = 5, emissor_id = 1,
      parametros_dps = '{"tribIssqn":"1","tpRetIssqn":"1","indTotTrib":"0","ibscbs":{"indDest":"0","cst":"000","cClassTrib":"000001"}}'
      WHERE nome = 'Assessoria e honorários (BPO)';
  `);
});
afterEach(async () => {
  // Nada de XML, CPF ou chave privada em log.
  const tudo = logs.join("\n");
  expect(tudo).not.toMatch(/<DPS|<NFSe|PRIVATE KEY|12345678909/);
  vi.restoreAllMocks();
  await pg.close();
});

async function rascunho(): Promise<{ id: number; versao: number }> {
  const [c] = await q<{ id: number }>(`INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio)
    VALUES ('Tomadora Teste Ltda', '55444333000122', 'Resp', '99999999', 100, now()) RETURNING id`);
  await q(`INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, vencimento, pago, pago_em, competencia)
    VALUES ($1, 'honorario', 'Honorário mensal', 1500, now(), true, '2026-11-10T12:00:00Z', '2026-11')`, [c!.id]);
  await gerarRascunhos(getDb(), { origem: "botao", agora: new Date("2026-11-20T15:00:00.000Z") });
  const [n] = await q<{ id: number }>(`SELECT id FROM fiscal_notas ORDER BY id DESC LIMIT 1`);
  const tipo = (await q<{ id: number }>(`SELECT id FROM fiscal_tipos_servico WHERE nome = 'Assessoria e honorários (BPO)'`))[0]!.id;
  await q(`UPDATE fiscal_notas SET emissor_id = 1, tipo_servico_id = $2 WHERE id = $1`, [n!.id, tipo]);
  const [v] = await q<{ id: number; versao: number }>(`SELECT id, versao FROM fiscal_notas WHERE id = $1`, [n!.id]);
  return v!;
}
const nota = async (id: number) => (await q<Record<string, unknown>>(`SELECT * FROM fiscal_notas WHERE id = $1`, [id]))[0]!;
const posts = () => recebidos.filter(r => r.metodo === "POST" && r.caminho === "/nfse");
const autor = { usuarioId: 1, via: "tela" as const };

import { lerRetornoEmissao, lerRetornoEvento } from "./retorno.js";
import { aliquotaMunicipalVigente, aliquotaUnica } from "./parametros-municipais.js";
import { entradaEmitirAprovado, executarCancelarAprovado, executarEmitirAprovado, FRASE_EMISSAO_MUDOU } from "../dolores/acoes/fiscal.js";
import { FRASE_AMBIENTE_MUDOU, FRASE_CANCELAMENTO_DESLIGADO, marcarVerificarManualmente, ORCAMENTO_EMISSAO_MS } from "./emissao.js";
import { semValidadeJuridica } from "./danfse.js";
import { aliquotaSimplesDaNota, fonteSimplesDaS8, paraDps } from "./simples.js";
import { FONTES_ALIQUOTA } from "./aliquota.js";
import { carregarNota } from "./notas.js";
import { ARQUIVOS_DO_VALIDADOR, ErroLeiaute, pastaDoValidador } from "./leiaute.js";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RESERVA_MINIMA_ENTRADA } from "../dolores/cerebro.js";

const app = router({ fiscal: fiscalRouter });
const como = (role: "admin" | "colaborador") =>
  app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active: true, permissions: '["bpo"]' }, req: { headers: {} }, res: {} } as never);
const dpsEnviada = (i = 0) => descompactarXml((posts()[i]!.corpo as { dpsXmlGZipB64: string }).dpsXmlGZipB64);
const PARAMS_PRODUCAO = `UPDATE fiscal_tipos_servico SET parametros_dps = jsonb_set(parametros_dps, '{ibscbs,cIndOp}', '"100301"') WHERE nome = 'Assessoria e honorários (BPO)'`;

describe("QA S-7 — travas (nada sai com qualquer uma fechada)", () => {
  it("ambiente desligado com o interruptor ligado: recusa sem rede e sem gravar (versão e número intactos)", async () => {
    const n = await rascunho();
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'desligado', emissao_liberada = true`);
    const antes = await nota(n.id);
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(FRASE_EMISSOR_DESLIGADO);
    const depois = await nota(n.id);
    expect(depois.versao).toBe(antes.versao);
    expect(depois.numero_dps).toBeNull();
    expect((await q<{ p: number }>(`SELECT proximo_numero_dps AS p FROM fiscal_emissores WHERE id = 1`))[0]!.p).toBe(1);
    expect(recebidos).toHaveLength(0);
  });
  it("gatilho: SQL direto não leva a EMITINDO com ambiente desligado, nem com ambiente_emissao diferente do emissor", async () => {
    const n = await rascunho();
    const id = "DPS210530221122233300018100001000000000000009";
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'desligado', emissao_liberada = true`);
    await expect(pg.query(`UPDATE fiscal_notas SET status='EMITINDO', dps_id=$2, numero_dps=9, ambiente_emissao='producao_restrita' WHERE id=$1`, [n.id, id])).rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'producao_restrita'`);
    await expect(pg.query(`UPDATE fiscal_notas SET status='EMITINDO', dps_id=$2, numero_dps=9, ambiente_emissao='producao' WHERE id=$1`, [n.id, id])).rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    await expect(pg.query(`INSERT INTO fiscal_notas (origem_tipo, origem_id, status, valor_centavos, data_evento) VALUES ('bpo_lancamento', 999999, 'EMITIDA', 1, '2026-11-01')`)).rejects.toThrow();
  });
  it("rotas: colaborador não emite, não cancela, não baixa XML/DANFSe e não troca ambiente; nenhuma rede", async () => {
    const n = await rascunho();
    const c = como("colaborador");
    await expect(c.fiscal.notas.emitir({ ...n, ambienteEsperado: "producao_restrita" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.fiscal.notas.cancelar({ ...n, motivo: 1, justificativa: "Justificativa de teste longa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.fiscal.notas.xml({ id: n.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.fiscal.notas.danfse({ id: n.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.fiscal.emissores.ambiente({ emissorId: 1, ambiente: "producao_restrita" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(recebidos).toHaveLength(0);
  });
  it("frase de produção com espaços/caixa trocada ou parecida é recusada no servidor", async () => {
    for (const frase of ["emitir em produção", "EMITIR EM PRODUCAO", "EMITIR  EM PRODUÇÃO", "EMITIR EM PRODUÇÃO!"]) {
      await expect(como("admin").fiscal.emissores.ambiente({ emissorId: 1, ambiente: "producao", frase })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await q<{ a: string }>(`SELECT ambiente AS a FROM fiscal_emissores WHERE id = 1`))[0]!.a).toBe("producao_restrita");
  });
  it("Dolores: emitir/cancelar fora do WhatsApp (tela/ponte) recusam antes de qualquer coisa; com EMISSAO_DISPONIVEL false (desvio de teste), recusam sem rede", async () => {
    const ctxTela = { agora: new Date(), autorId: 1, mensagemId: 1, pedidoId: null, aprovacaoId: null, motivoContaminacao: null, via: "tela" } as never;
    await expect(executarEmitirAprovado({ notaFiscalId: 1, versao: 1, ambiente: "producao_restrita", liberada: true }, ctxTela, { emissaoDisponivel: true })).rejects.toThrow(/WhatsApp/);
    await expect(executarCancelarAprovado({ notaFiscalId: 1, versao: 1, motivo: 1, justificativa: "Justificativa de teste longa" }, ctxTela, { emissaoDisponivel: true })).rejects.toThrow(/WhatsApp/);
    const ctxWa = { agora: new Date(), autorId: 1, mensagemId: 1, pedidoId: null, aprovacaoId: null, motivoContaminacao: null, via: "whatsapp" } as never;
    await expect(executarEmitirAprovado({ notaFiscalId: 1, versao: 1, ambiente: "producao_restrita", liberada: true }, ctxWa, { emissaoDisponivel: false })).rejects.toThrow(/ativa/);
    await expect(executarCancelarAprovado({ notaFiscalId: 1, versao: 1, motivo: 1, justificativa: "Justificativa de teste longa" }, ctxWa, { emissaoDisponivel: false })).rejects.toThrow(/ativa/);
    expect(recebidos).toHaveLength(0);
  });
  it("Dolores com EMISSAO_DISPONIVEL true (sem desvio): empresa não liberada ou ambiente desligado → recusa sem rede, nota intacta", async () => {
    expect(EMISSAO_DISPONIVEL).toBe(true);
    const ctxWa = { agora: new Date(), autorId: 1, mensagemId: 1, pedidoId: null, aprovacaoId: null, motivoContaminacao: null, via: "whatsapp" } as never;
    const n = await rascunho();
    const antes = await nota(n.id);
    // empresa não liberada (o dono confirmou o resumo "nada sai"): a execução chega à emissão, que recusa
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = false, ambiente = 'producao_restrita'`);
    await expect(executarEmitirAprovado({ notaFiscalId: n.id, versao: n.versao, ambiente: "producao_restrita", liberada: false }, ctxWa)).rejects.toThrow(FRASE_EMISSOR_DESLIGADO);
    // ambiente desligado com o interruptor ligado
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = true, ambiente = 'desligado'`);
    await expect(executarEmitirAprovado({ notaFiscalId: n.id, versao: n.versao, ambiente: "desligado", liberada: false }, ctxWa)).rejects.toThrow(FRASE_EMISSOR_DESLIGADO);
    expect(await nota(n.id)).toMatchObject({ status: antes.status, versao: antes.versao, numero_dps: null, dps_id: null });
    expect(recebidos).toHaveLength(0);
  });
});

describe("QA S-7 — idempotência e segredo no retorno", () => {
  it("rejeição com texto cru (CPF) da Sefin: nada do texto vai para fiscal_eventos, ultimo_erro ou a resposta", async () => {
    const n = await rascunho();
    modo = "rejeicao";
    const r = await emitirNota(getDb(), { ...n, ...autor }, deps());
    expect(r.situacao).toBe("rejeitada");
    expect(JSON.stringify(r)).not.toMatch(/12345678909|nao cadastrada/);
    const eventos = await q(`SELECT * FROM fiscal_eventos WHERE nota_id = $1`, [n.id]);
    expect(JSON.stringify(eventos)).not.toMatch(/12345678909|nao cadastrada/);
    expect(JSON.stringify((await nota(n.id)).ultimo_erro)).not.toMatch(/12345678909|nao cadastrada/);
  });
  it("lista e detalhe (admin e colaborador) nunca levam xmlDps/xmlNfse/congelado depois de emitida", async () => {
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    for (const role of ["admin", "colaborador"] as const) {
      const ver = await como(role).fiscal.notas.ver({ id: n.id });
      const lista = await como(role).fiscal.notas.listar();
      for (const o of [ver, ...lista.itens]) {
        expect(o).not.toHaveProperty("xmlDps"); expect(o).not.toHaveProperty("xmlNfse"); expect(o).not.toHaveProperty("congelado");
      }
      expect(JSON.stringify(await como(role).fiscal.notas.eventos({ id: n.id }))).not.toMatch(/<NFSe|<DPS/);
    }
  });
  it("três cliques ao mesmo tempo e um quarto depois: um só POST, um só número de DPS, próximo número avança 1", async () => {
    const n = await rascunho();
    const rs = await Promise.allSettled([1, 2, 3].map(() => emitirNota(getDb(), { ...n, ...autor }, deps())));
    expect(rs.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("ja_emitida");
    expect(posts()).toHaveLength(1);
    expect((await q<{ p: number }>(`SELECT proximo_numero_dps AS p FROM fiscal_emissores WHERE id = 1`))[0]!.p).toBe(2);
  });
  it("recusa ANTES da reserva (Simples sem tabela) não consome número nem grava", async () => {
    await pg.exec(`UPDATE tax_profiles SET regime = 'simples_nacional'`);
    const n = await rascunho();
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow();
    expect((await nota(n.id)).numero_dps).toBeNull();
    expect((await q<{ p: number }>(`SELECT proximo_numero_dps AS p FROM fiscal_emissores WHERE id = 1`))[0]!.p).toBe(1);
    expect(recebidos).toHaveLength(0);
  });

  // ACHADO M2 (médio): a NFS-e devolvida é aceita como "desta DPS" mesmo SEM o grupo DPS/infDPS dentro (o Id só é conferido se existir)
  // e sem conferir o CNPJ do emitente nem o tpAmb. Resposta 2xx com outra NFS-e qualquer viraria EMITIDA com chave/número errados.
  it("ACHADO M2 (corrigido): NFS-e devolvida sem o grupo da DPS (ou de outro emitente) deve ser INCERTA, nunca autorizada", () => {
    const chave = chaveDe("DPS210530221122233300018100001000000000000001", 1);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}"><nNFSe>1</nNFSe>`
      + `<emit><CNPJ>99888777000166</CNPJ><xNome>OUTRA EMPRESA</xNome></emit></infNFSe></NFSe>`;
    expect(chave).toHaveLength(50);
    const r = lerRetornoEmissao(201, JSON.stringify({ nfseXmlGZipB64: compactarXml(xml) }), "DPS210530221122233300018100001000000000000001");
    expect(r.tipo).toBe("incerta");
    expect(lerRetornoEmissao(201, JSON.stringify({ nfseXmlGZipB64: compactarXml(xml) }), "DPS210530221122233300018100001000000000000001", { ambiente: "producao_restrita", cnpj: "11222333000181" }).tipo).toBe("incerta");
  });
  it("M2: com a DPS certa, só é autorizada com tpAmb e CNPJ do emitente conferidos; Id divergente, outro ambiente ou outro CNPJ → incerta", () => {
    const dpsId = "DPS210530221122233300018100001000000000000001";
    const chave = chaveDe(dpsId, 1);
    const xml = (o: { id?: string; tpAmb?: string; cnpj?: string } = {}) => nfseDe(`<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${o.id ?? dpsId}"><tpAmb>${o.tpAmb ?? "2"}</tpAmb></infDPS></DPS>`, chave, 1)
      .replace("<emit><CNPJ>11222333000181</CNPJ>", `<emit><CNPJ>${o.cnpj ?? "11222333000181"}</CNPJ>`);
    const ler = (x: string, esperado?: { ambiente: "producao_restrita" | "producao"; cnpj: string }) => lerRetornoEmissao(201, JSON.stringify({ nfseXmlGZipB64: compactarXml(x) }), dpsId, esperado).tipo;
    const certo = { ambiente: "producao_restrita" as const, cnpj: "11222333000181" };
    expect(ler(xml(), certo)).toBe("autorizada");
    expect(ler(xml())).toBe("incerta"); // sem o esperado: nunca autorizada
    expect(ler(xml({ id: "DPS210530221122233300018100001000000000000002" }), certo)).toBe("incerta");
    expect(ler(xml({ tpAmb: "1" }), certo)).toBe("incerta");
    expect(ler(xml(), { ...certo, ambiente: "producao" })).toBe("incerta");
    expect(ler(xml({ cnpj: "99888777000166" }), certo)).toBe("incerta");
  });
  it("B2: 408 e 429 são INCERTAS (consultar antes), não rejeição — na emissão e no evento", () => {
    for (const st of [408, 429]) {
      expect(lerRetornoEmissao(st, JSON.stringify({ erros: [{ codigo: "E0120" }] }), "DPS210530221122233300018100001000000000000001").tipo).toBe("incerta");
      expect(lerRetornoEvento(st, "{}", "1".repeat(50)).tipo).toBe("incerto");
    }
    expect(lerRetornoEmissao(400, JSON.stringify({ erros: [{ codigo: "E0120" }] }), "DPS210530221122233300018100001000000000000001").tipo).toBe("rejeitada");
  });
});

describe("QA S-7 — cancelamento", () => {
  async function emitida() {
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    return nota(n.id);
  }
  it("dois cancelamentos ao mesmo tempo: um só CANCELADA e um só evento autorizado", async () => {
    const n = await emitida();
    const e = { id: Number(n.id), versao: Number(n.versao), motivo: 1, justificativa: "Valor digitado errado na nota", ...autor };
    await Promise.allSettled([cancelarNota(getDb(), e, deps()), cancelarNota(getDb(), e, deps())]);
    expect((await nota(e.id)).status).toBe("CANCELADA");
    expect(await q(`SELECT 1 FROM fiscal_eventos WHERE nota_id = $1 AND tipo = 'cancelamento' AND situacao = 'autorizada'`, [e.id])).toHaveLength(1);
  });
  it("nota emitida em produção restrita é cancelada em produção restrita mesmo com o emissor já em produção (tpAmb 2)", async () => {
    const n = await emitida();
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'producao'`);
    await cancelarNota(getDb(), { id: Number(n.id), versao: Number(n.versao), motivo: 9, justificativa: "Cancelamento de teste de QA", ...autor }, deps());
    const ped = descompactarXml((recebidos.find(r => r.metodo === "POST" && /\/eventos$/.test(r.caminho))!.corpo as { pedidoRegistroEventoXmlGZipB64: string }).pedidoRegistroEventoXmlGZipB64);
    expect(ped).toContain("<tpAmb>2</tpAmb>");
  });
  it("justificativa só com espaços/controles, motivo fora da lista e rascunho: recusam sem rede", async () => {
    const n = await rascunho();
    await expect(cancelarNota(getDb(), { ...n, motivo: 1, justificativa: "Justificativa de teste longa", ...autor }, deps())).rejects.toThrow(/emitida/);
    const e = await emitida();
    const antes = recebidos.length;
    await expect(cancelarNota(getDb(), { id: Number(e.id), versao: Number(e.versao), motivo: 3, justificativa: "Justificativa de teste longa", ...autor }, deps())).rejects.toThrow(/motivo/);
    await expect(cancelarNota(getDb(), { id: Number(e.id), versao: Number(e.versao), motivo: 1, justificativa: "\u0000\u0001                 \t\t\t", ...autor }, deps())).rejects.toThrow(/15/);
    expect(recebidos.length).toBe(antes);
  });
});

describe("QA S-7 — alíquota oficial", () => {
  it("resposta ambígua → sem alíquota; uma só → ela", () => {
    expect(aliquotaUnica({ aliquotas: [{ aliquota: 2 }, { aliquota: 3 }] })).toBeNull();
    expect(aliquotaUnica({ x: { aliquotaMinima: 2, aliquotaMaxima: 5 } })).toBeNull();
    expect(aliquotaUnica({ aliq: "2,5" })).toBe(2.5);
    expect(aliquotaUnica({})).toBeNull();
  });

  // ACHADO I2 (importante): aliquotaMunicipalVigente ignora o AMBIENTE da consulta. Uma alíquota lida na PRODUÇÃO RESTRITA (base de
  // testes da Sefin) e aceita vale na DPS de PRODUÇÃO (nota com valor fiscal).
  it("ACHADO I2 (corrigido): alíquota consultada na produção restrita não pode valer numa DPS de produção", async () => {
    await pg.exec(PARAMS_PRODUCAO);
    await pg.exec(`INSERT INTO fiscal_parametros_municipais (emissor_id, consulta, municipio_ibge, codigo_servico, ambiente, http_status, aliquota, aliquota_digitada, situacao)
      VALUES (1, 'aliquota', '2105302', '171901', 'producao_restrita', 200, 2, NULL, 'aceita')`);
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'producao'`);
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    expect(dpsEnviada()).not.toContain("<pAliq>2.00</pAliq>");
  });

  // ACHADO M1 (médio): a consulta mais recente vale, mesmo que tenha FALHADO (HTTP 500 → "sem_valor"). Uma falha passageira troca, em
  // silêncio, a alíquota oficial já aceita pela digitada no tipo de serviço — contra "nunca sobrescrever em silêncio".
  it("ACHADO M1 (corrigido): consulta que falhou (HTTP 500, sem_valor) não pode derrubar em silêncio a alíquota oficial já aceita", async () => {
    await pg.exec(`INSERT INTO fiscal_parametros_municipais (emissor_id, consulta, municipio_ibge, codigo_servico, ambiente, http_status, aliquota, aliquota_digitada, situacao)
      VALUES (1, 'aliquota', '2105302', '171901', 'producao_restrita', 200, 2, NULL, 'aceita'),
             (1, 'aliquota', '2105302', '171901', 'producao_restrita', 500, NULL, 5, 'sem_valor')`);
    const n = await rascunho();
    let enviouADigitada = false;
    try { await emitirNota(getDb(), { ...n, ...autor }, deps()); enviouADigitada = posts().length > 0 && dpsEnviada().includes("<pAliq>5.00</pAliq>"); }
    catch { /* recusar pedindo nova consulta/escolha também é aceitável */ }
    expect(enviouADigitada).toBe(false);
    // e a oficial aceita (2%) é a que vale
    expect(dpsEnviada()).toContain("<pAliq>2.00</pAliq>");
  });
  it("M1: resolverAliquotaIss nunca troca a oficial pela digitada em silêncio — sem_valor recusa pedindo nova consulta", async () => {
    const ctx = { emissorCnpj: "11222333000181", competencia: "2026-11-01", municipioIncidenciaIbge: "2105302", tipoServico: { id: 1, itemLc116: "17.19", codigoAtividadeSimples: null, aliquotaIss: "5" } };
    expect(await resolverAliquotaIss("lucro_presumido", { ...ctx, municipal: { aliquota: null, aliquotaDigitada: "5", situacao: "sem_valor" } })).toMatchObject({ aliquota: null, falta: expect.stringMatching(/busque as alíquotas oficiais de novo/) });
    expect(await resolverAliquotaIss("lucro_presumido", { ...ctx, municipal: { aliquota: null, aliquotaDigitada: "5", situacao: "aceita" } })).toMatchObject({ aliquota: null });
    expect(await resolverAliquotaIss("lucro_presumido", { ...ctx, municipal: { aliquota: "2", aliquotaDigitada: "5", situacao: "recusada" } })).toEqual({ aliquota: "5", fonte: "tipo_servico" });
  });
  it("I2/M1: a vigente filtra o ambiente e ignora as falhas (só falhas → nenhuma vigente)", async () => {
    await pg.exec(`INSERT INTO fiscal_parametros_municipais (emissor_id, consulta, municipio_ibge, codigo_servico, ambiente, http_status, aliquota, aliquota_digitada, situacao)
      VALUES (1, 'aliquota', '2105302', '171901', 'producao', 200, 3, NULL, 'aceita'),
             (1, 'aliquota', '2105302', '171901', 'producao_restrita', 200, 2, NULL, 'aceita'),
             (1, 'aliquota', '2105302', '171901', 'producao_restrita', 500, NULL, 5, 'sem_valor'),
             (1, 'aliquota', '2105302', '171901', 'producao', 200, NULL, 5, 'sem_valor')`);
    expect((await aliquotaMunicipalVigente(getDb(), "2105302", "171901", "producao_restrita"))).toMatchObject({ situacao: "aceita", aliquota: "2.0000" });
    expect((await aliquotaMunicipalVigente(getDb(), "2105302", "171901", "producao"))).toMatchObject({ situacao: "aceita", aliquota: "3.0000" });
    expect(await aliquotaMunicipalVigente(getDb(), "2105302", "999999", "producao")).toBeNull();
  });
});

describe("QA S-7 — Dolores: a confirmação amarra o que foi mostrado", () => {
  // ACHADO I1 (importante): o item da fila de emitir_nota_fiscal guarda só { notaFiscalId, versao }. O resumo que o dono confirma diz o
  // ambiente lido NA PREPARAÇÃO ("AMBIENTE DE TESTES, sem valor fiscal"); se o admin trocar o emissor para produção antes do "confirmo"
  // (a fila vale horas), a execução emite em PRODUÇÃO sem conferir — nota com valor fiscal que o dono não confirmou. A versão da NOTA não
  // muda quando o ambiente do EMISSOR muda.
  it("ACHADO I1 (corrigido): o item aprovado de emitir carrega o ambiente mostrado (e a execução recusa se mudou)", () => {
    expect(entradaEmitirAprovado.safeParse({ notaFiscalId: 1, versao: 1, ambiente: "producao_restrita" }).success).toBe(true);
    expect(entradaEmitirAprovado.safeParse({ notaFiscalId: 1, versao: 1 }).success).toBe(false);
    expect(entradaEmitirAprovado.parse({ notaFiscalId: 1, versao: 1, ambiente: "producao_restrita" }).liberada).toBe(false);
  });
  const ctxWa = () => ({ agora: new Date(), autorId: 1, mensagemId: 1, pedidoId: null, aprovacaoId: null, motivoContaminacao: null, via: "whatsapp" }) as never;
  it("I1: aprovado em produção restrita e o emissor virou produção antes do \"confirmo\" → recusa sem rede, nota intacta", async () => {
    const n = await rascunho();
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'producao'`);
    const antes = await nota(n.id);
    await expect(executarEmitirAprovado({ notaFiscalId: n.id, versao: n.versao, ambiente: "producao_restrita", liberada: true }, ctxWa(), { emissaoDisponivel: true })).rejects.toThrow(FRASE_EMISSAO_MUDOU);
    expect(await nota(n.id)).toMatchObject({ status: antes.status, versao: antes.versao, numero_dps: null });
    expect(recebidos).toHaveLength(0);
  });
  it("I1: aprovado com a emissão NÃO liberada (\"nada sai\") e depois liberada → recusa; interruptor desligado depois do aprovado → recusa", async () => {
    const n = await rascunho();
    await expect(executarEmitirAprovado({ notaFiscalId: n.id, versao: n.versao, ambiente: "producao_restrita", liberada: false }, ctxWa(), { emissaoDisponivel: true })).rejects.toThrow(FRASE_EMISSAO_MUDOU);
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = false`);
    await expect(executarEmitirAprovado({ notaFiscalId: n.id, versao: n.versao, ambiente: "producao_restrita", liberada: true }, ctxWa(), { emissaoDisponivel: true })).rejects.toThrow(FRASE_EMISSAO_MUDOU);
    expect(recebidos).toHaveLength(0);
  });
  it("I1: emitirNota com ambienteEsperado diferente do emissor recusa antes de reservar (corrida fechada também na reserva)", async () => {
    const n = await rascunho();
    await expect(emitirNota(getDb(), { ...n, ...autor, ambienteEsperado: "producao" }, deps())).rejects.toThrow(FRASE_AMBIENTE_MUDOU);
    expect((await nota(n.id)).numero_dps).toBeNull();
    expect(recebidos).toHaveLength(0);
    expect((await emitirNota(getDb(), { ...n, ...autor, ambienteEsperado: "producao_restrita" }, deps())).situacao).toBe("emitida");
  });
});

describe("QA S-7 — baixos (B1, B3, B4, B5, B6, B7, B8)", () => {
  it("B1: nota presa em EMITINDO → admin marca \"verificar manualmente\": ERRO manual, emissor liberado, histórico, nada apagado; nova tentativa consulta antes", async () => {
    const n = await rascunho();
    modo = "pendurar";
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("incerta");
    const presa = await nota(n.id);
    expect(presa.status).toBe("EMITINDO");
    // colaborador não pode; trava recente recusa
    await expect(como("colaborador").fiscal.notas.verificarManualmente({ id: n.id, versao: Number(presa.versao) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(marcarVerificarManualmente(getDb(), { id: n.id, versao: Number(presa.versao), ...autor }, { agoraFn: () => agora })).rejects.toThrow(/sendo emitida/);
    agora = new Date(agora.getTime() + TRAVA_EMITINDO_MS + 1_000);
    // emissor não troca de ambiente com nota EMITINDO
    await expect(como("admin").fiscal.emissores.ambiente({ emissorId: 1, ambiente: "desligado" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const r = await marcarVerificarManualmente(getDb(), { id: n.id, versao: Number(presa.versao), ...autor }, { agoraFn: () => agora });
    expect(r.mensagem).toMatch(/nada foi enviado nem apagado/);
    const marcada = await nota(n.id);
    expect(marcada).toMatchObject({ status: "ERRO", dps_id: presa.dps_id, numero_dps: presa.numero_dps });
    expect((marcada.ultimo_erro as { manual?: boolean }).manual).toBe(true);
    const hist = await q<{ acao: string; usuario_id: number }>(`SELECT acao, usuario_id FROM fiscal_notas_historico WHERE nota_id = $1 ORDER BY id DESC LIMIT 1`, [n.id]);
    expect(hist[0]).toMatchObject({ acao: "erro", usuario_id: 1 });
    // a Sefin TINHA gerado a nota: tentar de novo consulta e recupera, sem segundo POST
    modo = "sucesso";
    const postsAntes = posts().length;
    expect((await emitirNota(getDb(), { id: n.id, versao: Number(marcada.versao), ...autor }, deps())).situacao).toBe("emitida");
    expect(posts().length).toBe(postsAntes);
    expect(geradas.size).toBe(1);
  });
  it("B3: orçamento total — sem tempo restante a chamada nem sai (resultado incerto, nota segue EMITINDO, nenhum POST)", async () => {
    expect(ORCAMENTO_EMISSAO_MS).toBeLessThan(55_000);
    const n = await rascunho();
    const r = await emitirNota(getDb(), { ...n, ...autor }, { ...deps(), prazoFinalMs: Date.now() + 500 });
    expect(r.situacao).toBe("incerta");
    expect((await nota(n.id)).status).toBe("EMITINDO");
    expect(posts()).toHaveLength(0);
  });
  it("B4: DANFSe com XML sem tpAmb legível ainda leva \"SEM VALIDADE JURÍDICA\" quando a nota foi emitida em produção restrita", () => {
    expect(semValidadeJuridica(null, "producao_restrita")).toBe(true);
    expect(semValidadeJuridica("1", "producao_restrita")).toBe(true);
    expect(semValidadeJuridica("2", null)).toBe(true);
    expect(semValidadeJuridica("1", "producao")).toBe(false);
  });
  it("B5: DANFSe pela Dolores segue DOLORES_MASCARAR_DADOS_PESSOAIS (como a prévia): ligado → documento do tomador mascarado; desligado → completo", async () => {
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    const xml = String((await nota(n.id)).xml_nfse);
    const descritor = Object.getOwnPropertyDescriptor(Array.prototype, "random");
    if (descritor?.enumerable) Object.defineProperty(Array.prototype, "random", { ...descritor, enumerable: false });
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { campoPessoal } = await import("../dolores/dados-pessoais.js");
    const textoDe = async (pdf: Uint8Array) => String((await extractText(await getDocumentProxy(pdf), { mergePages: true })).text).replace(/\s+/g, " ");
    const opcoes = { campo: (v: string, tipo: "cpf" | "cnpj" | "telefone" | "email") => campoPessoal(v, tipo, "whatsapp"), texto: (t: string) => t };
    const antes = process.env.DOLORES_MASCARAR_DADOS_PESSOAIS;
    try {
      process.env.DOLORES_MASCARAR_DADOS_PESSOAIS = "1";
      const mascarado = await textoDe(gerarDanfsePdf(xml, { ambienteEmissao: "producao_restrita", dadosPessoais: opcoes }));
      expect(mascarado).not.toContain("55.444.333/0001-22");
      expect(mascarado).toContain("11.222.333/0001-81"); // o prestador (a própria empresa) não é dado pessoal de terceiro
      process.env.DOLORES_MASCARAR_DADOS_PESSOAIS = "0";
      expect(await textoDe(gerarDanfsePdf(xml, { ambienteEmissao: "producao_restrita", dadosPessoais: opcoes }))).toContain("55.444.333/0001-22");
    } finally {
      if (antes === undefined) delete process.env.DOLORES_MASCARAR_DADOS_PESSOAIS; else process.env.DOLORES_MASCARAR_DADOS_PESSOAIS = antes;
    }
  });
  it("B6: o histórico não copia xml_dps nem xml_nfse (0171)", async () => {
    await pg.exec(M0171);
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    const hist = await q<{ antes: Record<string, unknown> | null; depois: Record<string, unknown> }>(`SELECT antes, depois FROM fiscal_notas_historico WHERE nota_id = $1`, [n.id]);
    expect(hist.length).toBeGreaterThan(1);
    for (const h of hist) { expect(h.depois).not.toHaveProperty("xml_dps"); expect(h.depois).not.toHaveProperty("xml_nfse"); if (h.antes) expect(h.antes).not.toHaveProperty("xml_nfse"); }
    expect(JSON.stringify(hist)).not.toMatch(/<DPS|<NFSe/);
    await pg.exec(M0171); // idempotente
  });
  it("B7: validador — cópia em shared/fiscal/xsd/vendor (sem node_modules no vercel.json), e a falta dele falha FECHADA", async () => {
    const dir = pastaDoValidador();
    for (const f of ARQUIVOS_DO_VALIDADOR) expect(existsSync(join(dir, f))).toBe(true);
    const raiz = fileURLToPath(new URL("../../", import.meta.url));
    expect(relative(raiz, dir).split(sep).join("/")).toBe("shared/fiscal/xsd/vendor/xmllint-wasm");
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { functions: Record<string, { includeFiles: string }> };
    const inc = vercel.functions["api/index.ts"]!.includeFiles;
    expect(inc).toContain("shared/fiscal/xsd/**");
    expect(inc).not.toMatch(/node_modules/);
    await expect(validarLeiaute("<a/>", "dps", "producao_restrita", { pastaValidador: pasta.dir })).rejects.toThrow(ErroLeiaute);
    await expect(validarLeiaute("<a/>", "dps", "producao_restrita", { carregar: async () => { throw new Error("Cannot find module"); } })).rejects.toThrow(/validador indisponível/);
  });
  it("B8: cancelamento com o emissor desligado (ambiente ou interruptor) recusa sem rede", async () => {
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    const e = await nota(n.id);
    const antes = recebidos.length;
    const pedido = { id: Number(e.id), versao: Number(e.versao), motivo: 1, justificativa: "Valor digitado errado na nota", ...autor };
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = false`);
    await expect(cancelarNota(getDb(), pedido, deps())).rejects.toThrow(FRASE_CANCELAMENTO_DESLIGADO);
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = true, ambiente = 'desligado'`);
    await expect(cancelarNota(getDb(), pedido, deps())).rejects.toThrow(FRASE_CANCELAMENTO_DESLIGADO);
    expect(recebidos.length).toBe(antes);
    expect((await nota(n.id)).status).toBe("EMITIDA");
  });
});

describe("S-7 × S-8 — alíquota do Simples calculada pelo sistema na emissão (ponta a ponta)", () => {
  const simples = async () => {
    await pg.exec(M0168);
    await pg.exec(`UPDATE tax_profiles SET regime = 'simples_nacional'`);
    await pg.exec(`UPDATE fiscal_emissores SET parametros_dps = '{"opSimpNac":"3","regApTribSN":"1","regEspTrib":"0"}'`);
    await pg.exec(`UPDATE fiscal_tipos_servico SET codigo_atividade_simples = '9' WHERE nome = 'Assessoria e honorários (BPO)'`);
  };
  it("emissor do Simples: a DPS enviada leva no pAliq a alíquota da S-8 (2 casas), não a digitada no tipo", async () => {
    await simples();
    const n = await rascunho();
    const esperado = paraDps(await aliquotaSimplesDaNota(getDb(), await carregarNota(getDb(), n.id)));
    expect(esperado?.falta ?? null).toBeNull();
    expect(esperado?.aliquotaIss).toMatch(/^\d+\.\d{2}$/);
    expect(esperado?.aliquotaIss).not.toBe("5.00");
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    expect(dpsEnviada()).toContain(`<pAliq>${esperado!.aliquotaIss}</pAliq>`);
    expect(dpsEnviada()).not.toContain("<cAtvSN>"); // v1.01: fora do regTrib
  });
  it("Simples sem cálculo possível (sem tabela do período) recusa com a frase da S-8, sem rede e sem reservar", async () => {
    await simples();
    const n = await rascunho();
    await q(`UPDATE fiscal_notas SET data_evento = '2017-06-01' WHERE id = $1`, [n.id]);
    const v = (await nota(n.id)).versao as number;
    await expect(emitirNota(getDb(), { id: n.id, versao: v, ...autor }, deps())).rejects.toThrow(/alíquota do Simples/);
    expect((await nota(n.id)).numero_dps).toBeNull();
    expect(recebidos).toHaveLength(0);
  });
  it("regime a_confirmar: recusa (a DPS não é montada), sem rede e sem número", async () => {
    await pg.exec(`UPDATE tax_profiles SET regime = 'a_confirmar'`);
    const n = await rascunho();
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(/regime tributário/);
    expect((await nota(n.id)).numero_dps).toBeNull();
    expect(recebidos).toHaveLength(0);
  });
  it("a fonte registrada é a da S-8", () => {
    expect(FONTES_ALIQUOTA.simples).toBe(fonteSimplesDaS8);
  });
});

describe("QA S-7 — merge com a S-6", () => {
  it("RESERVA_MINIMA_ENTRADA nunca abaixo do piso desta etapa (21.500); a S-6 sobe para 22.000 — o merge fica com o maior", () => {
    expect(RESERVA_MINIMA_ENTRADA).toBeGreaterThanOrEqual(21_500);
  });
});
