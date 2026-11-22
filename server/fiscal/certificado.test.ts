// EPIC-029 S-4 (22/11/2026) — cofre do certificado A1: abre .pfx moderno e legado, recusa senha errada/vencido/CNPJ
// diferente/AC/sem "Autenticação de Cliente", guarda cifrado (pfx e senha separados), nunca devolve segredo, só admin,
// remover = desativar (o banco recusa apagar e trocar), auditoria sem segredo, e a emissão CONTINUA recusada.
// Banco em memória (PGlite) com as migrações 0154 e 0162 (duas vezes cada). Certificados de TESTE gerados aqui.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste-do-cofre" } }));

import { getDb } from "../db.js";
import { router } from "../_core/trpc.js";
import { decryptSecret } from "../_core/secret-vault.js";
import { abrirPfx, credencialDoEmissor, ErroCertificado, guardarCertificado, DIAS_AVISO_VENCIMENTO } from "./certificado.js";
import { certificadoFiscalRouter } from "./certificado-router.js";
import { emitir } from "./notas.js";
import { MENSAGEM_DESLIGADO } from "./sefin.js";
import { gerarCertificado, pastaDeTeste, SENHA_TESTE, type CertTeste } from "./certificados-teste.helper.js";

const M0154 = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
const M0162 = readFileSync(new URL("../../drizzle/0162_fiscal_certificados.sql", import.meta.url), "utf8");

const pasta = pastaDeTeste();
let ok: CertTeste, outro: CertTeste, servidor: CertTeste, ac: CertTeste;
beforeAll(() => {
  ok = gerarCertificado(pasta.dir, "ok");
  outro = gerarCertificado(pasta.dir, "outro", { cnpj: "99888777000166" });
  servidor = gerarCertificado(pasta.dir, "servidor", { uso: "serverAuth" });
  ac = gerarCertificado(pasta.dir, "ac", { ac: true, uso: null });
}, 60_000);
afterAll(() => pasta.limpar());

let pg: PGlite;
let consoleVigia: ReturnType<typeof vi.spyOn>[];
beforeEach(async () => {
  pg = new PGlite();
  for (const m of [M0154, M0154, M0162, M0162]) await pg.exec(m);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  await pg.exec(`INSERT INTO fiscal_emissores (id, cnpj, municipio_ibge, serie_dps) VALUES (1, '11222333000181', '2105302', '1'), (2, '55444333000122', NULL, NULL);`);
  consoleVigia = (["log", "info", "warn", "error", "debug"] as const).map(n => vi.spyOn(console, n).mockImplementation(() => undefined));
});
afterEach(async () => {
  // Nada de segredo em log: nem a senha, nem o arquivo, nem a chave.
  const tudo = JSON.stringify(consoleVigia.flatMap(s => s.mock.calls));
  expect(tudo).not.toContain(SENHA_TESTE);
  expect(tudo).not.toContain(ok.pfx.toString("base64").slice(0, 40));
  expect(tudo).not.toMatch(/PRIVATE KEY/);
  consoleVigia.forEach(s => s.mockRestore());
  await pg.close();
});

const app = router({ integracoes: router({ certificadoFiscal: certificadoFiscalRouter }) });
const caller = (role: string, permissoes: string[] = ["bpo", "whatsapp"]) =>
  app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active: true, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never).integracoes.certificadoFiscal;
const q = async <T = Record<string, unknown>>(sql: string) => (await pg.query<T>(sql)).rows;
const envio = (c: CertTeste, o: Partial<{ senha: string; emissorId: number; legado: boolean }> = {}) =>
  ({ pfxBase64: (o.legado ? c.pfxLegado : c.pfx).toString("base64"), senha: o.senha ?? SENHA_TESTE, origem: "juridico" as const, ...(o.emissorId ? { emissorId: o.emissorId } : {}) });

describe("abrir o .pfx (só em memória)", () => {
  it("abre o moderno e o legado (RC2/3DES), com titular, CNPJ do OtherName ICP e impressão digital", async () => {
    for (const pfx of [ok.pfx, ok.pfxLegado]) {
      const c = await abrirPfx(pfx, SENHA_TESTE);
      expect(c.info.titular).toBe("EMPRESA TESTE SEM VALOR:11222333000181");
      expect(c.info.cnpj).toBe("11222333000181");
      expect(c.info.impressaoDigital).toBe(ok.impressao);
      expect(c.info.ehAc).toBe(false);
      expect(c.info.cadeiaIcp).toBe(false); // autoassinado de teste: não chega à raiz ICP-Brasil
      expect(c.chavePem).toMatch(/BEGIN PRIVATE KEY/);
    }
  });
  it("senha errada → frase fixa, sem a senha nem texto da biblioteca", async () => {
    const e = await abrirPfx(ok.pfx, "senha-errada-123").catch(x => x);
    expect(e).toBeInstanceOf(ErroCertificado);
    expect(e.message).toBe("Não foi possível abrir o certificado. Confira o arquivo A1 e a senha.");
  });
  it("arquivo vazio ou maior que 1 MiB é recusado", async () => {
    await expect(abrirPfx(new Uint8Array(), SENHA_TESTE)).rejects.toThrow(/até 1 MiB/);
    await expect(abrirPfx(new Uint8Array(1024 * 1024 + 1), SENHA_TESTE)).rejects.toThrow(/até 1 MiB/);
  });
});

describe("cofre — enviar (do Jurídico ou por arquivo)", () => {
  it("guarda cifrado (pfx e senha separados), acha o emissor pelo CNPJ e devolve só o resumo", async () => {
    const r = await caller("admin").enviar(envio(ok));
    expect(r).toMatchObject({ emissorId: 1, cnpj: "11222333000181", impressaoDigital: ok.impressao, origem: "juridico" });
    const resposta = JSON.stringify(r);
    expect(resposta).not.toContain(SENHA_TESTE);
    expect(resposta).not.toContain(ok.pfx.toString("base64").slice(0, 40));
    expect(resposta).not.toMatch(/PRIVATE|pfx|senha/i);
    const [linha] = await q<{ pfx_cifrado: string; senha_cifrada: string }>(`SELECT pfx_cifrado, senha_cifrada FROM fiscal_emissores_certificado`);
    expect(linha!.pfx_cifrado).not.toContain(ok.pfx.toString("base64").slice(0, 40));
    expect(linha!.senha_cifrada).not.toContain(SENHA_TESTE);
    expect(linha!.pfx_cifrado.startsWith("plain:")).toBe(false);
    expect(decryptSecret(linha!.pfx_cifrado)).toBe(ok.pfx.toString("base64"));
    expect(decryptSecret(linha!.senha_cifrada)).toBe(SENHA_TESTE);
    // a credencial interna (mTLS/assinatura) abre do cofre — uso só no servidor
    const cred = await credencialDoEmissor(drizzle(pg) as never, 1);
    expect(cred.info.impressaoDigital).toBe(ok.impressao);
  });
  it("o .pfx legado também é aceito", async () => {
    await expect(caller("admin").enviar({ ...envio(ok, { legado: true }), origem: "arquivo", emissorId: 1 })).resolves.toMatchObject({ origem: "arquivo" });
  });
  it("recusas com mensagem clara: senha errada, CNPJ diferente, AC, sem Autenticação de Cliente, sem emissor", async () => {
    await expect(caller("admin").enviar(envio(ok, { senha: "errada" }))).rejects.toThrow("Não foi possível abrir o certificado");
    await expect(caller("admin").enviar(envio(outro, { emissorId: 1 }))).rejects.toThrow(/não é o da empresa emissora/);
    await expect(caller("admin").enviar(envio(outro))).rejects.toThrow(/Nenhuma empresa emissora com o CNPJ/);
    await expect(caller("admin").enviar(envio(servidor, { emissorId: 1 }))).rejects.toThrow(/Autenticação de Cliente/);
    await expect(caller("admin").enviar(envio(ac, { emissorId: 1 }))).rejects.toThrow(/autoridade certificadora/);
    expect(await q(`SELECT 1 FROM fiscal_emissores_certificado`)).toHaveLength(0);
    const hist = await q<{ acao: string; detalhe: string }>(`SELECT acao, detalhe FROM fiscal_certificados_historico`);
    expect(hist.every(h => h.acao === "recusado")).toBe(true);
    expect(JSON.stringify(hist)).not.toContain(SENHA_TESTE);
  });
  it("vencido é recusado (relógio adiantado)", async () => {
    const futuro = new Date(Date.now() + 40 * 86_400_000);
    await expect(guardarCertificado(drizzle(pg) as never, { pfx: ok.pfx, senha: SENHA_TESTE, origem: "arquivo", usuarioId: 1, agora: futuro }))
      .rejects.toThrow(/vencido/);
  });
  it("só admin por papel: colaborador (mesmo com BPO) e usuário comum são barrados", async () => {
    for (const papel of ["colaborador", "user"]) {
      await expect(caller(papel).enviar(envio(ok))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(papel).status()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(papel).desativar({ emissorId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(papel).testarConexao({ emissorId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await q(`SELECT 1 FROM fiscal_emissores_certificado`)).toHaveLength(0);
  });
});

describe("cofre — status, desativar e guarda do banco", () => {
  it("status mostra só titular, CNPJ, AC, validade, impressão digital e o aviso de vencimento", async () => {
    await caller("admin").enviar(envio(ok));
    const s = await caller("admin").status();
    const c = s.find(e => e.id === 1)!.certificado!;
    expect(Object.keys(c).sort()).toEqual(["autoridade", "aviso", "cadeiaIcp", "certificadoId", "cnpj", "diasParaVencer", "emissorId", "enviadoEm",
      "impressaoDigital", "origem", "titular", "validoAte", "validoDe"]);
    expect(c.diasParaVencer).toBeLessThanOrEqual(DIAS_AVISO_VENCIMENTO); // o de teste vale 20 dias
    expect(c.aviso).toMatch(/vence em/);
    expect(s.find(e => e.id === 2)!.certificado).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/PRIVATE|senha_cifrada|pfx_cifrado/);
  });
  it("certificado novo desativa o anterior (um ativo por emissor); remover = desativar, sem apagar", async () => {
    await caller("admin").enviar(envio(ok));
    await caller("admin").enviar(envio(ok, { legado: true }));
    expect(await q(`SELECT id FROM fiscal_emissores_certificado WHERE ativo`)).toHaveLength(1);
    expect(await caller("admin").desativar({ emissorId: 1 })).toEqual({ desativado: true });
    expect(await q(`SELECT id FROM fiscal_emissores_certificado`)).toHaveLength(2);
    expect(await q(`SELECT id FROM fiscal_emissores_certificado WHERE ativo`)).toHaveLength(0);
    await expect(credencialDoEmissor(drizzle(pg) as never, 1)).rejects.toThrow(/não tem certificado A1 ativo/);
    const hist = await q<{ acao: string }>(`SELECT acao FROM fiscal_certificados_historico ORDER BY id`);
    expect(hist.map(h => h.acao)).toEqual(["enviado", "enviado", "desativado"]);
  });
  it("o banco recusa apagar, trocar o conteúdo cifrado, reativar e mexer no histórico", async () => {
    await caller("admin").enviar(envio(ok));
    await expect(pg.exec(`DELETE FROM fiscal_emissores_certificado`)).rejects.toThrow(/FISCAL_CERTIFICADO_SEM_EXCLUSAO/);
    await expect(pg.exec(`TRUNCATE fiscal_emissores_certificado`)).rejects.toThrow(/FISCAL_CERTIFICADO_SEM_EXCLUSAO/);
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET pfx_cifrado = 'x'`)).rejects.toThrow(/FISCAL_CERTIFICADO_IMUTAVEL/);
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET senha_cifrada = 'x'`)).rejects.toThrow(/FISCAL_CERTIFICADO_IMUTAVEL/);
    await pg.exec(`UPDATE fiscal_emissores_certificado SET ativo = false`);
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET ativo = true`)).rejects.toThrow(/FISCAL_CERTIFICADO_DESATIVADO/);
    // QA S-4 (B3): quem/quando desativou é gravado uma vez só; AC e cadeia também não mudam
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET desativado_por = 99`)).rejects.toThrow(/FISCAL_CERTIFICADO_IMUTAVEL/);
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET desativado_em = now() - interval '1 day'`)).rejects.toThrow(/FISCAL_CERTIFICADO_IMUTAVEL/);
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET autoridade = 'AC FALSA'`)).rejects.toThrow(/FISCAL_CERTIFICADO_IMUTAVEL/);
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET cadeia_icp = true`)).rejects.toThrow(/FISCAL_CERTIFICADO_IMUTAVEL/);
    await expect(pg.exec(`UPDATE fiscal_certificados_historico SET detalhe = 'x'`)).rejects.toThrow(/IMUTAVEL/);
    await expect(pg.exec(`DELETE FROM fiscal_certificados_historico`)).rejects.toThrow(/IMUTAVEL/);
  });
  it("testar conexão com ambiente desligado recusa sem sair do sistema e registra no histórico", async () => {
    const r = await caller("admin").testarConexao({ emissorId: 1 });
    expect(r).toEqual({ ok: false, ambiente: "desligado", mensagem: MENSAGEM_DESLIGADO });
    expect(await q(`SELECT acao FROM fiscal_certificados_historico`)).toEqual([{ acao: "teste_conexao" }]);
  });
});

describe("a emissão continua recusada", () => {
  it("a rota recusa e o gatilho da 0154 recusa EMITINDO/EMITIDA (a 0162 não mexe nele)", async () => {
    expect(() => emitir()).toThrow(/homologação/);
    await expect(pg.exec(`INSERT INTO fiscal_notas (origem_tipo, origem_id, data_evento, status) VALUES ('bpo_lancamento', 1, '2026-11-20', 'EMITINDO')`))
      .rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    await expect(pg.exec(`INSERT INTO fiscal_notas (origem_tipo, origem_id, data_evento, status) VALUES ('bpo_lancamento', 2, '2026-11-20', 'EMITIDA')`))
      .rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    // Única alteração em tabela existente: a coluna nova (opcional) do tipo de serviço.
    const semComentarios = M0162.split("\n").filter(l => !l.trim().startsWith("--")).join("\n")
      .replace(/ALTER TABLE "fiscal_tipos_servico" ADD COLUMN IF NOT EXISTS "codigo_atividade_simples"/, "");
    expect(semComentarios).not.toMatch(/fiscal_notas\b|fiscal_notas_guarda|ALTER TABLE|DROP TABLE|DROP COLUMN|DELETE FROM/);
  });
});

describe("teste-vigia do código", () => {
  const raiz = join(__dirname, "..", "..");
  const arquivos = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  const codigo = ["server", "shared", "api", "client/src"].flatMap(d => arquivos(join(raiz, d))).filter(f => !/\.test\.tsx?$|\.helper\.ts$/.test(f));
  it("as colunas cifradas do certificado só são lidas em server/fiscal/certificado.ts (e declaradas no schema)", () => {
    const usam = codigo.filter(f => /pfxCifrado|senhaCifrada|pfx_cifrado|senha_cifrada/.test(readFileSync(f, "utf8"))).map(f => f.slice(raiz.length + 1)).sort();
    expect(usam).toEqual(["server/fiscal/certificado.ts"]);
  });
  it("credencialDoEmissor (decifra o A1) só é chamada pelo cliente da Sefin", () => {
    const usam = codigo.filter(f => /credencialDoEmissor/.test(readFileSync(f, "utf8"))).map(f => f.slice(raiz.length + 1)).sort();
    expect(usam).toEqual(["server/fiscal/certificado.ts", "server/fiscal/sefin.ts"]);
  });
  it("nenhum arquivo fiscal desliga a verificação TLS nem loga XML/certificado", () => {
    for (const f of codigo.filter(f => /server[\\/]fiscal[\\/]/.test(f))) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/);
      if (/certificado\.ts$|sefin\.ts$|assinatura\.ts$|dps\.ts$/.test(f)) expect(t, f).not.toMatch(/console\./);
    }
  });
  it("a resposta das rotas do cofre nunca tem campo de segredo (o select do status não lê as colunas cifradas)", () => {
    const t = readFileSync(join(raiz, "server/fiscal/certificado-router.ts"), "utf8");
    expect(t).not.toMatch(/pfxCifrado|senhaCifrada|chavePem|certPem/);
  });
});
