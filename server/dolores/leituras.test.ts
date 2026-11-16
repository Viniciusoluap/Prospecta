// EPIC-025 (Dolores, etapa 1) — leituras contra o cenário de aceite (PGlite). Nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { getDb } from "../db.js";
import { funcaoPorNome } from "./funcoes.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;

async function chamar(nome: string, argumentos: Record<string, unknown> = {}) {
  const fn = funcaoPorNome(nome)!;
  const r = await fn.executar(fn.entrada.parse(argumentos) as never, { agora: AGORA });
  return r as { dados: any; resumo: Record<string, unknown> };
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  // os testes da etapa 1 afirmam os campos MASCARADOS: rodam com o interruptor ligado; o par liberado (opção B do dono,
  // 16/11) está em "opção B" no fim do arquivo
  vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", "1");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("teste de aceite: processos de regularização", () => {
  it("atrasados, pendências, responsáveis e próximas providências com os dados reais", async () => {
    const { dados, resumo } = await chamar("listar_processos_regularizacao");
    expect(dados.totais).toMatchObject({
      processosNoSistema: 4, abertos: 3, atrasados: 1, parados: 1, comDocumentosPendentes: 2, comTarefasAtrasadas: 1,
      responsavelAConfirmar: 1, vindosDoTrello: 1, semProximaProvidencia: 0,
    });
    expect(resumo).toMatchObject({ encontrados: 3, devolvidos: 3 });
    const [joao, maria, ana] = dados.itens;

    // atrasado: previsão 10/11, hoje 16/11 → 6 dias; documento e tarefa pendentes; próxima providência = tarefa
    expect(joao).toMatchObject({
      id: 2, cliente: "João Atrasado", servico: "Averbação de construção", status: "Em análise", atrasado: true, diasDeAtraso: 6,
      prazo: "2026-11-10", origemDoPrazo: "previsão de término do processo", responsavel: "Bianca Souza", responsavelAConfirmar: false,
      etapaAtual: { nome: "Análise documental", progresso: 0, todasConcluidas: false }, observacoesDoProcesso: "Cartório pediu nova certidão",
      tarefasAbertas: 1, proximaProvidencia: { fonte: "tarefa", descricao: "Cobrar certidão do cartório", prazo: "2026-11-12", responsavel: "Bianca Souza" },
    });
    expect(joao.documentosPendentes).toEqual([
      { documento: "Comprovante de renda atualizado", situacao: "recusado (enviar de novo)", origem: "documentos do cliente (CRM)" },
      { documento: "Certidão de matrícula", situacao: "pendente", origem: "documentos do processo (cadastro antigo)" },
    ]);
    expect(joao.tarefasAtrasadas).toEqual([{ id: 1, tarefa: "Cobrar certidão do cartório", responsavel: "Bianca Souza", prazo: "2026-11-12", prioridade: "alta" }]);

    // migrado do Trello, responsável vazio → "a confirmar"; parado desde 01/10 (46 dias); motivo pela observação da etapa
    expect(maria).toMatchObject({
      id: 1, cliente: "Maria Trello", servico: "Regularização casa Maria", origem: "migração do Trello", responsavel: "a confirmar",
      responsavelAConfirmar: true, motivoResponsavel: "padrão da migração do Trello (responsável não informado)", responsavelNoCrm: "Bianca Souza",
      atrasado: false, prazo: null, parado: true, diasSemMovimentacao: 46, telefone: "(99) *****-4567",
      etapaAtual: { nome: "Protocolo na prefeitura", progresso: 40, todasConcluidas: false }, progressoDasEtapas: 70,
      observacaoDaEtapaAtual: "Aguardando certidão do cartório",
      proximaProvidencia: { fonte: "follow_up_agendado", prazo: "2026-11-18" },
    });
    expect(maria.documentosPendentes).toEqual([{ documento: "RG ou CNH frente e verso", situacao: "pendente", origem: "documentos do cliente (CRM)" }]);
    expect(maria.documentosRecebidos).toBe(1);

    expect(ana).toMatchObject({ id: 3, atrasado: false, parado: false, responsavel: "Vinícius", proximaProvidencia: { fonte: "tarefa", prazo: "2026-11-20" } });
    expect(dados.porResponsavel).toEqual(expect.arrayContaining([
      { responsavel: "a confirmar", processos: 1, atrasados: 0, parados: 1 },
      { responsavel: "Bianca Souza", processos: 1, atrasados: 1, parados: 0 },
    ]));
    // nada de link, arquivo ou id do Drive na resposta
    expect(JSON.stringify(dados)).not.toMatch(/drive-segredo|fileUrl|driveFileId|comprovante-maria/);
  });

  it("filtros: atrasados, parados, responsável a confirmar, todos (inclui concluído)", async () => {
    expect((await chamar("listar_processos_regularizacao", { situacao: "atrasados" })).dados.itens.map((p: any) => p.id)).toEqual([2]);
    expect((await chamar("listar_processos_regularizacao", { situacao: "parados" })).dados.itens.map((p: any) => p.id)).toEqual([1]);
    expect((await chamar("listar_processos_regularizacao", { responsavel: "A CONFIRMAR" })).dados.itens.map((p: any) => p.id)).toEqual([1]);
    expect((await chamar("listar_processos_regularizacao", { situacao: "todos" })).dados.total).toBe(4);
    const p1 = (await chamar("listar_processos_regularizacao", { situacao: "parados", diasParado: 1 })).dados.itens;
    expect(p1.map((p: any) => [p.id, p.diasSemMovimentacao])).toEqual([[2, 1], [1, 46], [3, 1]]);
  });

  it("detalhe do processo: etapas, tarefas, financeiro em BRL e histórico; id inexistente diz que não existe", async () => {
    const { dados } = await chamar("detalhar_processo_regularizacao", { id: 2 });
    expect(dados.financeiro).toEqual({ moeda: "BRL", previsto: 2000, recebido: 500, saldoAReceber: 1500 });
    expect(dados.ultimasAtividadesDoCliente[0]).toMatchObject({ tipo: "call", em: "2026-11-15T10:00:00-03:00" });
    expect(dados.tarefas[0]).toMatchObject({ tarefa: "Cobrar certidão do cartório", atrasada: true });
    expect((await chamar("detalhar_processo_regularizacao", { id: 99 })).dados).toMatchObject({ encontrado: false });
  });
});

describe("demais leituras", () => {
  it("cliente: situação, serviços com o registro operacional, CPF e telefone mascarados", async () => {
    const { dados } = await chamar("consultar_cliente", { busca: "maria" });
    expect(dados.encontrados).toBe(1);
    const c = dados.clientes[0];
    expect(c).toMatchObject({
      nome: "Maria Trello", cpf: "***.***.***-01", telefone: "(99) *****-4567", etapaNoCrm: "Em Atendimento", responsavel: "Bianca Souza",
      prazoDoCard: "2026-11-10", prazoDoCardVencido: true, documentosPendentes: 1,
    });
    expect(c.servicosContratados[0]).toMatchObject({ tipo: "Regularização imobiliária", origem: "migração do Trello", registroOperacional: { modulo: "Regularizações", id: 1, situacao: "Em andamento" } });
    expect(JSON.stringify(dados)).not.toContain("123.456.789");
    // pelo CPF inteiro e pelos dígitos do telefone
    expect((await chamar("consultar_cliente", { busca: "12345678901" })).dados.clientes[0].leadId).toBe(1);
    expect((await chamar("consultar_cliente", { busca: "8888-7777" })).dados.clientes[0].nome).toBe("João Atrasado");
    const joao = (await chamar("consultar_cliente", { leadId: 2 })).dados.clientes[0];
    expect(joao.servicosContratados.map((s: any) => s.registroOperacional?.modulo)).toEqual(expect.arrayContaining(["Regularizações", "Financiamentos"]));
    expect(joao.responsavel).toBeNull();
    expect((await chamar("consultar_cliente", { busca: "ninguém" })).dados.encontrados).toBe(0);
    // curingas do LIKE não listam o CRM inteiro
    expect((await chamar("consultar_cliente", { busca: "%%" })).dados.encontrados).toBe(0);
    expect((await chamar("consultar_cliente", { busca: "__" })).dados.encontrados).toBe(0);
    expect(() => funcaoPorNome("consultar_cliente")!.entrada.parse({})).toThrow();
  });

  it("histórico de atendimento e conversas do WhatsApp", async () => {
    const h = (await chamar("historico_atendimento", { leadId: 2 })).dados;
    expect(h.itens.map((a: any) => a.tipo)).toEqual(["ligação", "anotação"]);
    const c = (await chamar("conversas_whatsapp", { leadId: 1 })).dados;
    expect(c.mensagens[0]).toMatchObject({ direcao: "enviada", textoEnviado: "Estamos aguardando a certidão do cartório." });
    expect(c.mensagens[1]).toMatchObject({ direcao: "recebida do cliente", textoDoCliente: "Bom dia, como está meu processo?" });
    expect(h.itens[0].textoLivre).toBe("Cliente avisou que o cartório pediu nova certidão");
    const recentes = (await chamar("conversas_whatsapp")).dados.conversas;
    expect(recentes[0]).toMatchObject({ leadId: 1, cliente: "Maria Trello", naoLidas: 1, telefone: "(99) *****-4567" });
    // L4: só clientes com não lidas; lida a mensagem, a conversa sai da lista
    expect(recentes).toHaveLength(1);
    await banco.pg.exec("UPDATE whatsapp_messages SET lida = true");
    expect((await chamar("conversas_whatsapp")).dados.conversas).toEqual([]);
  });

  it("tarefas por responsável, com a regra de atraso da tela", async () => {
    const { dados } = await chamar("listar_tarefas", { situacao: "atrasadas" });
    expect(dados.itens.map((t: any) => t.tarefa)).toEqual(["Cobrar certidão do cartório", "Conferir planilha"]);
    expect(dados.porResponsavel[0]).toEqual({ responsavel: "Bianca Souza", abertas: 2, atrasadas: 2 });
    expect(dados.totais).toEqual({ abertas: 3, atrasadas: 2, semPrazo: 0 });
    expect((await chamar("listar_tarefas", { situacao: "concluidas" })).dados.itens[0]).toMatchObject({ responsavel: "sem responsável", cliente: "Maria Trello" });
  });

  it("documentos pendentes e recebidos, por cliente e de um cliente", async () => {
    const g = (await chamar("listar_documentos")).dados;
    expect(g.totais).toEqual({ pendentes: 4, recebidos: 1 });
    expect(g.itens[0]).toMatchObject({ cliente: "João Atrasado", quantidade: 3 });
    const m = (await chamar("listar_documentos", { leadId: 1, situacao: "todos" })).dados;
    expect(m.itens.map((d: any) => d.situacao).sort()).toEqual(["aprovado", "pendente"]);
    expect(JSON.stringify(g) + JSON.stringify(m)).not.toMatch(/drive-segredo|renda\.pdf/);
  });

  it("atrasos de todos os módulos numa lista", async () => {
    const { dados } = await chamar("listar_atrasos");
    const chaves = dados.itens.map((i: any) => `${i.modulo}#${i.id}`);
    expect(chaves).toEqual(expect.arrayContaining(["Regularização#2", "Regularização#1", "Obra#1", "Financiamento#1", "CRM (prazo do card)#1", "CRM (prazo do serviço)#2"]));
    expect(chaves).not.toContain("CRM (prazo do card)#4"); // finalizado não vence
    expect(dados.itens.find((i: any) => i.modulo === "Regularização" && i.id === 1).motivoRegistrado).toBe("Aguardando certidão do cartório");
  });

  it("obras e medições", async () => {
    const o = (await chamar("listar_obras")).dados;
    expect(o.totais).toMatchObject({ obras: 2, ativas: 1, atrasadas: 1 });
    expect(o.itens[0]).toMatchObject({ obra: "Casa Ana", cliente: "Ana Em Dia", etapaAtual: "Alvenaria", atrasada: true, diasDeAtraso: 15,
      medicoesAguardandoBanco: 1, medicoesRecebidas: 1, moeda: "BRL", orcamentoPrevisto: 180000, vgv: 250000 });
    const m = (await chamar("listar_medicoes", { situacao: "aguardando_banco" })).dados;
    expect(m.itens).toHaveLength(1);
    expect(m.itens[0]).toMatchObject({ obra: "Casa Ana", situacao: "aguardando o banco", progressoMedidoPct: 45.5 });
  });

  it("financiamentos (CPF mascarado) e recebíveis pendentes", async () => {
    const f = (await chamar("listar_financiamentos")).dados;
    expect(f.itens[0]).toMatchObject({ cliente: "João Atrasado", cpf: "***.***.***-00", situacao: "Documentação", banco: "Caixa Econômica Federal", parado: true,
      valorFinanciado: 160000, pendenciasDoChecklist: ["Documentos: Certidão de nascimento"] });
    const r = (await chamar("listar_recebiveis_pendentes")).dados;
    expect(r.totais).toEqual({ moeda: "BRL", cobrancasBpo: 2, emAbertoBpo: 2500, vencidasBpo: 1, vencidoBpo: 1000, regularizacoesComSaldo: 1, saldoRegularizacoes: 1500 });
    expect(r.itens[0]).toMatchObject({ descricao: "Honorários outubro", situacao: "vencido", emAberto: 1000, vencimento: "2026-11-01" });
    expect((await chamar("listar_recebiveis_pendentes", { situacao: "vencidos" })).dados.itens).toHaveLength(1);
  });
});

describe("limites da saída", () => {
  it("página e limite máximos; texto cortado", async () => {
    const valores = Array.from({ length: 80 }, (_, i) => `('Processo ${i}', 'Tipo', 'em_andamento', 'Rua', 'Fulano', '${"x".repeat(5000)}')`).join(",");
    await banco.pg.exec(`INSERT INTO regularizacoes (client_name, type, status, address, responsible, notes) VALUES ${valores}`);
    const fn = funcaoPorNome("listar_processos_regularizacao")!;
    expect(() => fn.entrada.parse({ limite: 51 })).toThrow();
    expect(() => fn.entrada.parse({ campoExtra: 1 })).toThrow();
    const { dados } = await chamar("listar_processos_regularizacao", { limite: 50, pagina: 2 });
    expect(dados).toMatchObject({ total: 83, pagina: 2, limite: 50, temMais: false });
    expect(dados.itens).toHaveLength(33);
    expect(dados.itens.every((p: any) => p.observacoesDoProcesso === null || p.observacoesDoProcesso.length <= 280)).toBe(true);
  });
});

describe("prazo do card que vence hoje (L9)", () => {
  it("conta como vencido, igual ao aviso diário dos cards (lte)", async () => {
    await banco.pg.exec("UPDATE leads SET card_due_date = '2026-11-16' WHERE id = 3");
    const item = (await chamar("listar_atrasos", { modulo: "crm" })).dados.itens.find((i: any) => i.modulo === "CRM (prazo do card)" && i.id === 3);
    expect(item).toMatchObject({ cliente: "Ana Em Dia", situacao: "Medições", prazo: "2026-11-16", diasDeAtraso: 0 });
    expect((await chamar("consultar_cliente", { leadId: 3 })).dados.clientes[0].prazoDoCardVencido).toBe(true);
    await banco.pg.exec("UPDATE leads SET card_due_date = '2026-11-17' WHERE id = 3");
    expect((await chamar("consultar_cliente", { leadId: 3 })).dados.clientes[0].prazoDoCardVencido).toBe(false);
  });
});

describe("cliente excluído do CRM (M3)", () => {
  beforeEach(async () => {
    await banco.pg.exec(`
      INSERT INTO leads (name, phone, stage, deleted_at, responsible_user_id) VALUES ('Excluído Fulano', '99911112222', 'attending', '2026-11-01', 2);
      INSERT INTO lead_activities (lead_id, type, description, created_at) VALUES (5, 'note', 'anotação do excluído', '2026-11-15 12:00');
      INSERT INTO whatsapp_messages (connection_id, lead_id, destinatario, mensagem, direcao, lida, created_at) VALUES
        (1, 5, '5599911112222', 'mensagem do excluído', 'entrada', false, '2026-11-16 11:00'),
        (1, NULL, '5599900001111', 'contato sem cliente', 'entrada', false, '2026-11-16 11:30');
      INSERT INTO lead_documents (lead_id, type, status) VALUES (5, 'rg', 'pending');
      INSERT INTO tasks (title, assigned_to, related_type, related_id, status, due_at) VALUES ('Tarefa do excluído', 'Bianca Souza', 'lead', 5, 'pending', '2026-11-10 12:00');
      INSERT INTO regularizacoes (client_name, type, status, address, responsible, lead_id) VALUES ('Excluído Fulano', 'Usucapião', 'em_andamento', 'Rua', 'Bianca Souza', 5);
      INSERT INTO regularizacao_documents (regularizacao_id, name, status) VALUES (5, 'Documento do excluído', 'pending');
      INSERT INTO financiamentos (cliente_nome, cliente_tel, status, lead_id) VALUES ('Excluído Fulano', '9', 'documentacao', 5);
      INSERT INTO financiamento_checklist_items (financiamento_id, grupo, item, solicitar_documento) VALUES (2, 'Docs', 'Checklist do excluído', true);
      INSERT INTO construction_projects (title, lead_id, status, progress) VALUES ('Obra do excluído', 5, 'in_progress', 10);`);
  });

  it("histórico, conversas, documentos, tarefas e dados do CRM dele não saem", async () => {
    expect((await chamar("historico_atendimento", { leadId: 5 })).dados).toMatchObject({ encontrado: false });
    expect((await chamar("conversas_whatsapp", { leadId: 5 })).dados).toMatchObject({ encontrado: false });
    expect(JSON.stringify((await chamar("conversas_whatsapp")).dados)).not.toMatch(/excluído|Excluído|contato sem cliente|1111/);
    const docs = JSON.stringify((await chamar("listar_documentos", { situacao: "todos", limite: 50 })).dados);
    expect(docs).not.toMatch(/excluído|Excluído/i);
    const t = (await chamar("listar_tarefas")).dados.itens.find((x: any) => x.tarefa === "Tarefa do excluído");
    expect(t).toMatchObject({ cliente: null, leadId: null, clienteExcluidoDoCrm: true });
    // o processo de regularização continua (como na tela), sem nada do CRM do cliente excluído
    const p = (await chamar("detalhar_processo_regularizacao", { id: 5 })).dados;
    expect(p).toMatchObject({ clienteExcluidoDoCrm: true, responsavelNoCrm: null, documentosPendentes: [], tarefasAbertas: 0, ultimasAtividadesDoCliente: [] });
    expect((await chamar("listar_obras", { busca: "excluído" })).dados.itens[0]).toMatchObject({ cliente: null, responsavelNoCrm: null });
    expect((await chamar("consultar_cliente", { leadId: 5 })).dados.encontrados).toBe(0);
  });
});

describe("opção B (16/11): com o interruptor desligado, as leituras devolvem CPF, telefone e e-mail completos", () => {
  for (const valor of [undefined, "0"]) {
    it(`variável ${valor === undefined ? "ausente" : `"${valor}"`}`, async () => {
      vi.unstubAllEnvs();
      if (valor !== undefined) vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", valor);
      await banco.pg.exec("UPDATE leads SET email = 'maria@exemplo.com.br' WHERE id = 1");
      const c = (await chamar("consultar_cliente", { busca: "maria" })).dados.clientes[0];
      expect(c).toMatchObject({ nome: "Maria Trello", cpf: "123.456.789-01", telefone: "(99) 99123-4567", email: "maria@exemplo.com.br" });
      expect((await chamar("consultar_cliente", { leadId: 3 })).dados.clientes[0]).toMatchObject({ cpf: null, email: null });
      expect((await chamar("conversas_whatsapp")).dados.conversas[0]).toMatchObject({ telefone: "5599991234567" });
      expect((await chamar("listar_financiamentos")).dados.itens[0]).toMatchObject({ cpf: "987.654.321-00" });
      const regs = (await chamar("listar_processos_regularizacao")).dados;
      expect(JSON.stringify(regs)).toContain("\"telefone\":\"99991234567\"");
    });
  }

  it("com \"1\": mascarados como antes e o e-mail não sai", async () => {
    await banco.pg.exec("UPDATE leads SET email = 'maria@exemplo.com.br' WHERE id = 1");
    const dados = (await chamar("consultar_cliente", { busca: "maria" })).dados;
    expect(dados.clientes[0]).toMatchObject({ cpf: "***.***.***-01", telefone: "(99) *****-4567" });
    expect(JSON.stringify(dados)).not.toMatch(/maria@|email/);
  });
});
