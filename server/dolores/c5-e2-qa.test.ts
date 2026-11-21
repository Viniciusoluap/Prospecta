// EPIC-027 C5 (E2) — portão de QA de SEGURANÇA (@qa, 21/11/2026). Tenta QUEBRAR a confirmação natural ("pode"/"confirmo"):
// quem confirma, o que executa, injeção, grupos pela conversa, falha segura sem a 0145. Pelo webhook de verdade (PGlite, modelo e
// envio falsos, sem rede). Os testes que eram "ACHADO" (comportamento antigo) foram invertidos com as correções A1–A4 do @dev.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { exigeConfirmoNoCodigo, lerConfirmacao, nivelDoItem } from "../../shared/dolores/confirmacao.js";
import { lerDecisaoDoDono } from "../../shared/dolores/fila.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const GRUPO = "120363000000000077@g.us";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidosModelo: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let agora: Date;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const fila = () => q<{ id: number; codigo: string; situacao: string; funcao: string; resumo: string }>("SELECT * FROM dolores_aprovacoes ORDER BY id");
const pendencias = () => q<{ id: number; situacao: string; nivel: string; adjacente: boolean }>("SELECT * FROM dolores_conversa_pendencia ORDER BY id");
const tarefasDolores = () => q<{ title: string }>("SELECT t.title FROM tasks t JOIN dolores_autoria a ON a.tabela = 'tasks' AND a.registro_id = t.id ORDER BY t.id");
const atividadesDolores = () => q("SELECT * FROM lead_activities WHERE performed_by = 'Dolores (funcionária digital)'");

let seq = 0;
const tsDe = (d: Date) => Math.floor(d.getTime() / 1000);
const corpo = (key: Record<string, unknown>, message: Record<string, unknown>, quando = new Date(agora.getTime() - 5_000)) =>
  ({ event: "messages.upsert", instance: "prospecta-dolores", data: { key, message, messageTimestamp: tsDe(quando) } });
const direta = (texto: string, extra: { quando?: Date; id?: string } = {}) =>
  // QA C5-E2 (A1): a resposta curta é escrita DEPOIS da pergunta (enviada em `agora`), salvo quando o teste diz a hora
  corpo({ remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: extra.id ?? `QA${++seq}` }, { conversation: texto },
    extra.quando ?? (lerConfirmacao(texto) ? new Date(agora.getTime() + 1_000) : undefined));
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const dono = (texto: string) => chamar(direta(texto));
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (...chamadas: Array<[string, unknown]>): RespostaModelo => ({ stop_reason: "tool_use", usage: uso,
  content: chamadas.map(([name, input], i) => ({ type: "tool_use", id: `tu_${name}_${i}_${Math.random()}`, name, input })) });
const texto = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
const respostasAoDono = () => enviar.mock.calls.map(c => c[0] as { numero: string; texto: string }).filter(m => m.numero === DONO);
const ultima = () => respostasAoDono().at(-1)?.texto ?? "";
const proporTarefa = async (titulo = "Ligar para o João", pedido = "cria uma tarefa para a Bianca ligar para o João amanhã") => {
  roteiro.push(() => ferramenta(["criar_tarefa", { titulo, responsavel: "Bianca Souza", prazo: "2026-11-17" }]), () => texto("Vou criar a tarefa."));
  await dono(pedido);
};

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  agora = new Date(AGORA);
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never });
  let sorteio = 0;
  definirSorteioCodigo(() => ((sorteio++ * 7) % 22) / 22 + 0.001);
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  pedidosModelo = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidosModelo.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirSorteioCodigo();
  vi.restoreAllMocks();
});

describe("QA 1 — quem confirma", () => {
  it("áudio do dono (sem transcrição para o dono), imagem com legenda \"pode\" e eco fromMe na conversa do dono não confirmam", async () => {
    await proporTarefa();
    await chamar(corpo({ remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: "QA-AUDIO" }, { audioMessage: { seconds: 2, mimetype: "audio/ogg; codecs=opus" } }));
    await chamar(corpo({ remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: "QA-IMG" }, { imageMessage: { caption: "pode" } }));
    await chamar(corpo({ remoteJid: `${DONO}@s.whatsapp.net`, fromMe: true, id: "QA-ECO" }, { conversation: "pode" }));
    expect(await tarefasDolores()).toEqual([]);
    expect((await pendencias())[0].situacao).toBe("aberta");
    expect(pedidosModelo).toHaveLength(2); // nenhuma dessas chamou a IA
  });

  it("variações que parecem confirmação mas não estão na lista fechada não executam (nem a IA executa)", () => {
    for (const t of ["pode.​", "pode\tsim", "pode sim pode", "ok confirmo pagamento", "sim pode apagar", "P O D E", "pode sim"]) {
      const r = lerConfirmacao(t);
      expect(r === null || ["sim", "confirmo", "nao"].includes(r.tipo), t).toBe(true);
      if (/apagar|pagamento/.test(t)) expect(r, t).toBeNull();
    }
    // separador de linha unicode (U+2028) não é quebra para o código: vira espaço e "pode sim" é aceito — inofensivo (lista fechada)
    expect(lerConfirmacao("pode sim")).toEqual({ tipo: "sim" });
  });

  it("webhook repetido com ids diferentes e N confirmações simultâneas → UMA execução", async () => {
    await proporTarefa();
    await Promise.all(["pode", "sim", "ok", "pode fazer", "beleza", "isso"].map(t => dono(t)));
    expect(await tarefasDolores()).toHaveLength(1);
    expect((await fila())[0].situacao).toBe("executada");
  });

  it("A1 (corrigido): \"pode\" ESCRITO ANTES de a proposta nova existir (atraso/fora de ordem do webhook) NÃO confirma a proposta nova; mostra de novo", async () => {
    await proporTarefa("Ligar para o João");
    const viuA = new Date(agora.getTime() + 10_000); // o dono responde "pode" à proposta A…
    agora = new Date(agora.getTime() + 60_000);
    await proporTarefa("Cobrar o Pedro", "cria uma tarefa para a Bianca cobrar o Pedro"); // …mas o webhook entrega B antes do "pode"
    expect((await pendencias()).map(p => p.situacao)).toEqual(["substituida", "aberta"]);
    await chamar(direta("pode", { quando: viuA })); // escrito antes de a pergunta de B existir
    expect(await tarefasDolores()).toEqual([]); // nada executa
    expect(ultima()).toMatch(/Antes de fazer, confira o que ainda está esperando/);
    expect(ultima()).toContain("Cobrar o Pedro"); // a proposta de verdade, mostrada de novo
    expect((await pendencias())[1].situacao).toBe("aberta");
    await dono("pode"); // agora sim, escrito depois de ver B
    expect((await tarefasDolores()).map(t => t.title)).toEqual(["Cobrar o Pedro"]);
  });

  it("A1: a proposta nasce NÃO confirmável e só passa a aceitar resposta depois que a pergunta saiu (com a hora do envio)", async () => {
    const naHoraDoEnvio: Array<{ adjacente: boolean; pergunta_enviada_em: Date | null }> = [];
    enviar.mockImplementation(async (m: { texto: string }) => {
      if (/Posso fazer isto\?/.test(m.texto)) naHoraDoEnvio.push(...await q<any>("SELECT adjacente, pergunta_enviada_em FROM dolores_conversa_pendencia WHERE situacao = 'aberta'"));
      return true;
    });
    await proporTarefa();
    expect(naHoraDoEnvio).toEqual([{ adjacente: false, pergunta_enviada_em: null }]); // enquanto a pergunta sai, nada a confirma
    const [p] = await q<any>("SELECT adjacente, pergunta_enviada_em FROM dolores_conversa_pendencia");
    expect(p.adjacente).toBe(true);
    expect(new Date(p.pergunta_enviada_em).getTime()).toBe(agora.getTime());
  });

  it("A1: resposta no MESMO segundo do envio da pergunta, ou sem hora, não confirma (lado seguro); a seguinte, depois, confirma", async () => {
    await proporTarefa();
    await chamar(direta("pode", { quando: new Date(agora.getTime() + 400) })); // mesmo segundo
    expect(await tarefasDolores()).toEqual([]);
    expect(ultima()).toMatch(/Antes de fazer, confira/);
    const semHora = direta("pode") as { data: Record<string, unknown> };
    delete semHora.data.messageTimestamp;
    await chamar(semHora); // sem messageTimestamp: a mensagem é descartada como antiga — nada executa
    expect(await tarefasDolores()).toEqual([]);
    await dono("pode");
    expect(await tarefasDolores()).toHaveLength(1);
  });

  it("A1: \"não\" escrito antes da pergunta não recusa a proposta (segue como conversa comum)", async () => {
    await proporTarefa();
    roteiro.push(() => texto("Certo."));
    await chamar(direta("não", { quando: new Date(agora.getTime() - 2_000) }));
    expect((await pendencias())[0].situacao).toBe("aberta");
  });

  it("A1: envio da pergunta falhou → a proposta não vale (nenhum \"pode\" a confirma)", async () => {
    enviar.mockImplementation(async () => false);
    await proporTarefa();
    expect((await pendencias())[0]).toMatchObject({ situacao: "vencida", adjacente: false });
    enviar.mockImplementation(async () => true);
    roteiro.push(() => texto("Não tenho nada esperando."));
    await dono("pode");
    expect(await tarefasDolores()).toEqual([]);
  });

  it("decisão: áudio do dono dizendo \"pode\" NUNCA confirma (só texto escrito, reconhecido por código)", async () => {
    await proporTarefa();
    await chamar(corpo({ remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: "QA-AUDIO-PODE" },
      { audioMessage: { seconds: 1, mimetype: "audio/ogg; codecs=opus" } }, new Date(agora.getTime() + 1_000)));
    expect(await tarefasDolores()).toEqual([]);
    expect((await pendencias())[0].situacao).toBe("aberta");
  });
});

describe("QA 2 — o que executa", () => {
  it("o item gravado não pode ser trocado (gatilho/hash) e o nível é recalculado: rebaixar a proposta séria a 'registro' não deixa o \"pode\" passar", async () => {
    roteiro.push(() => ferramenta(["preparar_cobranca", { leadIds: [1] }]), () => texto("Vou preparar a cobrança."));
    await dono("prepare a cobrança da Maria");
    expect((await pendencias())[0].nivel).toBe("serio");
    await expect(banco.pg.exec("UPDATE dolores_aprovacoes SET argumentos = '{\"leadIds\":[2]}'")).rejects.toThrow();
    await banco.pg.exec("UPDATE dolores_conversa_pendencia SET nivel = 'registro'");
    await dono("pode");
    expect(ultima()).toMatch(/responda: confirmo/);
    expect(await atividadesDolores()).toEqual([]);
  });

  it("proposta substituída não executa; \"pode\" faz só a última, e só uma vez", async () => {
    await proporTarefa("Primeira");
    await proporTarefa("Segunda", "cria uma tarefa para a Bianca fazer a segunda");
    expect(ultima()).toMatch(/A proposta anterior ficou de lado/);
    await dono("pode");
    expect((await tarefasDolores()).map(t => t.title)).toEqual(["Segunda"]);
    expect((await fila()).find(i => i.resumo.includes("Primeira"))!.situacao).toBe("aguardando"); // nunca rodou; vence sozinho
  });

  it("níveis: nada que mexe com dinheiro, cobrança, aceite ou tipo interno é 'registro'; desconhecido é sério", () => {
    for (const [f, a] of [["conciliar_nota_obra", {}], ["preparar_cobranca", {}], ["aceitar_grupo", {}], ["classificar_grupo", { tipo: "parceiros" }],
      ["classificar_grupo", { tipo: "juridico" }], ["ligar_resposta_grupo", { ligado: true, tipo: "administrativo" }],
      ["registrar_pagamento", {}], ["excluir_registro", {}], ["", {}]] as Array<[string, unknown]>) expect(nivelDoItem(f, a), `${f} ${JSON.stringify(a)}`).toBe("serio");
    // A3 (corrigido): na dúvida, sério — sem tipo, tipo desconhecido, `troca` ausente, `ligado` que não é booleano de verdade
    for (const [f, a] of [["classificar_grupo", {}], ["classificar_grupo", { tipo: "CLIENTE", troca: false }], ["classificar_grupo", { tipo: "indefinido", troca: false }],
      ["classificar_grupo", { tipo: "cliente" }], ["classificar_grupo", { tipo: "cliente", troca: true }], ["classificar_grupo", { tipo: "cliente", troca: "false" }],
      ["ligar_resposta_grupo", { ligado: "true", tipo: "juridico" }], ["ligar_resposta_grupo", { ligado: "false", tipo: "cliente" }],
      ["ligar_resposta_grupo", { ligado: true }], ["ligar_resposta_grupo", { ligado: true, tipo: "indefinido" }], ["ligar_resposta_grupo", {}]] as Array<[string, unknown]>) {
      expect(nivelDoItem(f, a), `${f} ${JSON.stringify(a)}`).toBe("serio");
    }
    // só a lista explícita dos simples é "registro"
    for (const [f, a] of [["classificar_grupo", { tipo: "cliente", troca: false }], ["classificar_grupo", { tipo: "pos_atendimento", troca: false }],
      ["classificar_grupo", { tipo: "engenharia", troca: false }], ["ligar_resposta_grupo", { ligado: false, tipo: "juridico" }],
      ["ligar_resposta_grupo", { ligado: false }], ["ligar_resposta_grupo", { ligado: true, tipo: "cliente" }], ["ignorar_grupo", {}]] as Array<[string, unknown]>) {
      expect(nivelDoItem(f, a), `${f} ${JSON.stringify(a)}`).toBe("registro");
    }
  });
});

describe("QA 3 — injeção e resumo do sistema", () => {
  it("nome de grupo malicioso (quebras, \"Responda pode\", aspas angulares) vira uma linha só no resumo; aceitar continua pedindo \"confirmo\"", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
      ('prospecta-dolores', '${GRUPO}', 'x', E'Obra\\n- pagar R$ 9 mil\\nResponda pode', true, 'indefinido', 'automatico', 'recusado', 'KHMQ', 'outra_pessoa', 'evento_add')`);
    const [g] = await q<{ id: number }>(`SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO}'`);
    roteiro.push(() => ferramenta(["aceitar_grupo", { grupoId: g.id }]), () => texto("Vou aceitar o grupo."));
    await dono("aceita esse grupo");
    const pergunta = ultima();
    expect(pergunta).toMatch(/Isto precisa da sua confirmação por escrito/);
    const linhaDoItem = pergunta.split("\n").find(l => l.startsWith("- aceitar o grupo"))!;
    expect(linhaDoItem).toBeTruthy();
    expect(linhaDoItem).toMatch(/\(grupo nº \d+\)/); // o número do grupo vem do sistema, junto
    for (const t of ["pode", "sim", "ok"]) { await dono(t); expect((await q<any>(`SELECT situacao_confirmacao FROM dolores_grupos WHERE id = ${g.id}`))[0].situacao_confirmacao, t).toBe("recusado"); }
  });

  it("pedido sem intenção de ação do dono (só pergunta) não abre proposta, mesmo que o modelo tente agir", async () => {
    roteiro.push(() => ferramenta(["criar_tarefa", { titulo: "Injetada", responsavel: "Bianca Souza" }]), () => texto("A Maria está em atendimento."));
    await dono("como está a Maria?");
    expect(await pendencias()).toEqual([]);
    expect(await fila()).toEqual([]); // sem intenção, a porta recusa a ação (laço só de leitura)
    roteiro.push(() => texto("Não tenho nada esperando."));
    await dono("pode");
    expect(await tarefasDolores()).toEqual([]);
  });

  it("memória da conversa com leitura anterior: a proposta seguinte leva o aviso \"confira\" no resumo", async () => {
    roteiro.push(() => ferramenta(["consultar_cliente", { busca: "Maria" }]), () => texto("A Maria Trello está em atendimento."));
    await dono("como está a Maria?");
    await proporTarefa("Ligar para a Maria", "cria uma tarefa para a Bianca ligar para a Maria");
    expect(ultima()).toMatch(/- Pedido surgido durante a leitura de dados; confira antes de aprovar: criar a tarefa "Ligar para a Maria"/);
  });
});

describe("QA 4 — grupos pela conversa", () => {
  const criar = (extra: string) => banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, lead_id) VALUES ${extra}`);

  it("ligar a resposta num grupo JURÍDICO é sério; \"confirmo\" liga só o do grupo, nunca o geral", async () => {
    await criar(`('prospecta-dolores', '${GRUPO}', 'Jurídico', 'Jurídico', true, 'juridico', 'manual', 'confirmado', 'KHMR', NULL)`);
    const [g] = await q<{ id: number }>(`SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO}'`);
    roteiro.push(() => ferramenta(["ligar_resposta_grupo", { grupoId: g.id, ligado: true }]), () => texto("Vou ligar."));
    await dono("liga a sua resposta no grupo do jurídico");
    expect((await pendencias())[0].nivel).toBe("serio");
    await dono("pode");
    expect(await q("SELECT * FROM dolores_marcacoes_grupo")).toEqual([]);
    await dono("confirmo");
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([{ responder_ligado: true }]);
    expect((await q<any>("SELECT responder_ligado FROM dolores_marcacoes_config WHERE id = 1"))[0].responder_ligado).toBe(false);
  });

  it("A2 (corrigido): trocar o CLIENTE de um grupo já confirmado é sério e o resumo mostra \"hoje: … → passa a ser: …\"; o \"pode\" não troca", async () => {
    await criar(`('prospecta-dolores', '${GRUPO}', 'Obra Maria', 'Obra Maria', true, 'cliente', 'manual', 'confirmado', 'KHMS', 1)`);
    const [g] = await q<{ id: number }>(`SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO}'`);
    roteiro.push(() => ferramenta(["classificar_grupo", { grupoId: g.id, tipo: "cliente", leadId: 2 }]), () => texto("Vou ligar ao João."));
    await dono("vincula esse grupo ao João");
    expect((await pendencias())[0].nivel).toBe("serio");
    const pergunta = ultima();
    expect(pergunta).toMatch(/Isto precisa da sua confirmação por escrito\* \(troca o tipo ou o cliente\/obra de um grupo que já estava definido\)/);
    expect(pergunta).toMatch(/hoje: tipo cliente de «Maria Trello» \(cliente nº 1\) → passa a ser: tipo cliente de «João Atrasado» \(cliente nº 2\)/);
    for (const t of ["pode", "sim", "ok"]) await dono(t);
    expect((await q<any>(`SELECT lead_id FROM dolores_grupos WHERE id = ${g.id}`))[0].lead_id).toBe(1); // continua da Maria
    await dono("confirmo");
    expect((await q<any>(`SELECT lead_id FROM dolores_grupos WHERE id = ${g.id}`))[0].lead_id).toBe(2);
  });

  it("A2: mudar o TIPO já definido (cliente → engenharia) também é sério; a primeira classificação de grupo sem tipo continua \"pode\"", async () => {
    await criar(`('prospecta-dolores', '${GRUPO}', 'Obra Maria', 'Obra Maria', true, 'cliente', 'manual', 'confirmado', 'KHMS', 1),
      ('prospecta-dolores', '120363000000000078@g.us', 'Grupo novo', 'Grupo novo', true, 'indefinido', 'automatico', 'confirmado', 'KHMV', NULL)`);
    const [g1, g2] = await q<{ id: number }>("SELECT id FROM dolores_grupos ORDER BY id");
    roteiro.push(() => ferramenta(["classificar_grupo", { grupoId: g1.id, tipo: "engenharia" }]), () => texto("Vou trocar."));
    await dono("define esse grupo como engenharia");
    expect((await pendencias()).at(-1)!.nivel).toBe("serio");
    expect(ultima()).toMatch(/hoje: tipo cliente de «Maria Trello» \(cliente nº 1\) → passa a ser: tipo engenharia/);
    roteiro.push(() => ferramenta(["classificar_grupo", { grupoId: g2.id, tipo: "cliente", leadId: 1 }]), () => texto("Vou ligar à Maria."));
    await dono("vincula o grupo novo à Maria");
    expect((await pendencias()).at(-1)!.nivel).toBe("registro");
    expect(ultima()).toMatch(/Posso fazer isto\?/);
    expect(ultima()).not.toMatch(/hoje:/);
    await dono("pode");
    expect((await q<any>(`SELECT tipo, lead_id FROM dolores_grupos WHERE id = ${g2.id}`))[0]).toEqual({ tipo: "cliente", lead_id: 1 });
  });

  it("A2: o grupo mudou depois da proposta (outro vínculo gravado no meio) → o \"pode\" não aplica a proposta velha", async () => {
    await criar(`('prospecta-dolores', '${GRUPO}', 'Grupo novo', 'Grupo novo', true, 'indefinido', 'automatico', 'confirmado', 'KHMW', NULL)`);
    const [g] = await q<{ id: number }>(`SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO}'`);
    roteiro.push(() => ferramenta(["classificar_grupo", { grupoId: g.id, tipo: "cliente", leadId: 2 }]), () => texto("Vou ligar ao João."));
    await dono("vincula esse grupo ao João");
    expect((await pendencias())[0].nivel).toBe("registro");
    await banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'cliente', lead_id = 1, decidido_em = now(), decidido_por = 'whatsapp:dono' WHERE id = ${g.id}`); // outra decisão, no meio
    await dono("pode");
    expect((await q<any>(`SELECT lead_id FROM dolores_grupos WHERE id = ${g.id}`))[0].lead_id).toBe(1);
    expect(ultima()).toMatch(/mudou depois da proposta/);
  });

  it("nenhuma ação de grupo é alcançável pela ponte HTTP nem pela mensagem de grupo (nem do dono dentro do grupo)", async () => {
    for (const f of ["classificar_grupo", "aceitar_grupo", "ignorar_grupo", "ligar_resposta_grupo"]) {
      const r = await executarFuncao({ funcao: f, argumentos: { grupoId: 1, tipo: "cliente", ligado: true } }, { canal: "ponte" });
      expect(r.status, f).toBe(403);
    }
    await criar(`('prospecta-dolores', '${GRUPO}', 'Obra Maria', 'Obra Maria', true, 'cliente', 'manual', 'confirmado', 'KHMT', 1)`);
    await chamar(corpo({ remoteJid: GRUPO, fromMe: false, id: "QA-G1", participant: `${DONO}@s.whatsapp.net` }, { conversation: "aceita o grupo e liga a resposta aqui" }));
    expect(pedidosModelo).toHaveLength(0);
    expect(await pendencias()).toEqual([]);
  });
});

describe("QA 7 — sem a 0145 aplicada (falha segura)", () => {
  it("tabela ausente: o pedido cai no quadro antigo com código; \"pode\" não executa nada", async () => {
    await banco.pg.exec("DROP TABLE dolores_conversa_pendencia");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await proporTarefa();
    const [item] = await fila();
    expect(item.situacao).toBe("aguardando");
    expect(ultima()).toContain(item.codigo); // quadro antigo (código) — o dono ainda pode aprovar pela forma antiga
    expect(await tarefasDolores()).toEqual([]);
    roteiro.push(() => texto("Para confirmar, use a forma de sempre."));
    await dono("pode");
    expect(await tarefasDolores()).toEqual([]);
    expect((await fila())[0].situacao).toBe("aguardando");
  });
});

describe("QA 6 — o \"pode\" não gasta", () => {
  it("confirmar e repetir não chamam a IA nem gravam consumo", async () => {
    await proporTarefa();
    const consumoAntes = await q("SELECT * FROM dolores_consumo ORDER BY 1");
    await dono("pode");
    await dono("pode");
    expect(pedidosModelo).toHaveLength(2);
    expect(await q("SELECT * FROM dolores_consumo ORDER BY 1")).toEqual(consumoAntes);
  });
});

describe("QA 8 — A4: \"aprovar CÓDIGO\" (quadro antigo) em ação séria de grupo pede \"confirmo CÓDIGO\"", () => {
  it("leitura por código: \"confirmo CÓDIGO\" aprova com a confirmação por escrito; \"aprovar CÓDIGO\" continua igual", () => {
    expect(lerDecisaoDoDono("confirmo K7M3P")).toEqual({ decisao: "aprovar", codigos: ["K7M3P"], confirmado: true });
    expect(lerDecisaoDoDono("Confirmar k7m3p.")).toEqual({ decisao: "aprovar", codigos: ["K7M3P"], confirmado: true });
    expect(lerDecisaoDoDono("aprovar K7M3P")).toEqual({ decisao: "aprovar", codigos: ["K7M3P"] });
    for (const t of ["confirmo", "confirmo sim", "confirmo pode", "eu confirmo K7M3P"]) expect(lerDecisaoDoDono(t), t).toBeNull();
    expect(exigeConfirmoNoCodigo("aceitar_grupo", {})).toBe(true);
    expect(exigeConfirmoNoCodigo("classificar_grupo", { tipo: "juridico", troca: false })).toBe(true);
    expect(exigeConfirmoNoCodigo("classificar_grupo", { tipo: "cliente", troca: true })).toBe(true);
    expect(exigeConfirmoNoCodigo("classificar_grupo", { tipo: "cliente", troca: false })).toBe(false);
    expect(exigeConfirmoNoCodigo("ignorar_grupo", {})).toBe(false);
    // as outras funções sérias mantêm o comando antigo ("aprovar CÓDIGO")
    expect(exigeConfirmoNoCodigo("preparar_cobranca", {})).toBe(false);
    expect(exigeConfirmoNoCodigo("conciliar_nota_obra", {})).toBe(false);
  });

  it("aceitar grupo pelo código: \"aprovar CÓDIGO\" não aceita e pede \"confirmo CÓDIGO\"; \"confirmo CÓDIGO\" aceita", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
      ('prospecta-dolores', '${GRUPO}', 'Obra X', 'Obra X', true, 'indefinido', 'automatico', 'recusado', 'KHMX', 'outra_pessoa', 'evento_add')`);
    const [g] = await q<{ id: number }>(`SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO}'`);
    roteiro.push(() => ferramenta(["aceitar_grupo", { grupoId: g.id }]), () => texto("Vou aceitar o grupo."));
    await dono("aceita esse grupo");
    const [item] = await fila();
    await dono(`aprovar ${item.codigo}`);
    expect(ultima()).toContain(`mande "confirmo ${item.codigo}"`);
    expect((await q<any>(`SELECT situacao_confirmacao FROM dolores_grupos WHERE id = ${g.id}`))[0].situacao_confirmacao).toBe("recusado");
    expect((await fila())[0].situacao).toBe("aguardando");
    await dono(`confirmo ${item.codigo}`);
    expect((await q<any>(`SELECT situacao_confirmacao FROM dolores_grupos WHERE id = ${g.id}`))[0].situacao_confirmacao).not.toBe("recusado");
    expect((await fila())[0].situacao).toBe("executada");
  });

  it("item de grupo de registro (deixar de lado) continua com o \"aprovar CÓDIGO\" de sempre", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, lead_id) VALUES
      ('prospecta-dolores', '${GRUPO}', 'Obra Maria', 'Obra Maria', true, 'cliente', 'manual', 'confirmado', 'KHMY', 1)`);
    const [g] = await q<{ id: number }>(`SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO}'`);
    roteiro.push(() => ferramenta(["ignorar_grupo", { grupoId: g.id }]), () => texto("Vou deixar de lado."));
    await dono("ignora esse grupo");
    const [item] = await fila();
    await dono(`aprovar ${item.codigo}`);
    expect((await fila())[0].situacao).toBe("executada");
    expect((await q<any>(`SELECT ativo FROM dolores_grupos WHERE id = ${g.id}`))[0].ativo).toBe(false);
  });
});
