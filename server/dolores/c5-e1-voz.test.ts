// EPIC-027 C5 (E1) — a voz da Dolores: o filtro de saída (só o texto do modelo), os rótulos das consultas, o "esquece" e o
// prompt novo (sem citar ferramenta, sem "aprovar CÓDIGO"). Regras puras: nada de banco nem de rede.
import { describe, expect, it } from "vitest";
import { ROTULO_CONSULTA, ehPedidoDeEsquecer, pedeDetalhe, rotulosDasConsultas, semCodigos, vozDaDolores } from "../../shared/dolores/voz.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { ACOES } from "./acoes/registro.js";
import { FUNCOES } from "./funcoes.js";
import { promptSistemaWhatsapp } from "./prompt.js";

describe("filtro de voz (shared/dolores/voz.ts)", () => {
  it("o exemplo real do dono: \"[listar_grupos; ler_grupo_cliente]\" some, sem deixar espaço antes do ponto", () => {
    const r = vozDaDolores("Não achei o grupo da Lúcia Brena [listar_grupos; ler_grupo_cliente].");
    expect(r.texto).toBe("Não achei o grupo da Lúcia Brena.");
    expect(r.correcoes).toBe(1);
  });
  it("vários formatos de colchete de ferramenta, no meio e no fim da linha", () => {
    expect(vozDaDolores("6 dias de atraso [listar_processos_regularizacao], responsável Bianca.").texto).toBe("6 dias de atraso, responsável Bianca.");
    expect(vozDaDolores("Total: 3 [listar_obras, listar_medicoes]\n- Casa Ana").texto).toBe("Total: 3\n- Casa Ana");
    expect(vozDaDolores("Ok [ consultar_cliente ; ]").texto).toBe("Ok");
  });
  it("preserva os marcadores do filtro de segurança e colchetes legítimos", () => {
    for (const t of ["Senha [senha omitida].", "Veja [link removido] na tela.", "CPF [dado pessoal omitido]", "Conta [dado bancário omitido]", "Item [1] e [RG]", "Chave [chave de acesso omitida]"]) {
      const r = vozDaDolores(t);
      expect(r.texto).toBe(t);
      expect(r.correcoes).toBe(0);
    }
  });
  it("nome de ferramenta solto vira rótulo de gente; parêntese de fonte com ferramenta some", () => {
    expect(vozDaDolores("Pelo listar_tarefas, a Bianca tem 2 atrasadas.").texto).toBe("Pelo tarefas, a Bianca tem 2 atrasadas.");
    expect(vozDaDolores("A obra está em 60% (fonte: listar_obras).").texto).toBe("A obra está em 60%.");
    expect(vozDaDolores("Usei `consultar_cliente` agora.").texto).toBe("Usei cadastro do cliente agora.");
    // parêntese comum fica
    expect(vozDaDolores("Recebi pelo WhatsApp (via grupo).").texto).toBe("Recebi pelo WhatsApp (via grupo).");
  });
  it("tira ids internos, \"aprovar CÓDIGO\" e código de grupo vindos do modelo", () => {
    expect(vozDaDolores("A Lúcia (leadId 456) está em documentação.").texto).toBe("A Lúcia está em documentação.");
    expect(vozDaDolores("Para confirmar, responda «aprovar K7M3P».").texto).toBe("Para confirmar, responda.");
    expect(vozDaDolores("Entrei no grupo «Obra» (código K7HM). Responda «grupo K7HM 3».").texto).toBe("Entrei no grupo «Obra». Responda.");
    // palavra comum depois de "aprovar" não é código
    expect(vozDaDolores("Você quer aprovar todas?").correcoes).toBe(0);
  });
  it("texto sem nada a corrigir sai idêntico (sem mexer em espaços nem quebras)", () => {
    const t = "*Resumo*\n\n- Maria  —  12 d\n  - detalhe";
    expect(vozDaDolores(t)).toEqual({ texto: t, correcoes: 0 });
  });
  it("roda antes dos filtros de segurança e não atrapalha: senha continua omitida depois", () => {
    const t = sanitizarTexto(vozDaDolores("Senha do portal: 1234 [consultar_cliente]").texto, { mascararDadosPessoais: false });
    expect(t).not.toContain("1234");
    expect(t).not.toContain("consultar_cliente");
  });
  it("semCodigos: tira códigos de aprovação e de grupo do texto da memória", () => {
    expect(semCodigos("Responda «aprovar K7M3P» ou «recusar K7M3P».")).not.toMatch(/K7M3P/);
    expect(semCodigos("Dolores: entrei no grupo «Obra Lúcia» (código K7HM).")).toBe("Dolores: entrei no grupo «Obra Lúcia».");
    expect(semCodigos("Nada aqui")).toBe("Nada aqui");
  });
  it("todo nome de consulta e de ação tem rótulo de gente (função nova precisa ganhar o seu)", () => {
    for (const n of [...FUNCOES.map(f => f.nome), ...ACOES.map(a => a.nome)]) expect(ROTULO_CONSULTA[n], n).toBeTruthy();
    expect(rotulosDasConsultas(["listar_tarefas", "listar_obras", "listar_tarefas"])).toBe("tarefas, obras");
    expect(rotulosDasConsultas(["coisa_nova_x"])).toBe("outra consulta");
  });
});

describe("mensagens do dono reconhecidas por código", () => {
  it("esquece / limpa a conversa: só a mensagem inteira", () => {
    for (const t of ["esquece", "Esquece.", "esqueça tudo", "limpa a conversa", "Novo assunto!", "começa de novo", "Dolores, esquece"]) expect(ehPedidoDeEsquecer(t), t).toBe(true);
    for (const t of ["esquece a tarefa da Bianca", "não esquece de cobrar", "limpa a conversa e cria tarefa", "", "esquecer"]) expect(ehPedidoDeEsquecer(t), t).toBe(false);
  });
  it("pedeDetalhe libera a saída longa só quando ele pede lista/relatório/detalhe", () => {
    expect(pedeDetalhe("Dolores, analise todos os processos de regularização")).toBe(true);
    expect(pedeDetalhe("me manda a lista completa das obras")).toBe(true);
    expect(pedeDetalhe("Lucia brena")).toBe(false);
    expect(pedeDetalhe("e o que falta dela?")).toBe(false);
  });
});

describe("prompt de sistema novo (trava de regressão)", () => {
  for (const mascarar of [true, false]) {
    it(`mascarar=${mascarar}: sem "Cite a fonte", sem nome de função entre colchetes, sem "aprovar CÓDIGO" e sem prometer ação da E2`, () => {
      const p = promptSistemaWhatsapp(mascarar);
      expect(p).not.toMatch(/Cite a fonte/i);
      expect(p).not.toMatch(/\[[a-z]+_[a-z_]+\]/);
      expect(p).not.toMatch(/aprovar C[ÓO]DIGO/i);
      expect(p).not.toMatch(/Você não atende clientes/);
      expect(p).not.toMatch(/cadastrou o administrador|cadastrados pelo administrador/);
      // nenhum nome interno de ferramenta no texto do sistema
      for (const n of [...FUNCOES.map(f => f.nome), ...ACOES.map(a => a.nome)]) expect(p, n).not.toContain(n);
      // o que existe hoje: 6 tipos de grupo, atende cliente cadastrado; o que é da E2 aparece como "ainda não dá"
      for (const t of ["cliente, pós-atendimento, jurídico, administrativo (sócios), parceiros comerciais ou\n  engenharia", "Cliente cadastrado", "Ainda não dá para fazer pela conversa"]) expect(p).toContain(t);
      // nada dinâmico (o cache do texto do sistema vale entre pedidos)
      expect(promptSistemaWhatsapp(mascarar)).toBe(p);
      // tamanho: curto (o antigo tinha ~8.800 caracteres)
      expect(p.length).toBeLessThan(6_500);
    });
  }
});
