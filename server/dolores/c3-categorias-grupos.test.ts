// EPIC-027 C3 — categorias dos grupos iguais e explicadas em todo lugar; pergunta da Dolores com opções numeradas (o dono responde
// só com o número); "Corrigir/Definir tipo ou vínculo" pela tela em TODO grupo aceito, inclusive "não identificado · aguardando o
// dono"; classificar = admin e colaborador com o módulo WhatsApp (appRouter); ACEITAR grupo recusado / sem prova continua só do
// dono pelo WhatsApp — a tela nunca vira atalho (rota e gatilho da 0139). PGlite; nada sai para a rede.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import {
  CATEGORIAS_GRUPO, ROTULO_TIPO_GRUPO, TIPOS_GRUPO, lerDecisaoDeGrupo, lerRespostaNumerada, perguntaDoTipo, telaPodeClassificar, textoDoAvisoDeEntrada,
} from "../../shared/dolores/grupos-tipo.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirClienteModelo } from "./cerebro.js";
import { FILTRO_DO_REGISTRO, filtroDaSaida } from "./dados-pessoais.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { AGORA, CENARIO, MIGRACAO_0139, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const DOLORES = "5599900001111";
const OUTRO = "5599955554444";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoDono: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const grupo = async (id: number) => (await q(`SELECT tipo, lead_id, situacao_confirmacao, adicionado_por, prova_adicao, decidido_por, ativo FROM dolores_grupos WHERE id = ${id}`))[0];
const caller = (role: string, permissoes: string[] = [], id = 1) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
let seq = 0;
const doNumero = (de: string, texto: string) => ({ event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${de}@s.whatsapp.net`, fromMe: false, id: `C3D${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) } });
/** A pergunta do tipo saiu há 5 min (a resposta só com o número vale por 30 min). */
const PERGUNTA = new Date(AGORA.getTime() - 5 * 60_000).toISOString();
const doGrupo = (texto: string) => ({ event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: "120363999999999999@g.us", fromMe: false, id: `C3G${++seq}`, participant: `${DONO}@s.whatsapp.net` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) } });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const respostasAoDono = () => enviarAoDono.mock.calls.map(c => (c[0] as { texto: string }).texto);

// 1: aceito pelo dono (comando "aceitar"), tipo pendente — o caso dos prints. 2: o dono adicionou (prova), tipo pendente.
// 3: sem prova de quem colocou (aguardando o dono aceitar). 4: recusado (outra pessoa colocou). 5: grupo já confirmado (engenharia).
const GRUPOS = `INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
  ('prospecta-dolores', '120363100000000001@g.us', 'Turma A', 'Turma A', true, 'indefinido', 'automatico', 'aguardando_dono', 'KAAA', 'desconhecido', 'aceito_pelo_dono'),
  ('prospecta-dolores', '120363100000000002@g.us', 'Turma B', 'Turma B', true, 'indefinido', 'automatico', 'aguardando_dono', 'KCCC', 'dono', 'evento_add'),
  ('prospecta-dolores', '120363100000000003@g.us', 'Turma C', 'Turma C', true, 'indefinido', 'automatico', 'aguardando_dono', 'KDDD', 'desconhecido', 'sem_prova'),
  ('prospecta-dolores', '120363100000000004@g.us', 'Turma D', 'Turma D', true, 'juridico', 'automatico', 'recusado', 'KEEE', 'outra_pessoa', 'evento_add'),
  ('prospecta-dolores', '120363100000000005@g.us', 'Engenharia', 'Engenharia', true, 'engenharia', 'automatico', 'confirmado', 'KFFF', 'dono', 'evento_add');`;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${DOLORES}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("a resposta numerada não chama a IA"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("nada aqui classifica"); } });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao();
  vi.clearAllMocks();
});

describe("C3 — uma única lista de categorias", () => {
  it("6 categorias, numeradas de 1 a 6, com o rótulo da lista única e uma linha cada; todo tipo do sistema (menos indefinido) está nela", () => {
    expect(CATEGORIAS_GRUPO.map(c => c.opcao)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(CATEGORIAS_GRUPO.map(c => c.rotulo)).toEqual(["cliente", "pós-atendimento", "jurídico", "administrativo (sócios)", "parceiros comerciais", "engenharia"]);
    expect(CATEGORIAS_GRUPO.map(c => c.tipo).sort()).toEqual(TIPOS_GRUPO.filter(t => t !== "indefinido").sort());
    for (const c of CATEGORIAS_GRUPO) { expect(c.rotulo).toBe(ROTULO_TIPO_GRUPO[c.tipo]); expect(c.explica.length).toBeGreaterThan(10); }
  });

  it("a pergunta e o aviso ao dono mostram as 6, numeradas e explicadas; a tela usa a mesma lista (sem lista própria)", () => {
    const p = textoDoAvisoDeEntrada({ nomeDoGrupo: "Família", codigo: "K7HM", tipo: "indefinido" });
    for (const c of CATEGORIAS_GRUPO) expect(p).toContain(`${c.opcao}. ${c.rotulo} — ${c.explica}`);
    expect(p).toMatch(/só com o número da opção/);
    expect(p).toContain("grupo K7HM ignorar");
    expect(perguntaDoTipo("Família", "K7HM")).toContain("6. engenharia");
    // o aviso passa intacto pelo filtro de texto da Dolores (nenhuma explicação vira "[senha omitida]")
    for (const tipo of ["indefinido", "juridico"] as const) {
      const t = textoDoAvisoDeEntrada({ nomeDoGrupo: "Família", codigo: "K7HM", tipo });
      expect(sanitizarTexto(t, filtroDaSaida("whatsapp"))).toBe(t);
      expect(sanitizarTexto(t, FILTRO_DO_REGISTRO)).toBe(t);
    }
    const tela = readFileSync(new URL("../../client/src/components/admin/DoloresGruposCard.tsx", import.meta.url), "utf8");
    expect(tela).toContain("CATEGORIAS_GRUPO");
    expect(tela).not.toMatch(/cliente &lt;nº&gt; \| jurídico/);
    expect(tela).not.toMatch(/\["cliente", "pos_atendimento", "juridico"/);
  });

  it("comando: o antigo continua; 'grupo CÓDIGO <nº da opção>' e a resposta só com o número", () => {
    expect(lerDecisaoDeGrupo("grupo K7HM jurídico")).toEqual({ codigo: "K7HM", tipo: "juridico", numero: null });
    expect(lerDecisaoDeGrupo("grupo K7HM 3")).toEqual({ codigo: "K7HM", tipo: "juridico", numero: null });
    expect(lerDecisaoDeGrupo("grupo K7HM 1 456")).toEqual({ codigo: "K7HM", tipo: "cliente", numero: 456 });
    expect(lerDecisaoDeGrupo("grupo K7HM 6 12")).toEqual({ codigo: "K7HM", tipo: "engenharia", numero: 12 });
    expect(lerDecisaoDeGrupo("grupo K7HM 1")).toBeNull(); // cliente sem nº
    expect(lerDecisaoDeGrupo("grupo K7HM 4 9")).toBeNull(); // administrativo não leva número
    expect(lerDecisaoDeGrupo("grupo K7HM 7")).toBeNull();
    expect(lerRespostaNumerada("3")).toEqual({ tipo: "juridico", numero: null, confirmado: false });
    expect(lerRespostaNumerada("3 sim")).toEqual({ tipo: "juridico", numero: null, confirmado: true });
    expect(lerRespostaNumerada("5")).toEqual({ tipo: "parceiros", numero: null, confirmado: true });
    expect(lerRespostaNumerada("1 456")).toEqual({ tipo: "cliente", numero: 456, confirmado: true });
    expect(lerRespostaNumerada("1 nº 456")).toEqual({ tipo: "cliente", numero: 456, confirmado: true });
    expect(lerRespostaNumerada("6")).toEqual({ tipo: "engenharia", numero: null, confirmado: true });
    for (const t of ["0", "7", "33", "3 9", "3 e apague tudo", "opção 3", "3\n4", "", "1 0", "2", "1", "5 sim", "1 456 sim"]) expect(lerRespostaNumerada(t), t).toBeNull();
  });
});

describe("C3 — resposta só com o número, pelo WhatsApp (só o dono)", () => {
  it("um único grupo esperando o tipo (pergunta recente): '3 sim' define jurídico; de outro número ou de dentro de um grupo, nada muda", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao, pergunta_tipo_em) VALUES
      ('prospecta-dolores', '120363100000000001@g.us', 'Turma A', 'Turma A', true, 'indefinido', 'automatico', 'aguardando_dono', 'KAAA', 'desconhecido', 'aceito_pelo_dono', '${PERGUNTA}');`);
    await chamar(doNumero(OUTRO, "3 sim"));
    await chamar(doGrupo("3 sim"));
    expect(await grupo(1)).toMatchObject({ tipo: "indefinido", situacao_confirmacao: "aguardando_dono" });
    await chamar(doNumero(DONO, "3 sim"));
    expect(await grupo(1)).toMatchObject({ tipo: "juridico", situacao_confirmacao: "confirmado", decidido_por: "whatsapp:dono" });
    expect(respostasAoDono().at(-1)).toMatch(/agora é: grupo jurídico/);
    // nenhum grupo esperando: "3" não é comando (segue o caminho normal; nada muda nos grupos)
    await chamar(doNumero(DONO, "4 sim"));
    expect(await grupo(1)).toMatchObject({ tipo: "juridico" });
  });

  it("mais de um grupo esperando: pede o código e nada muda; 'grupo KCCC 4' resolve; cliente sem nº segue o caminho normal", async () => {
    await banco.pg.exec(GRUPOS);
    await banco.pg.exec(`UPDATE dolores_grupos SET pergunta_tipo_em = '${PERGUNTA}'`);
    await chamar(doNumero(DONO, "5"));
    expect(respostasAoDono().at(-1)).toMatch(/tenho 2 grupos esperando o tipo.*KAAA.*KCCC/);
    expect(await grupo(1)).toMatchObject({ tipo: "indefinido" });
    expect(await grupo(2)).toMatchObject({ tipo: "indefinido" });
    await chamar(doNumero(DONO, "grupo KCCC 4"));
    expect(await grupo(2)).toMatchObject({ tipo: "administrativo", situacao_confirmacao: "confirmado" });
    await chamar(doNumero(DONO, "1"));
    expect(await grupo(1)).toMatchObject({ tipo: "indefinido" });
    await chamar(doNumero(DONO, "1 1"));
    expect(await grupo(1)).toMatchObject({ tipo: "cliente", lead_id: 1, situacao_confirmacao: "confirmado" });
    // o sem prova (3) e o recusado (4) não foram tocados pela resposta numerada
    expect(await grupo(3)).toMatchObject({ tipo: "indefinido", situacao_confirmacao: "aguardando_dono", prova_adicao: "sem_prova" });
    expect(await grupo(4)).toMatchObject({ situacao_confirmacao: "recusado" });
  });
});

describe("C3 — classificar pela tela (admin e colaborador com WhatsApp); aceitar continua só do dono", () => {
  beforeEach(async () => { await banco.pg.exec(GRUPOS); });

  it("grupo aceito com tipo pendente (aceito pelo dono e adicionado pelo dono): a tela define; nasce com o interruptor do grupo ligado", async () => {
    await caller("admin").dolores.grupos.definirTipo({ grupoId: 1, tipo: "engenharia" });
    expect(await grupo(1)).toMatchObject({ tipo: "engenharia", situacao_confirmacao: "confirmado", decidido_por: "tela:1", prova_adicao: "aceito_pelo_dono", adicionado_por: "desconhecido" });
    await caller("colaborador", ["whatsapp"], 2).dolores.grupos.definirTipo({ grupoId: 2, tipo: "cliente", numero: 1 });
    expect(await grupo(2)).toMatchObject({ tipo: "cliente", lead_id: 1, situacao_confirmacao: "confirmado", decidido_por: "tela:2", prova_adicao: "evento_add", adicionado_por: "dono" });
    expect(await q("SELECT grupo_id, responder_ligado FROM dolores_marcacoes_grupo ORDER BY grupo_id")).toEqual([{ grupo_id: 1, responder_ligado: true }, { grupo_id: 2, responder_ligado: true }]);
    // e corrigir um já confirmado (dentro dos tipos do colaborador)
    await caller("colaborador", ["whatsapp"], 2).dolores.grupos.definirTipo({ grupoId: 5, tipo: "pos_atendimento", numero: 1 });
    expect(await grupo(5)).toMatchObject({ tipo: "pos_atendimento", decidido_por: "tela:2" });
  });

  it("quem pode: colaborador sem o módulo WhatsApp, corretor e cliente são barrados; colaborador não desativa nem aceita", async () => {
    const semWhatsapp = ADMIN_MODULES.filter(m => m !== "whatsapp");
    await expect(caller("colaborador", semWhatsapp).dolores.grupos.definirTipo({ grupoId: 1, tipo: "juridico" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("corretor", [...ADMIN_MODULES]).dolores.grupos.definirTipo({ grupoId: 1, tipo: "juridico" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("cliente", [...ADMIN_MODULES]).dolores.grupos.definirTipo({ grupoId: 1, tipo: "juridico" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const colab = caller("colaborador", ["whatsapp"], 2);
    await expect(colab.dolores.grupos.definirTipo({ grupoId: 5, tipo: "ignorar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.dolores.grupos.definirTipo({ grupoId: 3, tipo: "aceitar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // o resto da Dolores continua só do admin
    await expect(colab.dolores.grupos.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.dolores.grupos.ligarMarcacaoGrupo({ grupoId: 5, ligado: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.dolores.grupos.atualizar({ id: 5, ativo: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await grupo(1)).toMatchObject({ tipo: "indefinido" });
    expect(await grupo(5)).toMatchObject({ tipo: "engenharia", ativo: true });
  });

  it("a tela NUNCA aceita grupo recusado ou sem prova: nem aceitar, nem definir tipo (que aceitaria), nem pelo gatilho", async () => {
    for (const quem of [caller("admin"), caller("colaborador", ["whatsapp"], 2)]) {
      for (const id of [3, 4]) {
        // o colaborador já é barrado antes por ser tipo do admin; os dois são recusas
        await expect(quem.dolores.grupos.definirTipo({ grupoId: id, tipo: "juridico" })).rejects.toThrow(/só o dono aceita|só o administrador/);
        await expect(quem.dolores.grupos.definirTipo({ grupoId: id, tipo: "engenharia" })).rejects.toThrow(/só o dono aceita|só o administrador/);
        await expect(quem.dolores.grupos.definirTipo({ grupoId: id, tipo: "cliente", numero: 1 })).rejects.toThrow();
        await expect(quem.dolores.grupos.definirTipo({ grupoId: id, tipo: "aceitar" })).rejects.toThrow();
      }
    }
    await expect(caller("admin").dolores.grupos.definirTipo({ grupoId: 1, tipo: "aceitar" })).rejects.toThrow();
    expect(await grupo(3)).toMatchObject({ situacao_confirmacao: "aguardando_dono", prova_adicao: "sem_prova", tipo: "indefinido" });
    expect(await grupo(4)).toMatchObject({ situacao_confirmacao: "recusado" });
    expect(await q("SELECT * FROM dolores_marcacoes_grupo")).toEqual([]);
    // gatilho (0139): 'tela:' não tira recusado nem sem prova; nem com prova mudada; 'fila:' não tira nenhum
    for (const id of [3, 4]) {
      await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico', situacao_confirmacao = 'confirmado', decidido_em = now() + interval '5 s', decidido_por = 'tela:1' WHERE id = ${id}`))
        .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    }
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'confirmado', prova_adicao = 'aceito_pelo_dono', decidido_em = now() + interval '5 s', decidido_por = 'tela:1' WHERE id = 3`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico', situacao_confirmacao = 'confirmado', decidido_em = now() + interval '5 s', decidido_por = 'fila:1' WHERE id = 1`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    // aceito pelo dono, mas a tela tentando mexer na prova: barrado
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico', situacao_confirmacao = 'confirmado', adicionado_por = 'dono', decidido_em = now() + interval '5 s', decidido_por = 'tela:1' WHERE id = 1`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    // o dono, pelo WhatsApp, aceita
    await chamar(doNumero(DONO, "grupo KDDD aceitar"));
    expect(await grupo(3)).toMatchObject({ prova_adicao: "aceito_pelo_dono", decidido_por: "whatsapp:dono" });
    // a resposta do "aceitar" pergunta o tipo: a hora da pergunta fica gravada (vale a resposta só com o número por 30 min)
    expect((await q("SELECT pergunta_tipo_em FROM dolores_grupos WHERE id = 3"))[0].pergunta_tipo_em).not.toBeNull();
    // ... e a partir daí a tela já pode classificar
    await caller("admin").dolores.grupos.definirTipo({ grupoId: 3, tipo: "parceiros" });
    expect(await grupo(3)).toMatchObject({ tipo: "parceiros", situacao_confirmacao: "confirmado" });
  });

  it("telaPodeClassificar (regra pura) e a migração 0139 aplicada de novo (idempotente)", async () => {
    expect(telaPodeClassificar({ origem: "automatico", situacaoConfirmacao: "aguardando_dono", adicionadoPor: "desconhecido", provaAdicao: "aceito_pelo_dono" })).toBe(true);
    expect(telaPodeClassificar({ origem: "automatico", situacaoConfirmacao: "aguardando_dono", adicionadoPor: "dono", provaAdicao: "evento_add" })).toBe(true);
    expect(telaPodeClassificar({ origem: "automatico", situacaoConfirmacao: "aguardando_dono", adicionadoPor: "desconhecido", provaAdicao: "sem_prova" })).toBe(false);
    expect(telaPodeClassificar({ origem: "automatico", situacaoConfirmacao: "recusado", adicionadoPor: "outra_pessoa", provaAdicao: "evento_add" })).toBe(false);
    expect(telaPodeClassificar({ origem: "automatico", situacaoConfirmacao: "recusado", adicionadoPor: "outra_pessoa", provaAdicao: "aceito_pelo_dono" })).toBe(false);
    await banco.pg.exec(MIGRACAO_0139());
    const sql = MIGRACAO_0139().replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\s+(TABLE\s+)?"|\bUPDATE\s+"?dolores_grupos"?\s+SET\b|\bINSERT\s+INTO\b/i);
    // só ADD COLUMN IF NOT EXISTS (anuláveis, sem padrão)
    for (const a of sql.match(/ALTER\s+TABLE[^;]*;/gi) ?? []) expect(a).toMatch(/^ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "[a-z_]+" timestamp with time zone;$/);
    expect(await q("SELECT count(*)::int AS n FROM dolores_grupos")).toEqual([{ n: 5 }]);
  });
});
