// EPIC-029 S-7 (22/11/2026) — fechar a emissão. Nenhuma chamada ao governo: Sefin SIMULADA num servidor HTTPS local com mTLS
// (certificados de TESTE gerados aqui). Cobre: travas, sucesso, rejeição, tempo esgotado, duplicidade (consulta da DPS antes de
// reenviar), concorrência, gatilho da 0167, cancelamento (e101101), DANFSe (texto do PDF), XSD (válida passa, inválida recusa),
// alíquota (Simples, a_confirmar, parâmetros municipais oficiais com escolha), ambiente de produção com a frase, e as
// pendências da revisão da S-4 (certificado).
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
const M0154 = ler("0154_fiscal_notas.sql"), M0162 = ler("0162_fiscal_certificados.sql"), M0167 = ler("0167_fiscal_emissao.sql");

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

describe("travas — nada sai com qualquer uma fechada", () => {
  it("EMISSAO_DISPONIVEL do código continua false; sem a liberação do emissor ou com ambiente desligado, recusa sem rede", async () => {
    expect(EMISSAO_DISPONIVEL).toBe(false);
    const n = await rascunho();
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps({ emissaoDisponivel: undefined }))).rejects.toThrow(AVISO_EMISSAO_INDISPONIVEL);
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = false`);
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(FRASE_EMISSOR_DESLIGADO);
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = true, ambiente = 'desligado'`);
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(FRASE_EMISSOR_DESLIGADO);
    expect(recebidos).toHaveLength(0);
    expect(await nota(n.id)).toMatchObject({ status: "A_DECIDIR", dps_id: null, numero_dps: null });
  });
  it("a rota da tela (sem o desvio de teste) recusa com a frase da homologação", async () => {
    const n = await rascunho();
    const app = router({ fiscal: fiscalRouter });
    const admin = app.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: { headers: {} }, res: {} } as never);
    await expect(admin.fiscal.notas.emitir({ ...n, ambienteEsperado: "producao_restrita" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: AVISO_EMISSAO_INDISPONIVEL });
    expect(recebidos).toHaveLength(0);
  });
  it("gatilho da 0167: EMITINDO só com emissor liberado; EMITIDA só de EMITINDO com chave/XML; Id da DPS não muda; emitida não muda", async () => {
    const n = await rascunho();
    const id = "DPS210530221122233300018100001000000000000001";
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = false`);
    await expect(pg.query(`UPDATE fiscal_notas SET status='EMITINDO', dps_id=$2, numero_dps=1, ambiente_emissao='producao_restrita' WHERE id=$1`, [n.id, id])).rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = true`);
    await expect(pg.query(`UPDATE fiscal_notas SET status='EMITIDA' WHERE id=$1`, [n.id])).rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    await pg.query(`UPDATE fiscal_notas SET status='EMITINDO', dps_id=$2, numero_dps=1, ambiente_emissao='producao_restrita' WHERE id=$1`, [n.id, id]);
    await expect(pg.query(`UPDATE fiscal_notas SET dps_id='DPS210530221122233300018100001000000000000002' WHERE id=$1`, [n.id])).rejects.toThrow(/FISCAL_DPS_IMUTAVEL/);
    await expect(pg.query(`UPDATE fiscal_notas SET status='A_DECIDIR' WHERE id=$1`, [n.id])).rejects.toThrow(/FISCAL_EMISSAO_EM_ANDAMENTO/);
    await expect(pg.query(`UPDATE fiscal_notas SET status='EMITIDA' WHERE id=$1`, [n.id])).rejects.toThrow(/chave, número e XML/);
    const chave = chaveDe(id, 1);
    await pg.query(`UPDATE fiscal_notas SET status='EMITIDA', chave_acesso=$2, numero_nfse='1', xml_nfse='<NFSe/>', emitida_em=now() WHERE id=$1`, [n.id, chave]);
    await expect(pg.query(`UPDATE fiscal_notas SET valor_ajustado_centavos = 1 WHERE id=$1`, [n.id])).rejects.toThrow(/IMUTAVEL/);
    await expect(pg.query(`UPDATE fiscal_notas SET status='CANCELADA', cancelada_em=now(), cancelamento_motivo=1, cancelamento_justificativa='curta' WHERE id=$1`, [n.id])).rejects.toThrow(/cancelamento_ck/);
    await expect(pg.query(`DELETE FROM fiscal_eventos`)).resolves.toBeDefined(); // tabela vazia: o gatilho de linha não dispara
    await pg.query(`INSERT INTO fiscal_eventos (nota_id, tipo, situacao, ambiente, via) VALUES ($1, 'emissao', 'autorizada', 'producao_restrita', 'tela')`, [n.id]);
    await expect(pg.query(`DELETE FROM fiscal_eventos`)).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query(`UPDATE fiscal_eventos SET situacao='rejeitada'`)).rejects.toThrow(/FISCAL_IMUTAVEL/);
  });
});

describe("emissão com a Sefin simulada (mTLS local)", () => {
  it("sucesso: DPS assinada e válida no XSD; grava chave, número, XML autorizado, protocolo e EMITIDA; repetir não reenvia", async () => {
    const n = await rascunho();
    const r = await emitirNota(getDb(), { ...n, ...autor }, deps());
    expect(r).toMatchObject({ situacao: "emitida", numero: "1" });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.clienteCn).toBe("EMPRESA TESTE SEM VALOR:11222333000181"); // mTLS com o A1 do emissor
    const enviada = descompactarXml((posts()[0]!.corpo as { dpsXmlGZipB64: string }).dpsXmlGZipB64);
    expect(await validarLeiaute(enviada, "dps", "producao_restrita")).toEqual({ valido: true, erros: [] });
    expect(verificarAssinaturaXml(enviada, cred.certPem, "infDPS")).toBe(true);
    const salva = await nota(n.id);
    expect(salva).toMatchObject({ status: "EMITIDA", numero_dps: 1, numero_nfse: "1", protocolo: "99887766", ambiente_emissao: "producao_restrita", emitida_por: 1 });
    expect(String(salva.dps_id)).toMatch(/^DPS2105302211222333000181000010{14}1$/);
    expect(String(salva.chave_acesso)).toHaveLength(50);
    expect(String(salva.xml_nfse)).toContain(`NFS${salva.chave_acesso}`);
    expect(await q(`SELECT proximo_numero_dps, serie_dps FROM fiscal_emissores`)).toEqual([{ proximo_numero_dps: 2, serie_dps: SERIE_PADRAO_API }]);
    expect(await q(`SELECT tipo, situacao FROM fiscal_eventos`)).toEqual([{ tipo: "emissao", situacao: "autorizada" }]);
    const de_novo = await emitirNota(getDb(), { id: n.id, versao: Number(salva.versao), ...autor }, deps());
    expect(de_novo.situacao).toBe("ja_emitida");
    expect(posts()).toHaveLength(1);
  });

  it("rejeição: consulta a DPS (não gerou) → ERRO com frase FIXA (nunca o texto do serviço); depois de reabrir, mesma DPS e mesmo número", async () => {
    const n = await rascunho();
    modo = "rejeicao";
    const r = await emitirNota(getDb(), { ...n, ...autor }, deps());
    expect(r).toMatchObject({ situacao: "rejeitada", codigos: ["E0120"] });
    expect(r.mensagem).toContain(FRASES_ERRO.E0120);
    expect(r.mensagem).not.toMatch(/12345678909|Inscricao/);
    expect(recebidos.map(x => `${x.metodo} ${x.caminho.replace(/DPS\w+/, "DPS…")}`)).toEqual(["POST /nfse", "GET /dps/DPS…"]);
    const erro = await nota(n.id);
    expect(erro).toMatchObject({ status: "ERRO", ultimo_erro: { codigos: ["E0120"] } });
    const app = router({ fiscal: fiscalRouter });
    const admin = app.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: { headers: {} }, res: {} } as never);
    // ERRO → tentar de novo direto (mesma DPS)
    modo = "sucesso";
    const ok = await emitirNota(getDb(), { id: n.id, versao: Number(erro.versao), ...autor }, deps());
    expect(ok.situacao).toBe("emitida");
    const salva = await nota(n.id);
    expect(salva.dps_id).toBe(erro.dps_id);
    expect(salva.numero_dps).toBe(1);
    expect((await q(`SELECT proximo_numero_dps FROM fiscal_emissores`))[0]).toEqual({ proximo_numero_dps: 2 });
    // a lista/ver da tela nunca leva os XML
    const lista = await admin.fiscal.notas.listar({ status: ["EMITIDA"] });
    expect(JSON.stringify(lista)).not.toMatch(/<DPS|<NFSe|xmlDps|xmlNfse/);
  });

  it("queda DEPOIS do envio (a Sefin gerou): fica EMITINDO, trava, e a retomada CONSULTA a DPS — nenhuma segunda nota", async () => {
    const n = await rascunho();
    modo = "pendurar";
    const r = await emitirNota(getDb(), { ...n, ...autor }, deps());
    expect(r.situacao).toBe("incerta");
    expect(await nota(n.id)).toMatchObject({ status: "EMITINDO" });
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(/sendo emitida/); // trava
    modo = "sucesso";
    agora = new Date(agora.getTime() + TRAVA_EMITINDO_MS + 1_000);
    const retomada = await emitirNota(getDb(), { ...n, ...autor }, deps());
    expect(retomada).toMatchObject({ situacao: "emitida" });
    expect(posts()).toHaveLength(1); // não reenviou: achou pela consulta GET /dps/{id}
    expect(geradas.size).toBe(1);
    expect(await q(`SELECT tipo, situacao FROM fiscal_eventos ORDER BY id`)).toEqual([
      { tipo: "emissao", situacao: "incerta" }, { tipo: "consulta_dps", situacao: "autorizada" }]);
  });

  it("queda ANTES de gerar: a retomada consulta (404) e reenvia o MESMO XML assinado (mesmo Id)", async () => {
    const n = await rascunho();
    modo = "pendurar_sem_gerar";
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("incerta");
    modo = "sucesso";
    agora = new Date(agora.getTime() + TRAVA_EMITINDO_MS + 1_000);
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    expect(posts()).toHaveLength(2);
    const [a, b] = posts().map(p => descompactarXml((p.corpo as { dpsXmlGZipB64: string }).dpsXmlGZipB64));
    expect(a).toBe(b);
    expect(geradas.size).toBe(1);
  });

  it("5xx = incerto (nunca ERRO, nunca reenvio às cegas); dois cliques ao mesmo tempo → um só envio", async () => {
    const n = await rascunho();
    modo = "erro500";
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("incerta");
    expect((await nota(n.id)).status).toBe("EMITINDO");
    const outra = await rascunho();
    modo = "sucesso";
    const [x, y] = await Promise.allSettled([emitirNota(getDb(), { ...outra, ...autor }, deps()), emitirNota(getDb(), { ...outra, ...autor }, deps())]);
    const ok = [x, y].filter(p => p.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(posts().filter(p => descompactarXml((p.corpo as { dpsXmlGZipB64: string }).dpsXmlGZipB64).includes("000000000000002"))).toHaveLength(1);
  });

  it("produção: o servidor exige a frase; colaborador não troca; a liberação do emissor não muda junto", async () => {
    const app = router({ fiscal: fiscalRouter });
    const como = (role: string) => app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active: true, permissions: '["bpo"]' }, req: { headers: {} }, res: {} } as never);
    await pg.exec(`UPDATE fiscal_emissores SET emissao_liberada = false`);
    await expect(como("admin").fiscal.emissores.ambiente({ emissorId: 1, ambiente: "producao" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(como("admin").fiscal.emissores.ambiente({ emissorId: 1, ambiente: "producao", frase: "emitir em producao" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(como("colaborador").fiscal.emissores.ambiente({ emissorId: 1, ambiente: "producao", frase: FRASE_PRODUCAO })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await como("admin").fiscal.emissores.ambiente({ emissorId: 1, ambiente: "producao", frase: FRASE_PRODUCAO })).toMatchObject({ ambiente: "producao", emissaoLiberada: false });
  });

  it("produção usa o leiaute de produção (09/02/2026): tpAmb 1, cIndOp exigido, XSD de produção", async () => {
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'producao'`);
    await pg.exec(`UPDATE fiscal_tipos_servico SET parametros_dps = jsonb_set(parametros_dps, '{ibscbs,cIndOp}', '"100301"') WHERE nome = 'Assessoria e honorários (BPO)'`);
    const n = await rascunho();
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    const enviada = descompactarXml((posts()[0]!.corpo as { dpsXmlGZipB64: string }).dpsXmlGZipB64);
    expect(enviada).toContain("<tpAmb>1</tpAmb>");
    expect(await validarLeiaute(enviada, "dps", "producao")).toEqual({ valido: true, erros: [] });
    expect((await nota(n.id)).ambiente_emissao).toBe("producao");
  });
});

describe("cancelamento (e101101)", () => {
  async function emitida() {
    const n = await rascunho();
    await emitirNota(getDb(), { ...n, ...autor }, deps());
    return nota(n.id);
  }
  it("motivo e justificativa conferidos; pedido assinado e válido no XSD; CANCELADA com o evento guardado; repetir não reenvia", async () => {
    const n = await emitida();
    const base = { id: Number(n.id), versao: Number(n.versao), ...autor };
    await expect(cancelarNota(getDb(), { ...base, motivo: 1, justificativa: "curta" }, deps())).rejects.toThrow(/pelo menos 15/);
    await expect(cancelarNota(getDb(), { ...base, motivo: 3, justificativa: "Valor digitado errado na nota" }, deps())).rejects.toThrow(/motivo/);
    const r = await cancelarNota(getDb(), { ...base, motivo: 1, justificativa: "Valor digitado errado na nota" }, deps());
    expect(r.situacao).toBe("cancelada");
    const pedido = recebidos.find(x => x.metodo === "POST" && x.caminho.endsWith("/eventos"))!;
    const xml = descompactarXml((pedido.corpo as { pedidoRegistroEventoXmlGZipB64: string }).pedidoRegistroEventoXmlGZipB64);
    expect(await validarLeiaute(xml, "pedRegEvento", "producao_restrita")).toEqual({ valido: true, erros: [] });
    expect(verificarAssinaturaXml(xml, cred.certPem, "infPedReg")).toBe(true);
    expect(xml).toContain(`<chNFSe>${n.chave_acesso}</chNFSe>`);
    expect(xml).toContain("<cMotivo>1</cMotivo>");
    expect(await nota(Number(n.id))).toMatchObject({ status: "CANCELADA", cancelamento_motivo: 1, cancelamento_justificativa: "Valor digitado errado na nota", cancelada_por: 1 });
    expect((await q(`SELECT tipo, situacao FROM fiscal_eventos WHERE tipo = 'cancelamento'`))).toEqual([{ tipo: "cancelamento", situacao: "autorizada" }]);
    expect((await cancelarNota(getDb(), { ...base, motivo: 1, justificativa: "Valor digitado errado na nota" }, deps())).situacao).toBe("ja_cancelada");
    await expect(pg.query(`UPDATE fiscal_notas SET status = 'EMITIDA' WHERE id = $1`, [n.id])).rejects.toThrow(/IMUTAVEL/);
  });
  it("E0822 (fora do prazo da prefeitura) vira frase própria; mais de 730 dias recusa sem rede; rascunho não cancela", async () => {
    const n = await emitida();
    modoEvento = "rejeicao_E0822";
    const base = { id: Number(n.id), versao: Number(n.versao), motivo: 2, justificativa: "Serviço não foi prestado ao cliente", ...autor };
    await expect(cancelarNota(getDb(), base, deps())).rejects.toThrow(FRASES_ERRO.E0822);
    expect((await nota(Number(n.id))).status).toBe("EMITIDA");
    const antes = recebidos.length;
    agora = new Date(agora.getTime() + 731 * 86_400_000);
    await expect(cancelarNota(getDb(), base, deps())).rejects.toThrow(/730 dias/);
    expect(recebidos.length).toBe(antes);
    const r = await rascunho();
    await expect(cancelarNota(getDb(), { ...r, motivo: 1, justificativa: "Valor digitado errado na nota", ...autor }, deps())).rejects.toThrow(/Só uma nota emitida/);
  });
  it("Id do pedido no padrão oficial (PRE + chave + 101101, 59 posições)", () => {
    const chave = chaveDe("DPS210530221122233300018100001000000000000001", 1);
    const { id } = montarPedidoCancelamento({ chave, cnpjAutor: "11222333000181", ambiente: "producao_restrita", motivo: 9, justificativa: "Outro motivo explicado aqui", quando: agora });
    expect(id).toHaveLength(59);
    expect(id).toMatch(PADRAO_ID_PEDIDO);
  });
});

describe("DANFSe (NT 008) — só do XML autorizado", () => {
  it("texto do PDF: título, sem validade jurídica em homologação, chave, número, tomador, valores; cancelada marcada; 1 página", async () => {
    const n = await rascunho();
    await emitirNota(getDb(), { ...n, ...autor }, deps());
    const s = await nota(n.id);
    const descritor = Object.getOwnPropertyDescriptor(Array.prototype, "random");
    if (descritor?.enumerable) Object.defineProperty(Array.prototype, "random", { ...descritor, enumerable: false });
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(gerarDanfsePdf(String(s.xml_nfse)));
    expect(pdf.numPages).toBe(1);
    const texto = String((await extractText(pdf, { mergePages: true })).text).replace(/\s+/g, " ");
    for (const t of ["DANFSe v2.0", "Documento Auxiliar da NFS-e", "NFS-e SEM VALIDADE JURÍDICA", String(s.chave_acesso), "Tomadora Teste Ltda", "55.444.333/0001-22",
      "EMPRESA TESTE SEM VALOR LTDA", "11.222.333/0001-81", "1.500,00", "A autenticidade desta NFS-e"]) expect(texto, t).toContain(t);
    const cancelada = String((await extractText(await getDocumentProxy(gerarDanfsePdf(String(s.xml_nfse), { cancelada: true })), { mergePages: true })).text);
    expect(cancelada).toContain("CANCELADA");
    expect(`${URL_CONSULTA_PUBLICA}${s.chave_acesso}`).toBe(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${s.chave_acesso}`);
    // nunca do rascunho: o XML da DPS (rascunho) não é NFS-e
    expect(() => gerarDanfsePdf(String(s.xml_dps))).toThrow(ErroDanfse);
    expect(lerNfse("<!DOCTYPE x><NFSe/>")).toBeNull();
  });
  it("a rota do DANFSe recusa rascunho e colaborador", async () => {
    const n = await rascunho();
    const app = router({ fiscal: fiscalRouter });
    const como = (role: string) => app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active: true, permissions: '["bpo"]' }, req: { headers: {} }, res: {} } as never);
    await expect(como("admin").fiscal.notas.danfse({ id: n.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(como("colaborador").fiscal.notas.danfse({ id: n.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(como("colaborador").fiscal.notas.xml({ id: n.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("leiaute — XSD oficial", () => {
  const ENTRADA = {
    ambiente: "producao_restrita", emitidoEm: new Date("2026-11-22T13:00:00.000Z"), competencia: "2026-11-20", serie: "1", numero: 42,
    prestador: { cnpj: "11222333000181", inscricaoMunicipal: null, municipioIbge: "2105302" },
    tomador: { documento: "123.456.789-09", nome: "Fulano de Tal" },
    servico: { municipioIncidenciaIbge: "2105302", codigoTributacaoNacional: "171901", codigoNbs: null, descricao: "Assessoria", cno: null },
    valorCentavos: 150_000, regimeTributario: "lucro_presumido", aliquotaIss: "5",
    parametros: { opSimpNac: "1", regApTribSN: null, regEspTrib: "0", tribIssqn: "1", tpRetIssqn: "1", indTotTrib: "0", ibscbs: { indFinal: null, cIndOp: null, indDest: "0", cst: "000", cClassTrib: "000001" } },
  };
  it("DPS válida passa nos dois ambientes; inválida é recusada só com o NOME do campo (sem o valor)", async () => {
    const { xml } = montarDps(ENTRADA);
    expect((await validarLeiaute(xml, "dps", "producao_restrita")).valido).toBe(true);
    const sem = xml.replace(/<cLocEmi>\d+<\/cLocEmi>/, "");
    const r1 = await validarLeiaute(sem, "dps", "producao_restrita");
    expect(r1.valido).toBe(false);
    expect(r1.erros.join(" ")).toMatch(/cLocEmi|prest/);
    const cpfRuim = xml.replace("<CPF>12345678909</CPF>", "<CPF>1234567890X</CPF>");
    const r2 = await validarLeiaute(cpfRuim, "dps", "producao_restrita");
    expect(r2.valido).toBe(false);
    expect(r2.erros.join(" ")).toContain("campo CPF");
    expect(r2.erros.join(" ")).not.toContain("1234567890X");
    expect((await validarLeiaute(`<!DOCTYPE x>${xml}`, "dps", "producao_restrita")).valido).toBe(false);
    expect((await validarLeiaute(xml, "pedRegEvento", "producao_restrita")).valido).toBe(false); // documento do tipo errado
  });
  it("âncoras ^…$ do XSD de produção tratadas como no validador oficial; frase do erro sem valor", () => {
    expect(ajustarAncoras('<xs:pattern value="^0{0,4}\\d{1,5}$"/>')).toBe('<xs:pattern value="0{0,4}\\d{1,5}"/>');
    expect(fraseDoErro("Element '{http://www.sped.fazenda.gov.br/nfse}xNome': [facet 'maxLength'] The value 'Maria da Silva' has a length of 400")).toBe("campo xNome: fora do formato do leiaute (maxLength)");
  });
  it("xNome do tomador cortado no limite do leiaute (300) — revisão da S-4", async () => {
    const { xml } = montarDps({ ...ENTRADA, tomador: { documento: "123.456.789-09", nome: "N".repeat(400) } });
    expect(/<xNome>(N+)<\/xNome>/.exec(xml)![1]).toHaveLength(MAX_NOME);
    expect((await validarLeiaute(xml, "dps", "producao_restrita")).valido).toBe(true);
  });
});

describe("alíquota — ponto de entrada (nada inventado)", () => {
  const ctx = { emissorCnpj: "11222333000181", competencia: "2026-11-20", municipioIncidenciaIbge: "2105302", tipoServico: { id: 1, itemLc116: null, codigoAtividadeSimples: null, aliquotaIss: "5" } };
  it("regime a_confirmar/desconhecido recusa; Simples sem a tabela recusa; Simples com a fonte usa a fonte; demais: oficial aceita > digitada", async () => {
    expect(await resolverAliquotaIss("a_confirmar", ctx)).toEqual({ aliquota: null, falta: FALTA_REGIME });
    expect(await resolverAliquotaIss(null, ctx)).toEqual({ aliquota: null, falta: FALTA_REGIME });
    expect(await resolverAliquotaIss("outro", ctx)).toEqual({ aliquota: null, falta: FALTA_REGIME });
    expect(await resolverAliquotaIss("simples_nacional", ctx)).toEqual({ aliquota: null, falta: FALTA_ALIQUOTA_SIMPLES });
    expect(await resolverAliquotaIss("simples_nacional", ctx, { simples: async () => "2.01" })).toEqual({ aliquota: "2.01", fonte: "simples" });
    expect(await resolverAliquotaIss("lucro_presumido", ctx)).toEqual({ aliquota: "5", fonte: "tipo_servico" });
    expect(await resolverAliquotaIss("lucro_presumido", { ...ctx, municipal: { aliquota: "3.5000", aliquotaDigitada: "5", situacao: "aceita" } })).toEqual({ aliquota: "3.5000", fonte: "sefin" });
    expect(await resolverAliquotaIss("lucro_presumido", { ...ctx, municipal: { aliquota: "3.5000", aliquotaDigitada: "5", situacao: "pendente" } })).toMatchObject({ aliquota: null, falta: expect.stringMatching(/escolha.*3\.5%.*5%/) });
  });
  it("emissão com regime a_confirmar no perfil: recusa sem rede", async () => {
    await pg.exec(`UPDATE tax_profiles SET regime = 'a_confirmar'`);
    const n = await rascunho();
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(/regime tributário confirmado/);
    expect(recebidos).toHaveLength(0);
  });
  it("municípios da operação: IBGE pelo nome (sem acento)", () => {
    expect(ibgeDoMunicipio("Canaa dos Carajas", "PA")).toBe("1502152");
    expect(ibgeDoMunicipio("parauapebas", "pa")).toBe("1505536");
    expect(ibgeDoMunicipio("Imperatriz", "MA")).toBe("2105302");
    expect(ibgeDoMunicipio("Imperatriz", "PA")).toBeNull();
  });
});

describe("parâmetros municipais oficiais (Sefin, só leitura)", () => {
  const app = router({ fiscal: fiscalRouter });
  const admin = () => app.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: { headers: {} }, res: {} } as never);
  it("alíquota diferente da digitada fica PENDENTE (nunca sobrescreve em silêncio); escolhida, vale na DPS", async () => {
    const tipo = (await q<{ id: number }>(`SELECT id FROM fiscal_tipos_servico WHERE nome = 'Assessoria e honorários (BPO)'`))[0]!.id;
    parametros["/parametros_municipais/2105302/171901"] = { status: 200, corpo: { aliquotas: [{ aliquota: 3.5, dtIni: "2026-01-01" }] } };
    parametros["/parametros_municipais/1502152/171901"] = { status: 200, corpo: { aliquota: "5.00" } };
    parametros["/parametros_municipais/1505536/171901"] = { status: 200, corpo: { aliquotas: [{ aliquota: 2 }, { aliquota: 3 }] } };
    parametros["/parametros_municipais/2105302/11222333000181"] = { status: 200, corpo: { retencoes: [] } };
    const { buscarAliquotasOficiais, escolherAliquota } = await import("./parametros-municipais.js");
    const r = await buscarAliquotasOficiais(getDb(), { emissorId: 1, tipoServicoId: tipo, usuarioId: 1, municipios: ["2105302", "1502152", "1505536"] }, deps());
    const porMun = Object.fromEntries(r.filter(x => x.consulta === "aliquota").map(x => [x.municipioIbge, x.situacao]));
    expect(porMun).toEqual({ "2105302": "pendente", "1502152": "aceita", "1505536": "sem_valor" });
    expect(r.filter(x => x.consulta === "retencoes")).toHaveLength(3);
    // a nota de Imperatriz não sai enquanto o admin não escolher
    const n = await rascunho();
    await expect(emitirNota(getDb(), { ...n, ...autor }, deps())).rejects.toThrow(/escolha entre a alíquota oficial/);
    const [pend] = await q<{ id: number }>(`SELECT id FROM fiscal_parametros_municipais WHERE situacao = 'pendente'`);
    await escolherAliquota(getDb(), { id: pend!.id, escolha: "sefin", usuarioId: 1 });
    await expect(escolherAliquota(getDb(), { id: pend!.id, escolha: "digitada", usuarioId: 1 })).rejects.toThrow(/já foi decidida/);
    await expect(pg.query(`UPDATE fiscal_parametros_municipais SET aliquota = 1`)).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query(`DELETE FROM fiscal_parametros_municipais`)).rejects.toThrow(/FISCAL_IMUTAVEL/);
    expect((await emitirNota(getDb(), { ...n, ...autor }, deps())).situacao).toBe("emitida");
    expect(descompactarXml((posts()[0]!.corpo as { dpsXmlGZipB64: string }).dpsXmlGZipB64)).toContain("<pAliq>3.50</pAliq>");
    expect((await admin().fiscal.parametrosMunicipais.listar({ tipoServicoId: tipo })).length).toBeGreaterThanOrEqual(3);
  });
  it("ambiente desligado: recusa sem rede; colaborador não busca", async () => {
    await pg.exec(`UPDATE fiscal_emissores SET ambiente = 'desligado'`);
    const tipo = (await q<{ id: number }>(`SELECT id FROM fiscal_tipos_servico WHERE nome = 'Assessoria e honorários (BPO)'`))[0]!.id;
    await expect(admin().fiscal.parametrosMunicipais.buscar({ emissorId: 1, tipoServicoId: tipo })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/desligado/) });
    const colab = app.createCaller({ user: { id: 2, role: "colaborador", active: true, permissions: '["bpo"]' }, req: { headers: {} }, res: {} } as never);
    await expect(colab.fiscal.parametrosMunicipais.buscar({ emissorId: 1, tipoServicoId: tipo })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(recebidos).toHaveLength(0);
  });
});

describe("Dolores — cancelar é sério", () => {
  it("cancelar_nota_fiscal pede \"confirmo\" com motivo próprio", () => {
    expect(nivelDoItem("cancelar_nota_fiscal", {})).toBe("serio");
    expect(motivoDoSerio(["cancelar_nota_fiscal"])).toBe("é o cancelamento de uma nota fiscal");
  });
});

describe("revisão da S-4 — certificado", () => {
  const app = router({ integracoes: router({ certificadoFiscal: certificadoFiscalRouter }) });
  const admin = () => app.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: { headers: {} }, res: {} } as never).integracoes.certificadoFiscal;
  it("(1) A1 que veio SEM intermediários: a cadeia é COMPLETADA no servidor (conhecidos ou AIA) e vai no mTLS; só recusa se não fechar", async () => {
    // Raiz de TESTE → intermediária de TESTE → A1 de TESTE; o .pfx traz SÓ a folha (como o A1 real da Prospecta).
    const { execFileSync } = await import("node:child_process");
    const { writeFileSync, readFileSync: ler } = await import("node:fs");
    const { join } = await import("node:path");
    const { X509Certificate } = await import("node:crypto");
    const d = pasta.dir, run = (a: string[]) => execFileSync("openssl", a, { cwd: d, stdio: "ignore" });
    const ca = "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n";
    writeFileSync(join(d, "raiz.cnf"), `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nO=ICP-Brasil TESTE\nCN=Raiz TESTE SEM VALOR\n[ext]\n${ca}`);
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "raiz-key.pem", "-out", "raiz.pem", "-days", "20", "-config", "raiz.cnf", "-extensions", "ext"]);
    writeFileSync(join(d, "inter.cnf"), `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nO=ICP-Brasil TESTE\nCN=AC Intermediaria TESTE\n[ext]\n${ca}`);
    run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "inter-key.pem", "-out", "inter.csr", "-config", "inter.cnf"]);
    run(["x509", "-req", "-in", "inter.csr", "-CA", "raiz.pem", "-CAkey", "raiz-key.pem", "-CAcreateserial", "-out", "inter.pem", "-days", "15", "-extfile", "inter.cnf", "-extensions", "ext"]);
    writeFileSync(join(d, "folha.cnf"), "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nO=ICP-Brasil TESTE\nCN=EMPRESA TESTE SEM VALOR:11222333000181\n[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation,keyEncipherment\nextendedKeyUsage=clientAuth\nsubjectAltName=otherName:2.16.76.1.3.3;UTF8:11222333000181\nauthorityInfoAccess=caIssuers;URI:http://ac.teste.invalid/inter.der\n");
    run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "folha-key.pem", "-out", "folha.csr", "-config", "folha.cnf"]);
    run(["x509", "-req", "-in", "folha.csr", "-CA", "inter.pem", "-CAkey", "inter-key.pem", "-CAcreateserial", "-out", "folha.pem", "-days", "10", "-extfile", "folha.cnf", "-extensions", "ext"]);
    run(["pkcs12", "-export", "-inkey", "folha-key.pem", "-in", "folha.pem", "-out", "folha.pfx", "-passout", `pass:${SENHA_TESTE}`]);
    const raiz = new X509Certificate(ler(join(d, "raiz.pem"))), inter = new X509Certificate(ler(join(d, "inter.pem")));
    // guardar NÃO recusa (só informa a cadeia)
    await expect(guardarCertificado(getDb(), { pfx: ler(join(d, "folha.pfx")), senha: SENHA_TESTE, emissorId: 1, origem: "arquivo", usuarioId: 1 })).resolves.toMatchObject({ cadeiaIcp: false });
    // sem intermediário conhecido e sem AIA → recusa para emitir
    await expect(credencialDoEmissor(getDb(), 1, new Date(), { paraEmitir: true, raizesIcp: [raiz], intermediarios: [], sessaoAia: null })).rejects.toThrow(FRASE_SEM_CADEIA_ICP);
    // com o intermediário embarcado → completa
    const c1 = await credencialDoEmissor(getDb(), 1, new Date(), { paraEmitir: true, raizesIcp: [raiz], intermediarios: [inter], sessaoAia: null });
    expect(c1.info.cadeiaIcp).toBe(true);
    expect(c1.cadeiaPem).toHaveLength(1);
    expect(new X509Certificate(c1.cadeiaPem[0]!).fingerprint256).toBe(inter.fingerprint256);
    // pelo AIA da certificadora (rotina do Jurídico), com baixador simulado
    const baixados: string[] = [];
    const c2 = await credencialDoEmissor(getDb(), 1, new Date(), { paraEmitir: true, raizesIcp: [raiz], intermediarios: [], sessaoAia: { baixar: async (url: string) => { baixados.push(url); return Buffer.from(inter.raw); } } as never });
    expect(baixados).toEqual(["http://ac.teste.invalid/inter.der"]);
    expect(c2.info.cadeiaIcp).toBe(true);
    // o mTLS manda cert + intermediários
    const { opcoesTls } = await import("./sefin.js");
    expect(String(opcoesTls(new URL("https://h/x"), c2, "GET", {}, 1, []).cert)).toContain(c2.cadeiaPem[0]!.trim().split("\n")[1]!);
    // sem exigir (testar conexão / consulta): abre sem completar
    await expect(credencialDoEmissor(getDb(), 1, new Date())).resolves.toMatchObject({ info: { cadeiaIcp: false } });
    // (6) antes do início da validade → recusa
    await expect(credencialDoEmissor(getDb(), 1, new Date(Date.now() - 3 * 86_400_000))).rejects.toThrow(/ainda não está dentro da validade/);
  }, 60_000);
  it("(2) testar conexão de emissor inexistente → NOT_FOUND com frase própria (não erro 500)", async () => {
    await expect(admin().testarConexao({ emissorId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Empresa emissora não encontrada." });
  });
  it("(3) emissor inativo escolhido → recusado; (4) matriz e filial com a mesma raiz → pede para escolher", async () => {
    await pg.exec(`UPDATE fiscal_emissores SET ativo = false WHERE id = 1`);
    await expect(guardarCertificado(getDb(), { pfx: certEmissor.pfx, senha: SENHA_TESTE, emissorId: 1, origem: "arquivo", usuarioId: 1 })).rejects.toThrow(FRASE_EMISSOR_INATIVO);
    await pg.exec(`UPDATE fiscal_emissores SET ativo = true WHERE id = 1; UPDATE fiscal_emissores SET cnpj = '11222333000262' WHERE id = 1;
      INSERT INTO fiscal_emissores (id, cnpj) VALUES (2, '11222333000343')`);
    await expect(guardarCertificado(getDb(), { pfx: certEmissor.pfx, senha: SENHA_TESTE, origem: "juridico", usuarioId: 1 })).rejects.toThrow(FRASE_VARIOS_EMISSORES);
  });
  it("(5) corrida no índice único do certificado ativo → frase clara", async () => {
    const real = getDb();
    const comCorrida = new Proxy(real as object, { get(alvo, p, r) {
      if (p === "transaction") return async () => { throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }); };
      return Reflect.get(alvo, p, r);
    } }) as typeof real;
    await expect(guardarCertificado(comCorrida, { pfx: certEmissor.pfx, senha: SENHA_TESTE, emissorId: 1, origem: "arquivo", usuarioId: 1 })).rejects.toThrow(FRASE_ENVIO_SIMULTANEO);
  });
});
