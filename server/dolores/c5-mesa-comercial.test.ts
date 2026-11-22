// EPIC-027 C5-COM (mesa comercial ligada à maquete, aprovada pelo dono em 21/11) — a Dolores, na conversa direta do DONO, acha o lote
// com maquete 3D (busca tolerante), diz se a página pública abre (o LINK completo, só quando abre; o motivo, quando não), o status
// (só com unidade da Incorporação ligada), monta o rascunho de mensagem ao cliente (NADA é enviado) e gera/troca o link (de fila:
// "pode" para gerar, "confirmo" para trocar). Banco em memória (PGlite), modelo e envio falsos, sem rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { lotePublico } from "../maquete-3d/lotes.js";
import { exigeConfirmoNoCodigo, lerConfirmacao, nivelDoItem } from "../../shared/dolores/confirmacao.js";
import { intencaoDeAcao } from "../../shared/dolores/fila.js";
import { tratarLinksDaResposta } from "../../shared/dolores/links.js";
import { TITULO_RASCUNHO, lerBuscaDeLote, linkDoLote, origemPublica, rascunhoDoLote } from "../../shared/dolores/maquete-lote.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { CODIGO_RE } from "../../shared/maquete-3d/lote-publico.js";
import { ACOES } from "./acoes/registro.js";
import { ferramentasDoCliente } from "./atendimento.js";
import { RESERVA_MINIMA_ENTRADA, SOBRECARGA_DE_FERRAMENTAS, definirClienteModelo, ferramentasParaOModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { filtroDaSaida } from "./dados-pessoais.js";
import { FUNCOES, funcaoPorNome } from "./funcoes.js";
import { LEITURAS_DO_GRUPO, LEITURAS_DO_PARCEIRO, LEITURAS_INTERNAS, executarLeituraInterna } from "./marcacao.js";
import { hashDaPlanta } from "./maquete-lote.js";
import { tokensEstimadosDoTexto } from "./memoria.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { LIBERADAS_ETAPA_7_MAQUETE, funcaoLiberada } from "./permissoes.js";
import { definirDependenciasPonte, executarFuncao, ferramentasDaConversa, ferramentasDoWhatsapp, ferramentasLiberadas } from "./ponte.js";
import { promptSistemaWhatsapp } from "./prompt.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { criarTabelasDaMaquete } from "./testes-maquete.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const SITE = "https://www.prospectaconstrucoes.com";
const PLANTA = "lote4-qd18";
const COD4 = "k3m9x2pq7a";
const COD_DESLIGADO = "abcdefghjk";
const COD_AURORA = "mnpqrstuvw";
const LINK4 = `${SITE}/maquete/vila-esmeralda/qd18-lote4-${COD4}`;
const LEITURAS_MAQUETE = ["consultar_maquete_lote", "listar_maquetes_lotes", "rascunhar_mensagem_lote"];

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidosModelo: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let agora: Date;
const segredoAntes = ENV.cookieSecret;
const siteAntes = process.env.PUBLIC_SITE_URL;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const lote = async (id: number) => (await q<{ codigo_link: string | null }>(`SELECT codigo_link FROM maquete_3d_lotes WHERE id = ${id}`))[0];

let seq = 0;
const ts = (t?: string) => Math.floor((agora.getTime() + (t !== undefined && lerConfirmacao(t) ? 1_000 : -5_000)) / 1000);
const aviso = (texto: string) => ({ event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `COM${++seq}` }, message: { conversation: texto }, messageTimestamp: ts(texto) } });
const dono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body: aviso(texto), ip: "203.0.113.9" } as never);
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (...chamadas: Array<[string, unknown]>): RespostaModelo => ({ stop_reason: "tool_use", usage: uso,
  content: chamadas.map(([name, input], i) => ({ type: "tool_use", id: `tu_${name}_${i}_${seq}`, name, input })) });
const texto = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
const enviadas = () => enviar.mock.calls.map(c => c[0] as { numero: string; texto: string });
const ultima = () => enviadas().filter(m => m.numero === DONO).at(-1)?.texto ?? "";
/** Resultado da ferramenta que o modelo recebeu (último tool_result com esse id de ferramenta). */
const resultadoDaFerramenta = (nome: string) => {
  for (const p of [...pedidosModelo].reverse()) for (const m of [...p.mensagens].reverse()) for (const b of m.content as any[]) {
    if (b.type === "tool_result" && String(b.tool_use_id).startsWith(`tu_${nome}_`)) return JSON.parse(b.content);
  }
  return null;
};
/** Uma leitura pela porta, como o laço do WhatsApp do dono a chama. */
const naConversa = (funcao: string, argumentos: Record<string, unknown>, pedidoDoDono: string | null = null) =>
  executarFuncao({ funcao, argumentos }, { canal: "whatsapp", mensagemId: 1, pedidoDoDono });

async function semear() {
  await criarTabelasDaMaquete(banco.pg);
  const hash = hashDaPlanta(PLANTA);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  await banco.pg.exec(`
    INSERT INTO incorporation_studies (name, city) VALUES ('Loteamento Vila Esmeralda', 'Imperatriz');
    INSERT INTO incorporation_units (study_id, code, code_key, kind, status, buyer, sale_price) VALUES
      (1, 'QD 18 LOTE 04', 'QD 18 LOTE 04', 'lote', 'reservada', 'Fulano Comprador da Silva', 254321.77);
    INSERT INTO maquetes_3d (token, titulo, origem, fonte_slug, itens_versao_publicada) VALUES ('tok-planta-1', 'Lote 4 Qd 18', 'fonte', '${PLANTA}', 1);
    INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao, publicada_em)
      VALUES (1, 1, '[]', 0, 1, '${hash}', 'publicada', now());
    INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id, unit_id, codigo_link, empreendimento_nome, quadra, lote_numero, ativo) VALUES
      ('vila-esmeralda', 'qd18-lote4', 1, 1, '${COD4}', 'Vila Esmeralda', '18', '4', true),
      ('vila-esmeralda', 'qd18-lote5', 1, NULL, NULL, 'Vila Esmeralda', '18', '5', true),
      ('vila-esmeralda', 'qd19-lote4', 1, NULL, '${COD_DESLIGADO}', 'Vila Esmeralda', '19', '4', false),
      ('jardim-aurora', 'qd2-lote7', 1, NULL, '${COD_AURORA}', 'Jardim Aurora', '2', '7', true);`);
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  await semear();
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  process.env.PUBLIC_SITE_URL = SITE;
  esquecerUsuarioDolores();
  agora = new Date(AGORA);
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never });
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
  if (siteAntes === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = siteAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo();
  vi.restoreAllMocks();
});

describe("busca tolerante (regras puras)", () => {
  it("lote/quadra em várias formas; o empreendimento pelas palavras; número solto não é adivinhado", () => {
    for (const t of ["lote 4 da quadra 18", "qd18 lt4", "QD 18 LT 04", "Quadra 18, Lote 4", "q18 l4", "o link da maquete 3D do lote 4 da quadra 18"]) {
      expect(lerBuscaDeLote(t), t).toEqual({ quadra: "18", lote: "4", palavras: [] });
    }
    expect(lerBuscaDeLote("Vila Esmeralda")).toEqual({ quadra: null, lote: null, palavras: ["vila", "esmeralda"] });
    expect(lerBuscaDeLote("lote 4 qd 18 vila esmeralda")).toEqual({ quadra: "18", lote: "4", palavras: ["vila", "esmeralda"] });
    expect(lerBuscaDeLote("18 4")).toEqual({ quadra: null, lote: null, palavras: [] });
  });

  it("origem do link: só a URL pública do sistema (https, só o host); sem ela, nenhum link", () => {
    expect(origemPublica("https://www.prospectaconstrucoes.com/")).toBe(SITE);
    expect(origemPublica("http://www.ProspectaConstrucoes.com:8080/x")).toBe(SITE);
    expect(origemPublica("")).toBeNull();
    expect(origemPublica(undefined)).toBeNull();
    expect(origemPublica("javascript:alert(1)")).toBeNull();
    expect(linkDoLote(null, "vila-esmeralda", "qd18-lote4", COD4)).toBeNull();
    expect(linkDoLote(SITE, "vila-esmeralda", "qd18-lote4", "CURTO")).toBeNull();
    expect(linkDoLote(SITE, "Vila Esmeralda", "qd18-lote4", COD4)).toBeNull();
    expect(linkDoLote(SITE, "vila-esmeralda", "qd18-lote4", COD4)).toBe(LINK4);
  });
});

describe("consultar_maquete_lote", () => {
  it("acha o lote por variações do texto; link completo e status (só leitura de incorporation_units); nada de comprador nem preço", async () => {
    for (const busca of ["lote 4 da quadra 18", "qd18 lt4", "Quadra 18 Lote 04", "lote 4 quadra 18 Vila Esmeralda"]) {
      const r = await naConversa("consultar_maquete_lote", { busca });
      expect(r.status, busca).toBe(200);
      const d = r.body.dados as any;
      expect(d.encontrados, busca).toBe(1);
      expect(d.lote).toMatchObject({ loteId: 1, lote: "Lote 4, Quadra 18 (Vila Esmeralda)", paginaAbre: true, link: LINK4, motivo: null, status: "reservado" });
      const json = JSON.stringify(r.body);
      expect(json).not.toMatch(/Fulano|Comprador|254321|buyer|sale_price|preco|preço/i);
    }
    // o link é o mesmo que a página pública abre
    await expect(lotePublico("vila-esmeralda", `qd18-lote4-${COD4}`)).resolves.toMatchObject({ status: "reservado" });
  });

  it("vários resultados → lista curta para escolher; nenhum → aviso", async () => {
    const r = (await naConversa("consultar_maquete_lote", { busca: "Vila Esmeralda" })).body.dados as any;
    expect(r.encontrados).toBe(3);
    expect(r.escolha.map((x: any) => x.lote)).toEqual(["Lote 4, Quadra 18 (Vila Esmeralda)", "Lote 5, Quadra 18 (Vila Esmeralda)", "Lote 4, Quadra 19 (Vila Esmeralda)"]);
    expect(JSON.stringify(r)).not.toContain("/maquete/");
    expect(((await naConversa("consultar_maquete_lote", { busca: "lote 4" })).body.dados as any).encontrados).toBe(2);
    const nada = (await naConversa("consultar_maquete_lote", { busca: "Vila Rubi lote 9" })).body.dados as any;
    expect(nada).toMatchObject({ encontrados: 0, lotesComMaquete: 4 });
  });

  it("link só quando a página abre; senão, o motivo em palavras simples (sem link, desligada, sem publicação, planta anterior, sem endereço)", async () => {
    const um = async (busca: string) => ((await naConversa("consultar_maquete_lote", { busca })).body.dados as any).lote;
    expect(await um("lote 5 quadra 18")).toMatchObject({ paginaAbre: false, link: null, motivo: expect.stringMatching(/ainda não tem link/), status: expect.stringMatching(/sem status/) });
    expect(await um("qd19 lt4")).toMatchObject({ paginaAbre: false, link: null, motivo: expect.stringMatching(/desligada/) });
    // a versão fixada no lote do Jardim Aurora foi salva para uma planta anterior
    await banco.pg.exec(`INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao, publicada_em)
      VALUES (1, 2, '[]', 0, 1, '${"0".repeat(64)}', 'publicada', now()); UPDATE maquete_3d_lotes SET itens_versao = 2 WHERE id = 4;`);
    expect(await um("Jardim Aurora")).toMatchObject({ paginaAbre: false, link: null, motivo: expect.stringMatching(/planta anterior/), status: expect.stringMatching(/sem status/) });
    await expect(lotePublico("jardim-aurora", `qd2-lote7-${COD_AURORA}`)).rejects.toThrow(); // a página de fato não abre
    // rascunho (versão não publicada) nunca vale
    await banco.pg.exec(`INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao) VALUES (1, 3, '[]', 0, 1, '${hashDaPlanta(PLANTA)}', 'rascunho');
      UPDATE maquete_3d_lotes SET itens_versao = 3 WHERE id = 4;`);
    expect(await um("Jardim Aurora")).toMatchObject({ paginaAbre: false, link: null, motivo: expect.stringMatching(/não foi publicada/) });
    // maquete sem nenhuma versão publicada
    await banco.pg.exec(`UPDATE maquetes_3d SET itens_versao_publicada = NULL`);
    expect(await um("lote 4 da quadra 18")).toMatchObject({ paginaAbre: false, link: null, motivo: expect.stringMatching(/nenhuma versão publicada/), status: "reservado" });
    // sem a URL pública do sistema: nenhum domínio inventado
    await banco.pg.exec(`UPDATE maquetes_3d SET itens_versao_publicada = 1`);
    delete process.env.PUBLIC_SITE_URL;
    expect(await um("lote 4 da quadra 18")).toMatchObject({ paginaAbre: true, link: null, motivo: expect.stringMatching(/endereço público do sistema não está configurado/) });
  });

  it("o link chega ao dono intacto pelos filtros de saída do WhatsApp (link permitido, sem dado sensível)", () => {
    const frase = `Link da maquete 3D do Lote 4, Quadra 18 (Vila Esmeralda): ${LINK4}`;
    expect(sanitizarTexto(tratarLinksDaResposta(frase, SITE), filtroDaSaida("whatsapp"))).toBe(frase);
  });
});

describe("listar_maquetes_lotes", () => {
  it("empreendimento, quadra, lote, status, se tem link e se abre — sem o link em si", async () => {
    const r = (await naConversa("listar_maquetes_lotes", {})).body.dados as any;
    expect(r.total).toBe(4);
    expect(r.comPaginaAberta).toBe(2);
    expect(r.lotes.map((l: any) => [l.lote, l.status, l.temLink, l.paginaAbre])).toEqual([
      ["Lote 7, Quadra 2 (Jardim Aurora)", expect.stringMatching(/sem status/), true, true],
      ["Lote 4, Quadra 18 (Vila Esmeralda)", "reservado", true, true],
      ["Lote 5, Quadra 18 (Vila Esmeralda)", expect.stringMatching(/sem status/), false, false],
      ["Lote 4, Quadra 19 (Vila Esmeralda)", expect.stringMatching(/sem status/), false, false],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/\/maquete\/|k3m9x2pq7a|Fulano|254321/);
    expect(((await naConversa("listar_maquetes_lotes", { busca: "Jardim Aurora" })).body.dados as any).total).toBe(1);
  });
});

describe("rascunhar_mensagem_lote — só texto ao dono, nada enviado", () => {
  it("o rascunho tem o link intacto e nenhum preço; passa pelos filtros de saída sem mudar", async () => {
    const r = await naConversa("rascunhar_mensagem_lote", { loteId: 1 });
    const d = r.body.dados as any;
    expect(d.rascunho).toContain(LINK4);
    expect(d.rascunho).toContain("Lote 4, Quadra 18 (Vila Esmeralda)");
    expect(d.rascunho).not.toMatch(/R\$|valor|preço|reais|\d{2,}\.\d{3}/i);
    expect(sanitizarTexto(tratarLinksDaResposta(d.paraODono.texto, SITE), filtroDaSaida("whatsapp"))).toBe(d.paraODono.texto);
    expect(d.paraODono.texto).toMatch(/Atenção: no sistema este lote está reservado/);
    // tom formal: o mesmo link
    expect(((await naConversa("rascunhar_mensagem_lote", { loteId: 1, tom: "formal" })).body.dados as any).rascunho).toMatch(new RegExp(`Segue a maquete 3D[\\s\\S]*${LINK4.replace(/[./]/g, "\\$&")}`));
    // auditoria: registrado que um rascunho foi gerado (sem o texto, sem o link)
    const [a] = await q<any>(`SELECT * FROM dolores_acoes WHERE funcao = 'rascunhar_mensagem_lote' ORDER BY id LIMIT 1`);
    expect(a).toMatchObject({ resultado: "ok" });
    expect(a.resumo).toMatchObject({ rascunho: "gerado", comValor: false, comNome: false });
    expect(JSON.stringify(await q("SELECT * FROM dolores_acoes"))).not.toContain(COD4);
  });

  it("valor e nome só entram quando o dono os disse nesta mensagem", async () => {
    const pedido = "faz o texto do lote 4 da quadra 18 para o João, valor R$ 120.000,00";
    const ok = (await naConversa("rascunhar_mensagem_lote", { loteId: 1, nome: "João", valor: "R$ 120.000,00" }, pedido)).body.dados as any;
    expect(ok.rascunho).toMatch(/^Olá, João!/);
    expect(ok.rascunho).toContain("Valor: R$ 120.000,00.");
    expect(ok.rascunho).toContain(LINK4);
    // não dito → recusado (nada de preço tirado de outro lugar)
    expect(((await naConversa("rascunhar_mensagem_lote", { loteId: 1, valor: "R$ 99.000,00" }, pedido)).body.dados as any).recusado).toMatch(/valor só entra/);
    expect(((await naConversa("rascunhar_mensagem_lote", { loteId: 1, valor: "R$ 120.000,00" }, null)).body.dados as any).recusado).toMatch(/valor só entra/);
    expect(((await naConversa("rascunhar_mensagem_lote", { loteId: 1, nome: "Maria" }, pedido)).body.dados as any).recusado).toMatch(/nome do cliente/);
    // nome do cliente é dado pessoal: na auditoria só o resumo (hash), nunca o nome
    expect(JSON.stringify(await q("SELECT argumentos, resumo, motivo FROM dolores_acoes"))).not.toContain("João");
  });

  it("lote cuja página não abre: sem rascunho, com o motivo", async () => {
    expect(((await naConversa("rascunhar_mensagem_lote", { loteId: 2 })).body.dados as any).semRascunho).toMatch(/ainda não tem link/);
    expect(rascunhoDoLote({ empreendimento: "X", quadra: "1", lote: "2", link: "https://a/b" })).not.toMatch(/R\$/);
  });
});

describe("pela conversa do dono (webhook de verdade, modelo falso)", () => {
  it("\"me manda o link…\": consulta só de leitura, o link chega intacto ao dono e nada vai a terceiro", async () => {
    roteiro.push(() => ferramenta(["consultar_maquete_lote", { busca: "lote 4 da quadra 18" }]), () => texto("O Lote 4 da Quadra 18 está reservado; o link está logo abaixo."));
    expect(await dono("me manda o link da maquete do lote 4 da quadra 18")).toMatchObject({ status: 200, body: { r: { respondida: 1 } } });
    expect(ultima()).toContain(LINK4);
    expect(ultima()).toMatch(/reservado/);
    expect(enviadas().every(m => m.numero === DONO)).toBe(true);
    // sem verbo de ação: as ferramentas são só de leitura (com as da maquete), sem gerar link
    const nomes = pedidosModelo[0].ferramentas.map(f => f.name);
    expect(nomes).toEqual(expect.arrayContaining(LEITURAS_MAQUETE));
    expect(nomes).not.toContain("gerar_link_maquete_lote");
    expect(await q("SELECT * FROM dolores_aprovacoes")).toEqual([]);
  });

  it("o modelo repetiu o link certo → não duplica; repetiu errado → o certo vai no quadro do sistema", async () => {
    roteiro.push(() => ferramenta(["consultar_maquete_lote", { busca: "qd18 lt4" }]), () => texto(`Segue: ${LINK4}`));
    await dono("qual o link da maquete do qd18 lt4?");
    expect(ultima().split(LINK4).length - 1).toBe(1);
    roteiro.push(() => ferramenta(["consultar_maquete_lote", { busca: "qd18 lt4" }]), () => texto(`Segue: ${SITE}/maquete/vila-esmeralda/qd18-lote4-xxxxxxxxxx`));
    await dono("de novo, o link do qd18 lt4");
    expect(ultima()).toContain(`Link da maquete 3D do Lote 4, Quadra 18 (Vila Esmeralda): ${LINK4}`);
  });

  it("rascunho: o texto pronto vai ao DONO (quadro do sistema), com o link intacto e sem preço; nenhuma mensagem a terceiro", async () => {
    const mensagensAntes = (await q("SELECT count(*)::int AS n FROM whatsapp_messages"))[0];
    roteiro.push(() => ferramenta(["consultar_maquete_lote", { busca: "lote 4 da quadra 18" }]), () => ferramenta(["rascunhar_mensagem_lote", { loteId: 1 }]),
      () => texto("O texto para o cliente está pronto logo abaixo."));
    await dono("faz um texto pro cliente com a maquete do lote 4 da quadra 18");
    const r = ultima();
    expect(r).toContain(TITULO_RASCUNHO);
    expect(r).toContain(resultadoDaFerramenta("rascunhar_mensagem_lote").dados.rascunho);
    expect(r).toContain(LINK4);
    expect(r).not.toMatch(/R\$/);
    expect(enviadas().length).toBeGreaterThan(0);
    expect(enviadas().every(m => m.numero === DONO)).toBe(true);
    expect((await q("SELECT count(*)::int AS n FROM whatsapp_messages"))[0]).toEqual(mensagensAntes);
    expect(await q("SELECT * FROM dolores_aprovacoes")).toEqual([]); // não precisa de "pode": não grava nem envia
  });

  it("gerar o link de um lote sem link: o sistema pergunta \"pode\"; com o \"pode\", gera (mesma regra do painel) e devolve o link", async () => {
    roteiro.push(() => ferramenta(["gerar_link_maquete_lote", { loteId: 2 }]), () => texto("Vou gerar o link da maquete do Lote 5."));
    await dono("gera o link da maquete do lote 5 da quadra 18");
    expect(ultima()).toMatch(/Posso fazer isto\?[\s\S]*gerar o link da maquete 3D do Lote 5, Quadra 18 \(Vila Esmeralda\)/);
    expect((await lote(2)).codigo_link).toBeNull();
    await dono("pode");
    const codigo = (await lote(2)).codigo_link!;
    expect(codigo).toMatch(CODIGO_RE);
    expect(codigo).toHaveLength(10);
    expect(ultima()).toContain(`Pronto: gerei o link da maquete 3D do Lote 5, Quadra 18 (Vila Esmeralda): ${SITE}/maquete/vila-esmeralda/qd18-lote5-${codigo}`);
    expect(await q("SELECT tabela, registro_id, funcao FROM dolores_autoria")).toEqual([{ tabela: "maquete_3d_lotes", registro_id: 2, funcao: "gerar_link_maquete_lote" }]);
    expect(JSON.stringify(await q("SELECT argumentos, resumo, motivo FROM dolores_acoes"))).not.toContain(codigo);
    // "pode" de novo: nada a repetir (não gera outro)
    await dono("pode");
    expect((await lote(2)).codigo_link).toBe(codigo);
  });

  it("trocar um link que já existe é sério: \"pode\" não troca; \"confirmo\" troca e o link antigo deixa de abrir", async () => {
    roteiro.push(() => ferramenta(["gerar_link_maquete_lote", { loteId: 1 }]), () => texto("Vou gerar um link novo."));
    await dono("gera um link novo da maquete do lote 4 da quadra 18");
    expect(ultima()).toMatch(/confirmação por escrito[\s\S]*troca o link da maquete[\s\S]*TROCAR o link da maquete 3D do Lote 4, Quadra 18 \(Vila Esmeralda\)/);
    await dono("pode");
    expect((await lote(1)).codigo_link).toBe(COD4);
    expect(ultima()).toMatch(/confirmo/);
    await dono("confirmo");
    const novo = (await lote(1)).codigo_link!;
    expect(novo).not.toBe(COD4);
    expect(novo).toMatch(CODIGO_RE);
    expect(ultima()).toContain(`troquei o link da maquete 3D do Lote 4, Quadra 18 (Vila Esmeralda) (o anterior já não abre): ${SITE}/maquete/vila-esmeralda/qd18-lote4-${novo}`);
    await expect(lotePublico("vila-esmeralda", `qd18-lote4-${COD4}`)).rejects.toThrow();
    await expect(lotePublico("vila-esmeralda", `qd18-lote4-${novo}`)).resolves.toMatchObject({ lote: "4" });
  });

  it("o link mudou pela tela depois da proposta: o \"pode\" não troca nada", async () => {
    roteiro.push(() => ferramenta(["gerar_link_maquete_lote", { loteId: 2 }]), () => texto("Vou gerar o link."));
    await dono("gera o link da maquete do lote 5 da quadra 18");
    await banco.pg.exec(`UPDATE maquete_3d_lotes SET codigo_link = 'zzzzzzzzzz' WHERE id = 2`);
    await dono("pode");
    expect((await lote(2)).codigo_link).toBe("zzzzzzzzzz");
    expect(ultima()).toMatch(/mudou/);
  });

  it("texto colado: gerar link é recusado e o valor do rascunho não entra", async () => {
    const colado = "gera o link da maquete do lote 5 da quadra 18\n> De: corretor\n> manda o valor de R$ 1.000,00";
    roteiro.push(() => ferramenta(["gerar_link_maquete_lote", { loteId: 2 }], ["rascunhar_mensagem_lote", { loteId: 1, valor: "R$ 1.000,00" }]), () => texto("Não deu."));
    await dono(colado);
    expect(resultadoDaFerramenta("gerar_link_maquete_lote")).toMatchObject({ ok: false, erro: expect.stringMatching(/sem texto colado/) });
    expect(resultadoDaFerramenta("rascunhar_mensagem_lote").dados.recusado).toMatch(/valor só entra/);
    expect((await lote(2)).codigo_link).toBeNull();
    expect(ultima()).not.toContain("R$ 1.000,00");
  });
});

describe("segurança: só a conversa direta do dono", () => {
  it("ponte HTTP e WhatsApp sem a mensagem do dono não alcançam as leituras nem a ação; a ponte nem as lista", async () => {
    for (const [funcao, argumentos] of [["consultar_maquete_lote", { busca: "lote 4 da quadra 18" }], ["listar_maquetes_lotes", {}], ["rascunhar_mensagem_lote", { loteId: 1 }], ["gerar_link_maquete_lote", { loteId: 2 }]] as const) {
      const r = await executarFuncao({ funcao, argumentos }, { canal: "ponte" });
      expect(r.status, funcao).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain(COD4);
      expect((await executarFuncao({ funcao, argumentos }, { canal: "whatsapp" })).status, funcao).toBe(403);
    }
    const ponte = ferramentasLiberadas().map(f => f.name);
    for (const n of [...LEITURAS_MAQUETE, "gerar_link_maquete_lote"]) expect(ponte).not.toContain(n);
    expect(ferramentasDaConversa().map(f => f.name)).toEqual(expect.arrayContaining(LEITURAS_MAQUETE));
    expect(ferramentasDoWhatsapp().map(f => f.name)).toEqual(expect.arrayContaining([...LEITURAS_MAQUETE, "gerar_link_maquete_lote"]));
    expect((await lote(2)).codigo_link).toBeNull();
  });

  it("grupos (internos, de cliente, de parceiros) e o atendimento ao cliente não têm as leituras da maquete", async () => {
    for (const [tipo, lista] of Object.entries(LEITURAS_INTERNAS)) for (const n of LEITURAS_MAQUETE) expect(lista, tipo).not.toContain(n);
    for (const n of LEITURAS_MAQUETE) {
      expect(LEITURAS_DO_GRUPO.map(f => f.nome)).not.toContain(n);
      expect(LEITURAS_DO_PARCEIRO.map(f => f.nome)).not.toContain(n);
      expect(ferramentasDoCliente().map(f => f.name)).not.toContain(n);
      const r = await executarLeituraInterna("administrativo", n, { busca: "lote 4 da quadra 18", loteId: 1 }, { agora, grupoId: 1, marcacaoId: 1, autor: null });
      expect(r.ok, n).toBe(false);
      expect(JSON.stringify(r.corpo)).not.toContain(COD4);
      // segunda trava: chamada direta com o canal do grupo ou do cliente é recusada pela própria leitura
      for (const canal of ["grupo", "cliente", "ponte"] as const) {
        const d = await funcaoPorNome(n)!.executar({ busca: "lote 4 da quadra 18", loteId: 1, tom: "proximo", limite: 20 } as never, { agora, canal });
        expect((d.dados as any).recusado, `${n} ${canal}`).toBeTruthy();
        expect(JSON.stringify(d)).not.toContain(COD4);
      }
    }
  });
});

describe("registro, níveis e piso da reserva", () => {
  it("leituras novas: só leitura, liberadas, contaminam e são só da conversa do dono; gerar link é de fila; rascunho nunca vai à fila", () => {
    expect([...LIBERADAS_ETAPA_7_MAQUETE].every(n => funcaoLiberada(n))).toBe(true);
    for (const n of LEITURAS_MAQUETE) expect(FUNCOES.find(f => f.nome === n)).toMatchObject({ tipo: "leitura", contamina: true, soConversaDoDono: true });
    expect(ACOES.find(a => a.nome === "rascunhar_mensagem_lote")).toBeUndefined();
    expect(ACOES.find(a => a.nome === "gerar_link_maquete_lote")).toMatchObject({ nivel: "fila", contamina: true });
    expect(nivelDoItem("gerar_link_maquete_lote", { loteId: 2, troca: false, antes: null })).toBe("registro");
    expect(nivelDoItem("gerar_link_maquete_lote", { loteId: 1, troca: true, antes: "0123456789abcdef" })).toBe("serio");
    expect(nivelDoItem("gerar_link_maquete_lote", {})).toBe("serio");
    expect(nivelDoItem("gerar_link_maquete_lote", { troca: "false" })).toBe("serio");
    expect(exigeConfirmoNoCodigo("gerar_link_maquete_lote", { troca: true })).toBe(true);
    expect(exigeConfirmoNoCodigo("gerar_link_maquete_lote", { troca: false })).toBe(false);
    for (const t of ["gera o link da maquete do lote 5", "troca o link do lote 4", "regenera o link da maquete"]) expect(intencaoDeAcao(t), t).toBe(true);
    expect(intencaoDeAcao("me manda o link da maquete do lote 4")).toBe(false);
  });

  it("o prompt fala da maquete sem nome de ferramenta; o piso cobre o prefixo fixo com as ferramentas novas", () => {
    const p = promptSistemaWhatsapp(false);
    expect(p).toMatch(/Maquete 3D por lote/);
    for (const n of [...LEITURAS_MAQUETE, "gerar_link_maquete_lote"]) expect(p).not.toContain(n);
    const prefixo = tokensEstimadosDoTexto(p) + tokensEstimadosDoTexto(JSON.stringify(ferramentasParaOModelo(ferramentasDoWhatsapp())));
    expect(RESERVA_MINIMA_ENTRADA).toBeGreaterThanOrEqual(prefixo + SOBRECARGA_DE_FERRAMENTAS);
    console.info(`[C5-COM] prefixo fixo estimado: ${prefixo} + ${SOBRECARGA_DE_FERRAMENTAS} ≤ ${RESERVA_MINIMA_ENTRADA}`);
  });
});
