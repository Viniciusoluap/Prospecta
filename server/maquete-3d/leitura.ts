// Maquete 3D (EPIC-022) — motor de leitura: transforma os PDFs do projeto no modelo em três camadas
// (shared/maquete-3d/modelo.ts). A leitura é feita em passos curtos, um por chamada, para caber no limite de
// tempo da função; o estado fica gravado em maquetes_3d.leitura e qualquer passo pode ser repetido.
//   inventário → para cada pavimento: estrutura (paredes e aberturas) e ambientes (cômodos e escadas)
//              → implantação (quando houver prancha) → montagem (sem IA: junta, valida e grava o modelo).
// Regra do dono: a geometria do projeto não é inventada. O que a prancha não traz vira "estimada" ou pendência,
// e a pessoa confirma na revisão antes de publicar.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import {
  FUNCOES_COMODO, TIPOS_ABERTURA, areaPoligono, TIPOS_COBERTURA, TIPOS_ESCADA, lerModelo, modeloSchema, type Edificacao, type Implantacao,
  type ModeloMaquete, type OrigemMedida, type Pavimento, type TipoMaquete,
} from "../../shared/maquete-3d/modelo.js";
import {
  MAX_BYTES_DOCUMENTOS, PODE_LER, TIPOS_PRANCHA, documentoSchema, leituraVazia, lerEstadoLeitura, motorEfetivo, type ConfigMaquete, type DocumentoMaquete,
  type EstadoLeitura, type MotorLeitura, type PassoLeitura, type StatusMaquete,
} from "../../shared/maquete-3d/regras.js";
import { MAX_PAGINAS } from "./pdf-vetorial.js";
import { jpegDaPagina, pdfDaPagina, pdfDeUmJpeg } from "./pdf-pagina.js";
import { lerPagina, nomeDoPavimento, type Diagnostico, type PlantaLida } from "./geometrico.js";
import { guardarAnterior, registrarRevisao } from "./revisoes.js";
import { lerRespostaPrancha } from "./resposta-ia.js";
import {
  ExecucaoConcorrente, LIMITE_RESERVA_MS, MENSAGEM_INTERROMPIDA, PASSOS_IA_ANTIGOS, bloqueioDaIA, devolverReserva, execucaoDe, gravarSeIgual, naoCobrado, naoCobradoNoEnvio, novaConfirmacao, modeloDaConfirmacao, UNIDADE_MOTOR_IA,
  exigirSemPassoEmCurso, gravarSobreOAtual, prazoDaIA, pularPassosIA, semTempoParaIA, reservaVencida, reservarChamada, type Execucao,
} from "./execucao-ia.js";
import {
  LeituraIndisponivel, LoteDeOutroPedido, agora, carregarConfig, db, dependencias, erroSeguro, idDoPedidoNoLote, interpretarMensagem, modeloDaLeitura, tipoDoErroIA,
  type AnexoIA, type PdfLido, alvoDoDocumento,
} from "./base.js";

// ── Esquemas da resposta da IA (JSON Schema, saída estruturada) ──

const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });
const texto = { type: "string" }, numero = { type: "number" }, inteiro = { type: "integer" }, logico = { type: "boolean" };
const ou = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
const umDe = (valores: readonly string[]) => ({ type: "string", enum: [...valores] });
const pontoJson = obj({ x: numero, y: numero });
const pendenciasJson = lista(texto);

const ESQUEMA_INVENTARIO = obj({
  pranchas: lista(obj({ doc: inteiro, pagina: inteiro, tipo: umDe(TIPOS_PRANCHA), descricao: texto })),
  edificacoes: lista(obj({
    nome: texto,
    cobertura: obj({ tipo: umDe(TIPOS_COBERTURA), inclinacao: numero, beiral: numero, confirmada: logico }),
    pavimentos: lista(obj({
      nome: texto, nivel: numero, peDireito: numero, peDireitoConfirmado: logico, repeticoes: inteiro, doc: inteiro, pagina: inteiro,
    })),
  })),
  implantacao: ou(obj({ doc: inteiro, pagina: inteiro })),
  pendencias: pendenciasJson,
});

const ESQUEMA_ESTRUTURA = obj({
  paredes: lista(obj({ id: texto, ax: numero, ay: numero, bx: numero, by: numero, espessura: numero, externa: logico, confirmada: logico })),
  aberturas: lista(obj({
    id: texto, paredeId: texto, tipo: umDe(TIPOS_ABERTURA), posicao: numero, largura: numero, altura: numero, peitoril: numero,
    entradaPrincipal: logico, confirmada: logico,
  })),
  pendencias: pendenciasJson,
});

const ESQUEMA_AMBIENTES = obj({
  comodos: lista(obj({ id: texto, nome: texto, funcao: umDe(FUNCOES_COMODO), pontos: lista(pontoJson), areaInformada: ou(numero), confirmada: logico })),
  escadas: lista(obj({
    id: texto, tipo: umDe(TIPOS_ESCADA), pontos: lista(pontoJson), inicio: pontoJson, fim: pontoJson, percurso: lista(pontoJson), largura: numero,
    degraus: ou(inteiro), sobePara: ou(texto), confirmada: logico,
  })),
  pendencias: pendenciasJson,
});

const ESQUEMA_IMPLANTACAO = obj({
  terreno: lista(pontoJson),
  vias: lista(obj({ id: texto, nome: texto, eixo: lista(pontoJson), largura: numero })),
  lotes: lista(obj({ id: texto, nome: texto, quadra: texto, pontos: lista(pontoJson), areaInformada: ou(numero) })),
  posicoes: lista(obj({ id: texto, edificacao: texto, nome: texto, x: numero, y: numero, rotacao: numero })),
  pendencias: pendenciasJson,
});

/** Leitura de UMA prancha pela IA (EPIC-024 S-03): as plantas baixas desenhadas nela, no formato do leitor próprio. */
const ESQUEMA_PRANCHA = obj({
  plantas: lista(obj({
    titulo: texto, escala: numero, escalaLegivel: logico, temCotas: logico,
    paredes: ESQUEMA_ESTRUTURA.properties.paredes, aberturas: ESQUEMA_ESTRUTURA.properties.aberturas,
    comodos: ESQUEMA_AMBIENTES.properties.comodos,
    escadas: lista(obj({ id: texto, tipo: umDe(TIPOS_ESCADA), pontos: lista(pontoJson), inicio: pontoJson, fim: pontoJson, percurso: lista(pontoJson), largura: numero, degraus: ou(inteiro), confirmada: logico })),
    pendencias: pendenciasJson,
  })),
  pendencias: pendenciasJson,
});

// ── Instruções ──

const SISTEMA = `Você lê projetos de arquitetura (plantas baixas, cortes, fachadas e implantações em PDF) e devolve a geometria em dados estruturados, para gerar uma maquete 3D fiel ao projeto.

Regras que valem para toda resposta:
- Preserve rigorosamente a geometria do projeto. Não invente ambientes, paredes, aberturas ou medidas.
- Todas as medidas em metros, com duas casas decimais. Converta cotas em centímetros ou milímetros.
- Use as cotas escritas na prancha. Só quando não houver cota, estime pela escala do desenho e marque "confirmada": false. Medida tirada de cota escrita: "confirmada": true.
- Sistema de coordenadas da planta: x cresce para a direita e y cresce para baixo, como no desenho. A origem (0, 0) é o canto superior esquerdo do retângulo que envolve as paredes externas do pavimento térreo. Todos os pavimentos da mesma edificação usam essa mesma origem, para que escadas e paredes fiquem alinhadas entre os andares.
- Quando faltar um dado essencial (uma medida ilegível, um pé-direito sem corte, um ambiente sem nome), não assuma em silêncio: escreva uma frase curta em "pendencias" dizendo o que precisa ser confirmado.
- Ignore carimbo, legendas, notas, quadros de esquadrias e mobiliário desenhado.`;

const PEDIDO_INVENTARIO = (tipo: TipoMaquete, nomes: string[]) => `Arquivos enviados, na ordem (doc começa em 0): ${nomes.map((n, i) => `${i} = "${n}"`).join("; ")}.
Tipo de maquete pedido: ${tipo}.

Faça o inventário do projeto:
1. "pranchas": cada página de cada arquivo, com o tipo (planta_baixa, corte, fachada, implantacao, cobertura, outro) e uma descrição curta. "pagina" começa em 1.
2. "edificacoes": cada construção diferente do projeto (em casa, uma só; em condomínio, cada tipologia de casa ou bloco; em prédio, o bloco). Para cada uma, os pavimentos de baixo para cima, com:
   - "nivel": cota do piso acabado em relação ao térreo (térreo = 0);
   - "peDireito": altura do piso ao teto, lida dos cortes; sem corte, use 2.70 e marque "peDireitoConfirmado": false;
   - "repeticoes": 1, ou o número de andares iguais quando a prancha é de pavimento-tipo;
   - "doc" e "pagina" da planta baixa daquele pavimento.
   E a cobertura: tipo, inclinação em % e beiral em metros ("confirmada" só se estiver no projeto).
3. "implantacao": a página da planta de implantação ou de situação com lotes/vias, ou null se não houver.
4. "pendencias": o que falta no projeto para montar a maquete (por exemplo: "Não há corte: pé-direito não confirmado").
Não inclua em "edificacoes" pavimento que não tenha planta baixa nos arquivos.`;

const PEDIDO_ESTRUTURA = (e: string, p: string, doc: number, pagina: number) => `Leia a planta baixa do pavimento "${p}" da edificação "${e}", que está no arquivo ${doc}, página ${pagina}.

Devolva só a estrutura deste pavimento:
- "paredes": cada trecho reto de parede como um segmento pelo eixo da parede, de (ax, ay) a (bx, by), com a espessura. Uma parede contínua é um segmento só; quebre apenas onde ela muda de direção ou de espessura. "externa": true para as paredes do contorno da construção. Use ids curtos: p1, p2, ...
- "aberturas": portas, janelas, portas-janela e vãos sem esquadria. "paredeId" é a parede onde está; "posicao" é a distância, ao longo da parede, do ponto (ax, ay) até o centro da abertura; "largura" é o vão. "altura" e "peitoril" vêm do quadro de esquadrias ou das cotas (porta sem informação: altura 2.10 e peitoril 0; janela sem informação: altura 1.20 e peitoril 1.00, com "confirmada": false). "entradaPrincipal": true só na porta de entrada principal. Ids: a1, a2, ...
- Muros de divisa, gradis e projeções de beiral não são paredes.`;

const PEDIDO_AMBIENTES = (e: string, p: string, doc: number, pagina: number, paredes: string, pavimentos: string[]) => `Leia a planta baixa do pavimento "${p}" da edificação "${e}", que está no arquivo ${doc}, página ${pagina}.

As paredes deste pavimento já foram lidas, nestas coordenadas (JSON): ${paredes}

Devolva os ambientes deste pavimento, nas mesmas coordenadas:
- "comodos": cada ambiente com o nome escrito na prancha, a função, e o contorno em "pontos" (vértices em ordem, pela face interna das paredes, sem repetir o primeiro ponto). "areaInformada": a área em m² escrita na prancha, ou null. Inclua varandas, garagem e circulações. Ids: c1, c2, ...
- "escadas": cada escada ou rampa, com o contorno em "pontos", o tipo exato (reta, em_l, em_u, caracol ou rampa), o ponto "inicio" (onde se pisa neste pavimento) e "fim" (onde chega no pavimento de cima), o "percurso" (o eixo do caminho que a pessoa percorre, do início ao fim, com um ponto em cada mudança de direção: escada reta tem só os dois pontos; em L tem três, com a quina do patamar; em U tem quatro, com os dois cantos do patamar; caracol: deixe vazio), a largura do lance, o número de degraus se estiver indicado, e "sobePara" com o nome exato do pavimento de destino entre: ${pavimentos.map(n => `"${n}"`).join(", ") || "(nenhum outro pavimento)"}. Registre a escada só no pavimento de onde ela parte para cima. Ids: e1, e2, ...`;

const PEDIDO_IMPLANTACAO = (doc: number, pagina: number, edificacoes: string[]) => `Leia a planta de implantação que está no arquivo ${doc}, página ${pagina}.

Use um sistema próprio: origem (0, 0) no canto superior esquerdo do retângulo que envolve o terreno, x para a direita, y para baixo, em metros.
- "terreno": contorno do terreno.
- "vias": cada rua interna, com o eixo (sequência de pontos) e a largura da caixa.
- "lotes": cada lote com nome/número, quadra, contorno e área escrita (ou null). Ids: l1, l2, ...
- "posicoes": cada construção desenhada no terreno: "edificacao" é o nome exato de uma destas: ${edificacoes.map(n => `"${n}"`).join(", ") || "(nenhuma)"}; "x" e "y" são a posição do canto superior esquerdo da construção; "rotacao" em graus, sentido horário. Ids: i1, i2, ...
Se a prancha tiver lotes demais para listar com segurança, liste os que conseguir ler com precisão e registre o restante em "pendencias".`;

const PEDIDO_PRANCHA = (nome: string, pagina: number, envio: EnvioIA, imagem: boolean) => `${envio === "pdf_original"
  ? `O arquivo "${nome}" foi enviado inteiro. Leia SOMENTE a página ${pagina} e ignore todas as outras páginas.`
  : `Esta é a página ${pagina} do arquivo "${nome}".`}
${imagem ? "A prancha é uma imagem (escaneada, fotografada ou convertida): não há linhas nem texto selecionável; leia as cotas, os nomes e os títulos no próprio desenho.\n" : ""}
Devolva em "plantas" cada planta baixa de pavimento desenhada nesta prancha. Não inclua cortes, fachadas, implantação, situação, cobertura, detalhes, quadros nem carimbo. Para cada planta:
- "titulo": o título escrito junto do desenho (por exemplo "PLANTA BAIXA - TÉRREO"), ou "" se não houver.
- "escala": o número da escala escrita (50 para 1:50) e "escalaLegivel": true só se ela estiver escrita e legível; sem escala legível, escala 0 e false.
- "temCotas": true só se houver cotas (medidas) escritas e legíveis no desenho.
- Coordenadas em metros, com origem no canto superior esquerdo do retângulo que envolve as paredes externas DESTA planta, x para a direita e y para baixo.
- "paredes" (segmentos pelo eixo, com espessura; "externa" no contorno; ids p1, p2…), "aberturas" (na parede "paredeId", "posicao" a partir do ponto a; porta sem informação: altura 2.10 e peitoril 0; janela: 1.20 e 1.00; ids a1, a2…), "comodos" (nome escrito, função, contorno pela face interna, área escrita ou null; ids c1, c2…) e "escadas" (contorno, início, fim, percurso, largura, degraus; ids e1, e2…).
- "confirmada": true SOMENTE quando a medida daquele elemento está escrita na prancha (cota legível). Medida tirada da proporção do desenho, da escala ou estimada é sempre false.
- "pendencias": frases curtas com o que não dá para ler com segurança (cota ilegível, cômodo sem nome, trecho cortado da imagem).
Se a prancha não tiver planta baixa de pavimento, devolva "plantas" vazio e diga o motivo em "pendencias".`;

// ── Estado ──

type Inventario = {
  edificacoes: { nome: string; cobertura: { tipo: string; inclinacao: number; beiral: number; confirmada: boolean }; pavimentos: { nome: string; nivel: number; peDireito: number; peDireitoConfirmado: boolean; repeticoes: number; doc: number; pagina: number }[] }[];
  implantacao: { doc: number; pagina: number } | null;
  pendencias: string[];
};
type Estrutura = { paredes: { id: string; ax: number; ay: number; bx: number; by: number; espessura: number; externa: boolean; confirmada: boolean }[]; aberturas: Record<string, unknown>[]; pendencias: string[] };
type Ambientes = { comodos: { id: string; nome: string; funcao: string; pontos: { x: number; y: number }[]; areaInformada: number | null; confirmada: boolean }[]; escadas: Record<string, unknown>[]; pendencias: string[] };
type ImplantacaoLida = { terreno: unknown[]; vias: unknown[]; lotes: Record<string, unknown>[]; posicoes: Record<string, unknown>[]; pendencias: string[] };

const origemDe = (confirmada: unknown): OrigemMedida => (confirmada === true ? "confirmada" : "estimada");
const limitar = (n: unknown, min: number, max: number, padrao: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao);
const idEdificacao = (i: number) => `ed${i + 1}`;
const idPavimento = (i: number, j: number) => `ed${i + 1}-pv${j + 1}`;

export const lerDocumentos = (textoJson: string): DocumentoMaquete[] => {
  try { return documentoSchema.array().parse(JSON.parse(textoJson)); } catch { return []; }
};

async function carregarPdfs(m: Maquete3d): Promise<PdfLido[]> {
  const docs = lerDocumentos(m.documentos);
  if (!docs.length) throw new LeituraIndisponivel("Nenhum PDF foi escolhido para esta maquete.");
  const pdfs: PdfLido[] = [];
  let total = 0;
  for (const d of docs) {
    const dados = await dependencias().lerPdf(d, alvoDoDocumento(m, d));
    total += dados.length;
    if (total > MAX_BYTES_DOCUMENTOS) throw new LeituraIndisponivel(`Os PDFs escolhidos somam mais de ${Math.round(MAX_BYTES_DOCUMENTOS / 1048576)} MB. Escolha menos arquivos ou envie versões mais leves.`);
    pdfs.push({ nome: d.nome, base64: dados.toString("base64") });
  }
  return pdfs;
}

/** Passos gerados a partir do inventário: dois por pavimento, implantação se houver prancha, e a montagem. */
export function passosDoInventario(inv: Inventario): PassoLeitura[] {
  const passos: PassoLeitura[] = [];
  inv.edificacoes.forEach((e, i) => e.pavimentos.forEach((p, j) => {
    const ref = { doc: p.doc, pagina: p.pagina, edificacaoId: idEdificacao(i), pavimentoId: idPavimento(i, j) };
    const rotulo = inv.edificacoes.length > 1 ? `${e.nome} › ${p.nome}` : p.nome;
    passos.push({ chave: `estrutura:${ref.pavimentoId}`, tipo: "estrutura", rotulo: `Paredes e aberturas — ${rotulo}`, estado: "pendente", ...ref });
    passos.push({ chave: `ambientes:${ref.pavimentoId}`, tipo: "ambientes", rotulo: `Cômodos e escadas — ${rotulo}`, estado: "pendente", ...ref });
  }));
  if (inv.implantacao) passos.push({ chave: "implantacao", tipo: "implantacao", rotulo: "Implantação (terreno, vias e lotes)", estado: "pendente", doc: inv.implantacao.doc, pagina: inv.implantacao.pagina });
  passos.push({ chave: "montagem", tipo: "montagem", rotulo: "Montagem e conferência do modelo", estado: "pendente" });
  return passos;
}

/** Junta os resultados parciais no modelo final. Sem IA: só conversão, limites e validação. */
export function montarModelo(tipo: TipoMaquete, parciais: Record<string, unknown>): ModeloMaquete {
  const inv = parciais.inventario as Inventario;
  const pendencias: string[] = [...(inv.pendencias ?? [])];
  const edificacoes: Edificacao[] = inv.edificacoes.map((e, i) => {
    const nomes = new Map(e.pavimentos.map((p, j) => [p.nome.trim().toLowerCase(), idPavimento(i, j)]));
    const pavimentos = e.pavimentos.map((p, j): Pavimento => {
      const id = idPavimento(i, j);
      const est = (parciais[`estrutura:${id}`] ?? { paredes: [], aberturas: [], pendencias: [] }) as Estrutura;
      const amb = (parciais[`ambientes:${id}`] ?? { comodos: [], escadas: [], pendencias: [] }) as Ambientes;
      pendencias.push(...[...est.pendencias, ...amb.pendencias].map(t => `${p.nome}: ${t}`));
      return {
        id, nome: p.nome.slice(0, 60) || `Pavimento ${j + 1}`,
        nivel: limitar(p.nivel, -30, 400, 0), peDireito: limitar(p.peDireito, 1.8, 12, 2.7),
        origemPeDireito: origemDe(p.peDireitoConfirmado), repeticoes: Math.round(limitar(p.repeticoes, 1, 100, 1)),
        paredes: est.paredes.map(w => ({
          id: String(w.id), a: { x: w.ax, y: w.ay }, b: { x: w.bx, y: w.by },
          espessura: limitar(w.espessura, 0.03, 1.5, 0.15), externa: w.externa === true, origem: origemDe(w.confirmada),
        })),
        aberturas: est.aberturas.map(a => ({
          id: String(a.id), paredeId: String(a.paredeId), tipo: a.tipo as never, posicao: limitar(a.posicao, 0, 500, 0),
          largura: limitar(a.largura, 0.2, 20, 0.8), altura: limitar(a.altura, 0.2, 10, 2.1), peitoril: limitar(a.peitoril, 0, 5, 0),
          entradaPrincipal: a.entradaPrincipal === true, origem: origemDe(a.confirmada),
        })),
        comodos: amb.comodos.map(c => ({
          id: String(c.id), nome: (c.nome || "Ambiente").slice(0, 80), funcao: c.funcao as never, poligono: c.pontos,
          areaInformada: typeof c.areaInformada === "number" && c.areaInformada > 0 ? c.areaInformada : null, origem: origemDe(c.confirmada),
        })),
        escadas: amb.escadas.map(s => ({
          id: String(s.id), tipo: s.tipo as never, poligono: s.pontos as never, inicio: s.inicio as never, fim: s.fim as never,
          percurso: (Array.isArray(s.percurso) ? s.percurso.slice(0, 60) : []) as never,
          largura: limitar(s.largura, 0.5, 6, 0.9), degraus: typeof s.degraus === "number" ? Math.round(limitar(s.degraus, 0, 80, 0)) : null,
          destinoPavimentoId: (typeof s.sobePara === "string" && nomes.get(s.sobePara.trim().toLowerCase())) || null,
          origem: origemDe(s.confirmada),
        })),
      };
    });
    return {
      id: idEdificacao(i), nome: e.nome.slice(0, 80) || `Edificação ${i + 1}`, pavimentos,
      cobertura: { tipo: e.cobertura.tipo as never, inclinacao: limitar(e.cobertura.inclinacao, 0, 200, 30), beiral: limitar(e.cobertura.beiral, 0, 3, 0.5), origem: origemDe(e.cobertura.confirmada) },
    };
  });

  let implantacao: Implantacao | null = null;
  const imp = parciais.implantacao as ImplantacaoLida | undefined;
  if (imp) {
    const porNome = new Map(inv.edificacoes.map((e, i) => [e.nome.trim().toLowerCase(), idEdificacao(i)]));
    pendencias.push(...imp.pendencias.map(t => `Implantação: ${t}`));
    implantacao = {
      terreno: imp.terreno as never, vias: imp.vias as never, ruas: [], relevo: null,
      lotes: imp.lotes.map(l => ({ id: String(l.id), nome: String(l.nome ?? ""), quadra: String(l.quadra ?? ""), poligono: l.pontos as never, areaInformada: typeof l.areaInformada === "number" && l.areaInformada > 0 ? l.areaInformada : null, tipo: "vendavel" as const, uso: null, unidade: null })),
      posicoes: imp.posicoes.flatMap(p => {
        const edificacaoId = porNome.get(String(p.edificacao ?? "").trim().toLowerCase());
        if (!edificacaoId) { pendencias.push(`Implantação: a construção "${String(p.nome || p.id)}" não corresponde a nenhuma edificação lida.`); return []; }
        return [{ id: String(p.id), edificacaoId, nome: String(p.nome ?? ""), x: Number(p.x) || 0, y: Number(p.y) || 0, rotacao: limitar(p.rotacao, -360, 360, 0), unidade: null }];
      }),
    };
  }

  // Implantação montada a partir do estudo de Incorporação: fica, se os PDFs não trouxerem outra.
  if (!implantacao && parciais.implantacaoDoEstudo) implantacao = parciais.implantacaoDoEstudo as Implantacao;

  return modeloSchema.parse({
    tipo, edificacoes, implantacao,
    pendencias: Array.from(new Set(pendencias.map(t => t.trim()).filter(Boolean))).slice(0, 200).map((descricao, i) => ({ id: `pd${i + 1}`, descricao: descricao.slice(0, 400), resolvida: false })),
  });
}

// ── Leitor geométrico (sem IA): uma prancha por passo, e a montagem junta as plantas em pavimentos ──

export type ArquivoDoPasso = NonNullable<PassoLeitura["arquivo"]>;
export type PranchaLida = { doc: number; pagina: number; arquivo?: ArquivoDoPasso; plantas: PlantaLida[]; diagnostico: Diagnostico & { lidaPor?: "geometrico" | "ia" } };

const identidade = (d: DocumentoMaquete): ArquivoDoPasso => ({ fonte: d.fonte, id: d.id, nome: d.nome });
const mesmoArquivo = (a: { fonte: string; id: number }) => (d: DocumentoMaquete) => d.fonte === a.fonte && d.id === a.id;

/**
 * O PDF de um passo, achado pela identidade (fonte + id) e não pela posição na lista: se a lista foi reordenada, o
 * arquivo certo continua sendo lido; se ele saiu da lista, o passo para com uma mensagem clara (nunca lê outro PDF).
 * Passos antigos, sem a identidade gravada, usam a posição (como antes).
 */
export function documentoDoPasso(m: Pick<Maquete3d, "documentos">, ref: { doc?: number; arquivo?: ArquivoDoPasso | { fonte: string; id: number; nome?: string } }): { d: DocumentoMaquete; indice: number } {
  const docs = lerDocumentos(m.documentos);
  if (ref.arquivo) {
    const indice = docs.findIndex(mesmoArquivo(ref.arquivo));
    if (indice < 0) throw new LeituraIndisponivel(`O PDF "${ref.arquivo.nome ?? "escolhido"}" saiu da lista de PDFs desta maquete depois que a leitura começou. Nada foi lido de outro arquivo: comece a leitura (ou a importação) de novo.`);
    return { d: docs[indice], indice };
  }
  const d = docs[ref.doc ?? -1];
  if (!d) throw new LeituraIndisponivel("Um dos PDFs desta maquete não está mais na lista.");
  return { d, indice: ref.doc! };
}

async function bytesDoDocumento(m: Maquete3d, d: DocumentoMaquete) {
  const dados = await dependencias().lerPdf(d, alvoDoDocumento(m, d));
  if (dados.length > MAX_BYTES_DOCUMENTOS) throw new LeituraIndisponivel(`O arquivo "${d.nome}" passa de ${Math.round(MAX_BYTES_DOCUMENTOS / 1048576)} MB.`);
  return dados;
}

async function abrirDocumento(m: Maquete3d, d: DocumentoMaquete) {
  const dados = await bytesDoDocumento(m, d);
  try { return await dependencias().abrirPdf(dados); }
  catch { throw new LeituraIndisponivel(`Não foi possível abrir "${d.nome}": o arquivo não é um PDF válido ou está protegido por senha.`); }
}

/** Inventário do leitor geométrico: conta as páginas e cria um passo por prancha (`so`: só aquele documento). */
export async function passosDasPranchas(m: Maquete3d, so?: DocumentoMaquete): Promise<PassoLeitura[]> {
  const docs = lerDocumentos(m.documentos), passos: PassoLeitura[] = [];
  if (!docs.length) throw new LeituraIndisponivel("Nenhum PDF foi escolhido para esta maquete.");
  for (let d = 0; d < docs.length; d++) {
    if (so && !mesmoArquivo(so)(docs[d])) continue;
    const pdf = await abrirDocumento(m, docs[d]);
    try {
      for (let p = 1; p <= pdf.paginas && passos.length < MAX_PAGINAS; p++) {
        passos.push({ chave: `prancha:${d}:${p}`, tipo: "prancha", rotulo: `Leitura de ${docs[d].nome}${pdf.paginas > 1 ? ` — página ${p}` : ""}`, estado: "pendente", doc: d, pagina: p, arquivo: identidade(docs[d]) });
      }
    } finally { await pdf.fechar(); }
  }
  return [...passos, { chave: "montagem", tipo: "montagem", rotulo: "Montagem e conferência do modelo", estado: "pendente" }];
}

async function lerPrancha(m: Maquete3d, passo: PassoLeitura): Promise<PranchaLida> {
  const { d, indice } = documentoDoPasso(m, passo);
  const pdf = await abrirDocumento(m, d);
  try { return { doc: indice, pagina: passo.pagina!, arquivo: identidade(d), ...lerPagina(await pdf.pagina(passo.pagina!)) }; }
  finally { await pdf.fechar(); }
}

/**
 * Pranchas lidas, com o índice ATUAL de cada arquivo na lista (achado pela identidade), para a montagem e o fundo
 * da revisão. Arquivo que saiu da lista: a montagem para com mensagem clara (nunca usa a planta de outro PDF).
 */
export function pranchasParaMontagem(m: Pick<Maquete3d, "documentos">, estado: EstadoLeitura): PranchaLida[] {
  return estado.passos.filter(p => p.tipo === "prancha")
    .map(p => estado.parciais[p.chave] as PranchaLida | undefined).filter((p): p is PranchaLida => !!p)
    .map(p => ({ ...p, doc: documentoDoPasso(m, p).indice }));
}

// ── Leitura híbrida (EPIC-024 S-03): leitor próprio primeiro; a IA só nas pranchas que ele não lê ──

export const MOTIVOS_IA = {
  imagem: "a prancha é uma imagem, sem linhas vetoriais para o leitor próprio",
  semPlanta: "a prancha tem título de planta baixa, mas o leitor próprio não reconheceu nenhuma planta",
  parcial: "a leitura própria ficou parcial (passou do tempo ou do limite de quantidade)",
  semNomes: "o leitor próprio não reconheceu nenhum cômodo com nome",
  sempre: "configuração: leitura sempre pela IA",
} as const;

/**
 * Critérios objetivos para mandar uma prancha à IA. Nunca quando a leitura própria é boa (alguma planta inteira com
 * cômodos nomeados). Folha de implantação/urbanismo e página sem desenho não vão para a IA.
 *   (a) imagem: menos de 40 traços e uma imagem cobrindo a página (PDF escaneado, fotografado ou convertido);
 *   (b) insuficiente: título de planta baixa sem nenhuma planta lida; todas as plantas lidas parciais; ou nenhuma
 *       planta com cômodo nomeado.
 * No modo "ia" toda prancha com desenho vai; no "geometrico", nenhuma.
 */
export function motivoParaIA(p: Pick<PranchaLida, "plantas" | "diagnostico">, motor: MotorLeitura): string | null {
  if (motor === "geometrico") return null;
  const d = p.diagnostico;
  if (d.segmentos < 40 && d.imagens > 0) return MOTIVOS_IA.imagem;
  if (!p.plantas.length && d.tituloDePlanta) return MOTIVOS_IA.semPlanta;
  if (p.plantas.length && p.plantas.every(x => x.pendencias.some(t => /resultado é parcial/.test(t)))) return MOTIVOS_IA.parcial;
  if (p.plantas.length && p.plantas.every(x => x.nomeados === 0)) return MOTIVOS_IA.semNomes;
  if (motor === "ia" && (d.segmentos >= 40 || d.imagens > 0)) return MOTIVOS_IA.sempre;
  return null;
}

/** Limites da API para o que vai em cada passo: imagem até 5 MB (depois do base64) e 8000 px; PDF até 100 páginas. */
export const MAX_BYTES_IMAGEM_IA = 3_750_000;
export const MAX_LADO_IMAGEM_IA = 8000;
export const MAX_PAGINAS_PDF_IA = 100;
/** A imagem embutida só vale como "a página" quando cobre a maior parte dela (prancha escaneada ou fotografada). */
export const COBERTURA_MIN_IMAGEM = 0.6;
export type EnvioIA = "imagem" | "pdf_pagina" | "pdf_original";

/**
 * O mínimo da página para a IA. Quando a maior imagem da página cobre a maior parte dela (`cobertura`, fração da
 * página medida pelo leitor próprio; >= 0,6), vai o JPEG dela (ou, grande demais, um PDF de uma página só com ele).
 * Prancha vetorial (ou imagem pequena, como um logotipo no carimbo) de um PDF com várias páginas: vai um PDF novo só
 * com AQUELA página (EPIC-027 C1: antes ia o arquivo inteiro a cada prancha). Se não der para separar a página (PDF
 * protegido, estrutura que o leitor mínimo não entende) ou com `extrair` falso, vai o PDF original com a instrução da
 * página, e `motivo` diz por quê — nunca só um pedaço da prancha no lugar dela.
 * `deImagem`: o que vai à IA é uma imagem da prancha (não há linhas nem texto selecionável).
 */
export function anexoDaPagina(dados: Buffer, nome: string, pagina: number, totalPaginas: number, cobertura = 0, extrair = true):
  { anexo: AnexoIA; envio: EnvioIA; deImagem: boolean; motivo?: string } {
  const img = cobertura >= COBERTURA_MIN_IMAGEM ? jpegDaPagina(dados, pagina) : null;
  if (img && img.jpeg.length <= MAX_BYTES_IMAGEM_IA && Math.max(img.largura, img.altura) <= MAX_LADO_IMAGEM_IA) {
    return { anexo: { tipo: "imagem", base64: img.jpeg.toString("base64") }, envio: "imagem", deImagem: true };
  }
  if (img) {
    const pdf = pdfDeUmJpeg(img);
    if (pdf.length <= MAX_BYTES_DOCUMENTOS) return { anexo: { tipo: "pdf", nome: `${nome} — página ${pagina}`, base64: pdf.toString("base64") }, envio: "pdf_pagina", deImagem: true };
  }
  let motivo: string | undefined;
  if (totalPaginas > 1 && extrair) {
    const so = pdfDaPagina(dados, pagina);
    if ("pdf" in so && so.pdf.length <= MAX_BYTES_DOCUMENTOS) return { anexo: { tipo: "pdf", nome: `${nome} — página ${pagina}`, base64: so.pdf.toString("base64") }, envio: "pdf_pagina", deImagem: false };
    motivo = "motivo" in so ? so.motivo : "a página separada ficou grande demais";
  }
  if (totalPaginas > MAX_PAGINAS_PDF_IA) throw new LeituraIndisponivel(`"${nome}" tem ${totalPaginas} páginas, mais que as ${MAX_PAGINAS_PDF_IA} que a IA aceita de uma vez. Envie só as pranchas das plantas baixas.`);
  return { anexo: { tipo: "pdf", nome, base64: dados.toString("base64") }, envio: "pdf_original", deImagem: false, ...(motivo ? { motivo } : {}) };
}

/** Resposta da IA no formato do leitor próprio (conferida e filtrada em resposta-ia.ts). Nunca lança. */
export function plantasDaIA(json: unknown, imagem: boolean): PlantaLida[] {
  return lerRespostaPrancha(json, imagem).plantas;
}

const rotuloDaPrancha = (passo: PassoLeitura) => passo.rotulo.replace(/^Leitura de /, "");

/**
 * Passo "prancha": leitor próprio; se a prancha cair num critério, agenda a leitura pela IA antes do passo final.
 * O teto por maquete é conferido na hora da chamada (contador da maquete), não aqui: a prancha agendada além do teto
 * espera a autorização do admin ou fica com o leitor próprio ("seguir sem a IA").
 */
export async function passoPrancha(m: Maquete3d, estado: EstadoLeitura, passo: PassoLeitura, motor: MotorLeitura): Promise<void> {
  const lida: PranchaLida = await lerPrancha(m, passo);
  lida.diagnostico.lidaPor = "geometrico";
  estado.parciais[passo.chave] = lida;
  Object.assign(passo, { motor: "geometrico", modelo: null, tokens: null });
  const motivo = motivoParaIA(lida, motor);
  const chave = `ia:${passo.doc}:${passo.pagina}`;
  if (!motivo || estado.passos.some(p => p.chave === chave)) return;
  const final = estado.passos.findIndex(p => p.tipo === "montagem");
  const novo: PassoLeitura = { chave, tipo: "prancha_ia", rotulo: `Leitura pela IA — ${rotuloDaPrancha(passo)}`, estado: "pendente", doc: passo.doc, pagina: passo.pagina, arquivo: passo.arquivo, motivoIA: motivo };
  estado.passos.splice(final < 0 ? estado.passos.length : final, 0, novo);
}

export const mensagemSemChave = (motivo: string | null | undefined) => motivo === MOTIVOS_IA.imagem
  ? "Esta prancha é uma imagem e precisa da leitura por IA; cadastre a chave em Integrações → Anthropic (ou envie o PDF exportado do programa de desenho)."
  : `O leitor próprio não leu bem esta prancha (${motivo ?? "leitura insuficiente"}) e ela precisa da leitura por IA; cadastre a chave em Integrações → Anthropic (ou envie o PDF exportado do programa de desenho).`;

/** Consultas seguidas que falharam (rede, API fora do ar) antes de o passo virar erro claro. */
export const MAX_FALHAS_CONSULTA = 30;

/** Mensagens de quando o lote termina sem resultado (pela documentação da Anthropic, nada é cobrado nesses casos). */
export const MENSAGENS_LOTE_SEM_RESULTADO = {
  canceled: "A leitura desta prancha pela IA foi cancelada antes de a IA começar a ler: nada foi cobrado e a confirmação foi devolvida. Tente de novo este passo ou siga sem a IA.",
  expired: "A IA não chegou a ler esta prancha em 24 horas (o lote expirou na Anthropic): nada foi cobrado e a confirmação foi devolvida. Tente de novo este passo.",
  errored: "A IA não aceitou o pedido desta prancha: nada foi cobrado e a confirmação foi devolvida. Tente de novo este passo; se repetir, envie só as pranchas das plantas baixas.",
} as const;

const tokensDe = (e: number, s: number) => `${e.toLocaleString("pt-BR")} + ${s.toLocaleString("pt-BR")} tokens`;

/**
 * Passo "prancha_ia" — leitura em segundo plano (EPIC-027 C1, Message Batches API).
 *   1. Sem chave, além do teto ou sem a confirmação desta execução: o passo fica "aguardando" (não é erro).
 *   2. Com tudo certo: a chamada é RESERVADA (UPDATE condicional; outra aba não envia de novo) e a prancha vai num
 *      lote de uma requisição. O pedido volta em poucos segundos ("enviado"), com o passo "executando" e o lote gravado.
 *   3. Cada "avançar" seguinte só CONSULTA o lote ("mudou"/"sem_mudanca") até terminar. Terminou com a resposta: grava
 *      a planta e os tokens REAIS da Anthropic. Terminou sem resultado (erro, expirado, cancelado — não cobrado):
 *      devolve a confirmação e o contador. Resposta cortada, recusada ou ilegível: foi cobrada; conta e guarda os tokens.
 * A IA voltou sem planta (ou fora do formato): fica o que o leitor próprio leu, com pendência dizendo isso.
 */
export async function passoPranchaIA(m: Maquete3d, estado: EstadoLeitura, passo: PassoLeitura, config: ConfigMaquete, x: Execucao):
  Promise<"feito" | "aguardando" | "adiado" | "enviado" | "mudou" | "sem_mudanca"> {
  if (passo.estado === "executando" && passo.lote?.id) return consultarPranchaIA(estado, passo, config, x);
  if (passo.estado === "executando" && passo.loteAProcurar) return procurarLoteDoPasso(estado, passo, x);
  const credencial = await dependencias().credencialIA().catch(() => null);
  const bloqueio = bloqueioDaIA(estado, config, x, credencial, mensagemSemChave(passo.motivoIA));
  if (bloqueio) { Object.assign(passo, { estado: "aguardando", ...bloqueio }); return "aguardando"; }
  const geo = estado.parciais[`prancha:${passo.doc}:${passo.pagina}`] as PranchaLida | undefined;
  const { d } = documentoDoPasso(m, passo);
  const dados = await bytesDoDocumento(m, d);
  let total = 1;
  const pdf = await dependencias().abrirPdf(dados).catch(() => null);
  if (pdf) { total = pdf.paginas; await pdf.fechar(); }
  const cobertura = geo?.diagnostico.coberturaImagem ?? 0;
  let preparo = anexoDaPagina(dados, d.nome, passo.pagina!, total, cobertura);
  if (preparo.envio === "pdf_pagina" && !preparo.deImagem) {
    // A página separada precisa abrir no leitor de PDF com uma página só; senão, vai o arquivo inteiro (e isso fica dito).
    const copia = await dependencias().abrirPdf(Buffer.from((preparo.anexo as { base64: string }).base64, "base64")).catch(() => null);
    const ok = copia?.paginas === 1;
    if (copia) await copia.fechar();
    if (!ok) preparo = { ...anexoDaPagina(dados, d.nome, passo.pagina!, total, cobertura, false), motivo: "a cópia da página não abriu no leitor de PDF" };
  }
  const { anexo, envio, motivo } = preparo;
  const envioMotivo = motivo ? `Não foi possível separar só a página ${passo.pagina} (${motivo}): o arquivo foi inteiro à IA, com a instrução de ler só essa página.` : null;
  if (envioMotivo) console.warn(`[maquete-3d] maquete ${m.id}, ${passo.chave}: página não separada — ${motivo}`);
  const imagem = (!!geo && geo.diagnostico.segmentos < 40 && geo.diagnostico.imagens > 0) || preparo.deImagem;
  if (semTempoParaIA(x, passo)) return "adiado";
  await reservarChamada(x, estado, passo, config);
  const idPedido = pedidoDaTentativa(x, passo);
  let lote: { id: string };
  try {
    lote = await dependencias().lote.enviar({
      sistema: SISTEMA, pedido: PEDIDO_PRANCHA(d.nome, passo.pagina!, envio, imagem), pdfs: [], anexos: [anexo],
      esquema: ESQUEMA_PRANCHA, config, credencial: credencial!, prazoMs: prazoDaIA(x), idPedido,
    });
  } catch (e) {
    if (naoCobradoNoEnvio(e)) { devolverReserva(x, estado); throw e; }
    const tipo = tipoDoErroIA(e);
    if (tipo === "tempo" || tipo === "conexao") {
      // QA C1, achado 1: o lote pode ter sido criado. O passo continua "executando" e o procura (daqui a alguns segundos)
      // antes de dar a tentativa como usada: achou, segue consultando — nada de segundo lote pago.
      Object.assign(passo, {
        estado: "executando", aguardando: null, erro: null, envio, envioMotivo, modelo: modeloDaLeitura(credencial, config),
        loteAProcurar: { pedido: idPedido, desde: passo.reservadoEm!, tentativas: 0, imagem },
      });
      return "enviado";
    }
    throw e;
  }
  Object.assign(passo, {
    estado: "executando", aguardando: null, erro: null, envio, envioMotivo, modelo: modeloDaLeitura(credencial, config), loteAProcurar: null,
    lote: { id: lote.id, pedido: idPedido, situacao: "em_andamento", enviadoEm: agora().toISOString(), imagem },
  });
  return "enviado";
}

/** Consulta o lote do passo; ao terminar, grava a leitura (ou devolve a reserva, se nada foi entregue). */
async function consultarPranchaIA(estado: EstadoLeitura, passo: PassoLeitura, config: ConfigMaquete, x: Execucao): Promise<"feito" | "mudou" | "sem_mudanca"> {
  const lote = passo.lote!;
  // Base da segunda barreira do N1: esta é a reserva feita quando o lote foi enviado.
  x.reserva = { chave: passo.chave, em: passo.reservadoEm ?? "", tokensEntrada: estado.tokensEntrada, tokensSaida: estado.tokensSaida };
  // QA C1 R2-1: lote adotado que não termina em 2 h é solto (a maquete não fica presa a um lote que pode ser alheio).
  if (lote.adotado && agora().getTime() - Date.parse(lote.adotadoEm ?? lote.enviadoEm) > PRAZO_LOTE_ADOTADO_MS) soltarLoteAdotado(passo, "não terminou em 2 horas");
  const credencial = await dependencias().credencialIA().catch(() => null);
  let situacao: Awaited<ReturnType<ReturnType<typeof dependencias>["lote"]["consultar"]>>;
  try {
    if (!credencial) throw new LeituraIndisponivel("Chave da IA não configurada: cadastre-a em Integrações → Anthropic.");
    // QA C1, achado 5: a consulta usa o que sobra do passo; estourou, conta como falha e a tela consulta no ciclo seguinte.
    situacao = await dependencias().lote.consultar(lote.id, lote.pedido, credencial, prazoDaIA(x));
  } catch (e) {
    if (e instanceof LoteDeOutroPedido) {
      // O lote adotado (achados 1 e 2) terminou com o resultado de outro pedido: não era desta prancha; nada é usado dele.
      // QA C1 R2-2: se o dono for outro passo que ainda o procura, o lote é entregue a ele (o resultado pago não se perde).
      passo.lote = null;
      const entregue = await entregarLoteAoDono(lote.id, e.pedidos, lote.enviadoEm).catch(() => false);
      throw new LeituraIndisponivel(`O lote achado na Anthropic não era o desta prancha (conferido pelo pedido quando terminou): o resultado não foi usado aqui${entregue ? " e foi entregue à leitura que o tinha enviado" : ""}. A tentativa de envio conta como usada; tente de novo este passo.`);
    }
    const tipo = tipoDoErroIA(e);
    lote.falhasDeConsulta = (lote.falhasDeConsulta ?? 0) + 1;
    if (lote.adotado && (tipo === "chave" || tipo === "permissao" || tipo === "recusado" || lote.falhasDeConsulta >= MAX_FALHAS_CONSULTA)) {
      soltarLoteAdotado(passo, `a consulta falhou: ${erroSeguro(e).replace(/\.$/, "")}`);
    }
    if (tipo === "chave" || tipo === "permissao" || tipo === "recusado" || lote.falhasDeConsulta >= MAX_FALHAS_CONSULTA) {
      // QA C1, achado 3: antes de deixar o lote de lado, pede o cancelamento (melhor esforço, prazo curto) e registra.
      const aceito = credencial ? await dependencias().lote.cancelar(lote.id, credencial, Math.min(8_000, prazoDaIA(x))).then(() => true, () => false) : false;
      passo.loteAbandonado = { id: lote.id, cancelamento: aceito ? "aceito" : "recusado" };
      passo.lote = null;
      const cancelamento = aceito
        ? " O cancelamento do lote foi pedido à Anthropic e aceito (se a IA ainda não tinha lido, não é cobrado)."
        : " O cancelamento do lote foi pedido à Anthropic, mas não foi aceito agora.";
      throw new LeituraIndisponivel(`Não foi possível consultar na IA a leitura desta prancha (${erroSeguro(e).replace(/\.$/, "")}). Ela pode ter sido feita e cobrada: esta tentativa conta como usada.${cancelamento} Tente de novo este passo.`);
    }
    return "mudou";
  }
  if (situacao.andamento !== "terminado") {
    if (lote.situacao === situacao.andamento && !lote.falhasDeConsulta) return "sem_mudanca";
    Object.assign(lote, { situacao: situacao.andamento, falhasDeConsulta: 0 });
    return "mudou";
  }
  const imagem = lote.imagem === true;
  passo.lote = null;
  const r = situacao.resultado;
  if (r.tipo === "nao_entregue") {
    devolverReserva(x, estado);
    const base = MENSAGENS_LOTE_SEM_RESULTADO[r.motivo];
    throw new LeituraIndisponivel(r.erro ? base.replace("desta prancha:", `desta prancha (motivo: ${r.erro}):`) : base);
  }
  const msg = r.mensagem;
  estado.tokensEntrada += msg.entrada;
  estado.tokensSaida += msg.saida;
  Object.assign(passo, { motor: "ia", modelo: msg.modelo || passo.modelo || modeloDaLeitura(credencial, config), tokens: { entrada: msg.entrada, saida: msg.saida } });
  const lido = interpretarMensagem(msg);
  if (!lido.ok) {
    const gasto = tokensDe(msg.entrada, msg.saida);
    throw new LeituraIndisponivel(
      lido.motivo === "cortada" ? `A resposta da IA foi cortada antes do fim (a prancha tem elementos demais para uma resposta). Esta leitura foi cobrada e conta como usada (${gasto}). Tente de novo este passo ou siga sem a IA.`
        : lido.motivo === "recusada" ? `A IA recusou a leitura desta prancha. Esta leitura foi cobrada e conta como usada (${gasto}). Siga sem a IA ou envie outro arquivo.`
          : `A IA devolveu uma resposta que não pôde ser lida. Esta leitura foi cobrada e conta como usada (${gasto}). Tente de novo este passo.`,
    );
  }
  aplicarLeituraDaIA(estado, passo, lido.json, imagem);
  passo.aguardando = null;
  return "feito";
}

// ── Lote órfão (QA C1, achados 1 e 2): o lote pode ter sido criado sem que o id chegasse a ser gravado ──

/** custom_id ÚNICO por tentativa: execução, maquete, passo e a hora da reserva (nunca o de outra prancha ou maquete). */
export const pedidoDaTentativa = (x: Pick<Execucao, "coluna" | "id">, passo: Pick<PassoLeitura, "chave" | "reservadoEm">) =>
  idDoPedidoNoLote(`${x.coluna}-${x.id}-${passo.chave}-${Number.isFinite(Date.parse(passo.reservadoEm ?? "")) ? Date.parse(passo.reservadoEm!).toString(36) : "0"}`);
/** Espera depois da reserva antes de procurar: quem criou um lote nesse meio tempo já gravou o id dele. */
export const ESPERA_PARA_PROCURAR_MS = 20_000;
/** Procuras sem achar (a listagem pode atrasar alguns segundos) antes de dar a tentativa como usada. */
export const MAX_PROCURAS = 3;

/** Lote adotado sem terminar por este tempo é solto do passo (QA C1 R2-1). */
export const PRAZO_LOTE_ADOTADO_MS = 2 * 60 * 60 * 1000;

/**
 * QA C1 R2-1: lote ADOTADO (achado pela listagem, sem o custom_id conferido) pode ser de outra maquete ou de outra
 * ferramenta com a mesma chave: NUNCA é cancelado na Anthropic. "Cancelar", o abandono e o prazo de 2 h só o soltam do
 * passo; a tentativa conta como usada. Lança o erro do passo (o chamador grava).
 */
function soltarLoteAdotado(passo: PassoLeitura, motivo: string): never {
  const id = passo.lote!.id;
  Object.assign(passo, { lote: null, loteAbandonado: { id, cancelamento: "nao_pedido" } });
  throw new LeituraIndisponivel(`O lote que foi achado na Anthropic para esta prancha foi solto (${motivo}). Ele NÃO foi cancelado na Anthropic, porque não foi possível confirmar que era desta maquete. Esta tentativa conta como usada; tente de novo este passo ou siga sem a IA.`);
}

/**
 * QA C1 R2-2: o lote adotado terminou e era de outro pedido. Se esse pedido é o de um passo (de outra maquete ou
 * prancha) que ainda procura o seu lote, o id é gravado nele — gravação condicional ao texto lido, então nada é
 * sobrescrito se ele mudou no meio. O custom_id diz a coluna e a maquete; o passo é conferido pelo pedido exato.
 */
async function entregarLoteAoDono(loteId: string, pedidos: string[], criadoEm: string): Promise<boolean> {
  for (const pedido of pedidos.slice(0, 3)) {
    const m = /^(leitura|importacao)-(\d+)-/.exec(pedido);
    if (!m) continue;
    const coluna = m[1] as "leitura" | "importacao";
    const [linha] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.id, Number(m[2])), isNull(maquetes3d.deletedAt))).limit(1);
    const texto = linha?.[coluna];
    if (!linha || !texto) continue;
    const bruto = JSON.parse(texto) as Record<string, unknown>;
    const estado = lerEstadoLeitura(JSON.stringify(coluna === "leitura" ? bruto : bruto.estado));
    const dono = estado.passos.find(p => p.estado === "executando" && !p.lote?.id && p.loteAProcurar?.pedido === pedido);
    if (!dono) continue;
    dono.lote = { id: loteId, pedido, situacao: "em_andamento", enviadoEm: criadoEm, imagem: dono.loteAProcurar!.imagem };
    dono.loteAProcurar = null;
    const novo = JSON.stringify(coluna === "leitura" ? estado : { ...bruto, estado });
    const x = execucaoDe(linha, coluna, () => novo, coluna === "leitura" ? ["em_leitura"] : ["liberada", "em_revisao", "validada", "publicada"]);
    if (await gravarSeIgual(x, novo)) return true;
  }
  return false;
}

/** O lote já está gravado em alguma maquete (leitura ou importação)? Então é de outra execução e não pode ser adotado. */
async function loteJaUsado(id: string): Promise<boolean> {
  const marca = JSON.stringify(id);
  const r = await db().select({ id: maquetes3d.id }).from(maquetes3d)
    .where(sql`strpos(coalesce(${maquetes3d.leitura}, ''), ${marca}) > 0 OR strpos(coalesce(${maquetes3d.importacao}, ''), ${marca}) > 0`).limit(1);
  return r.length > 0;
}

/**
 * Procura, na Anthropic, o lote criado por esta tentativa: de UMA requisição, criado entre a reserva e o limite da
 * reserva, e ainda não gravado em nenhuma maquete. Um só candidato: adotado (o custom_id é conferido quando ele
 * terminar). Nenhum depois de algumas procuras, ou mais de um (não dá para saber qual): "nao_achado".
 * Cada procura é uma chamada curta, com o prazo do passo; a espera entre elas é o ciclo de consulta da tela.
 */
async function resolverOrfao(passo: PassoLeitura, x: Execucao): Promise<"adotado" | "aguardar" | "nao_achado" | "ambiguo"> {
  const alvo = passo.loteAProcurar!;
  const desde = Date.parse(alvo.desde);
  if (!Number.isFinite(desde)) return "nao_achado";
  if (agora().getTime() - desde < ESPERA_PARA_PROCURAR_MS) return "aguardar";
  const credencial = await dependencias().credencialIA().catch(() => null);
  const candidatos = credencial
    ? await dependencias().lote.procurar(new Date(desde - 10_000).toISOString(), new Date(desde + LIMITE_RESERVA_MS).toISOString(), credencial, prazoDaIA(x)).catch(() => null)
    : null;
  const livres: { id: string; criadoEm: string }[] = [];
  for (const c of candidatos ?? []) if (!(await loteJaUsado(c.id))) livres.push(c);
  if (livres.length > 1) return "ambiguo";
  if (livres.length === 1) {
    passo.lote = { id: livres[0].id, pedido: alvo.pedido, situacao: "em_andamento", enviadoEm: livres[0].criadoEm, imagem: alvo.imagem, adotado: true, adotadoEm: agora().toISOString() };
    passo.loteAProcurar = null;
    return "adotado";
  }
  alvo.tentativas++;
  return alvo.tentativas >= MAX_PROCURAS ? "nao_achado" : "aguardar";
}

async function procurarLoteDoPasso(estado: EstadoLeitura, passo: PassoLeitura, x: Execucao): Promise<"mudou" | "sem_mudanca"> {
  x.reserva = { chave: passo.chave, em: passo.reservadoEm ?? "", tokensEntrada: estado.tokensEntrada, tokensSaida: estado.tokensSaida };
  const r = await resolverOrfao(passo, x);
  if (r === "adotado") return "mudou";
  if (r === "aguardar") return passo.loteAProcurar!.tentativas ? "mudou" : "sem_mudanca";
  passo.loteAProcurar = null;
  throw new LeituraIndisponivel(r === "ambiguo"
    ? "O envio da prancha à IA não teve resposta a tempo, e há mais de um lote recente na Anthropic que poderia ser o dela: para não usar o de outra prancha, nenhum foi adotado. Esta tentativa conta como usada; tente de novo este passo."
    : "O envio da prancha à IA não teve resposta a tempo, e o lote não foi encontrado na Anthropic. Por segurança, esta tentativa conta como usada. Tente de novo este passo.");
}

/**
 * QA C1, achado 2: passo "executando" sem lote gravado, com a reserva vencida (a função caiu entre criar o lote e
 * gravar o id). Antes de dar como interrompido, procura o lote uma vez; achou, o passo segue consultando.
 * Devolve true quando adotou (o chamador grava o estado).
 */
export async function adotarAntesDeInterromper(estado: EstadoLeitura, passo: PassoLeitura, x: Execucao): Promise<boolean> {
  if (passo.tipo !== "prancha_ia" || !passo.reservadoEm) return false;
  // O que foi enviado não ficou gravado: a resposta é conferida pelo que o leitor próprio viu da prancha.
  const geo = estado.parciais[`prancha:${passo.doc}:${passo.pagina}`] as PranchaLida | undefined;
  const imagem = !!geo && geo.diagnostico.segmentos < 40 && geo.diagnostico.imagens > 0;
  passo.loteAProcurar = { pedido: pedidoDaTentativa(x, passo), desde: passo.reservadoEm, tentativas: MAX_PROCURAS - 1, imagem };
  const r = await resolverOrfao(passo, x).catch(() => "nao_achado" as const);
  if (r === "adotado") return true;
  passo.loteAProcurar = null;
  return false;
}

/** Grava a planta lida pela IA no lugar da leitura própria (ou, sem planta, mantém a própria com a pendência). */
function aplicarLeituraDaIA(estado: EstadoLeitura, passo: PassoLeitura, json: unknown, imagem: boolean): void {
  const chaveGeo = `prancha:${passo.doc}:${passo.pagina}`;
  const geo = estado.parciais[chaveGeo] as PranchaLida | undefined;
  const lida = lerRespostaPrancha(json, imagem);
  const recusa = lida.gerais.slice(0, 2).map(t => ` ${t}`).join("");
  const base = geo?.diagnostico ?? { segmentos: 0, arcos: 0, textos: 0, imagens: 0, escalas: [], plantas: 0, motivo: null };
  if (!lida.plantas.length && geo?.plantas.length) {
    // A IA não trouxe planta: fica a leitura própria (não é apagada), com a pendência visível na revisão.
    const motivo = lida.motivo ?? `A IA não encontrou planta baixa de pavimento nesta prancha.${recusa}`;
    geo.plantas[0].pendencias.push(`${motivo} Ficou o que o leitor próprio leu desta prancha: confira na revisão.`);
    geo.diagnostico = { ...geo.diagnostico, avisos: [...(geo.diagnostico.avisos ?? []), `${motivo} Ficou o que o leitor próprio leu.`] };
  } else {
    estado.parciais[chaveGeo] = {
      doc: passo.doc!, pagina: passo.pagina!, arquivo: passo.arquivo, plantas: lida.plantas,
      diagnostico: {
        ...base, plantas: lida.plantas.length, avisos: [], lidaPor: "ia",
        motivo: lida.plantas.length ? null : lida.motivo ?? `A IA não encontrou planta baixa de pavimento nesta prancha.${recusa}`,
      },
    } satisfies PranchaLida;
  }
}

/**
 * Botão "Cancelar leitura pela IA": pede à Anthropic o cancelamento do lote do passo em curso. O resultado chega na
 * consulta seguinte: cancelado antes de a IA começar, nada é cobrado (a confirmação volta); se a IA já tinha lido,
 * a leitura é aproveitada (foi paga). Devolve true quando o estado mudou e precisa ser gravado.
 */
export async function cancelarLoteIA(estado: EstadoLeitura | null | undefined, chave: string): Promise<boolean> {
  const passo = estado?.passos.find(p => p.estado === "executando");
  if (!passo) throw new LeituraIndisponivel("Não há leitura pela IA em andamento para cancelar.");
  // QA C1, achado 4: só cancela a prancha que a tela mostrou; com a tela atrasada, pede para atualizar.
  if (passo.chave !== chave) throw new LeituraIndisponivel("A prancha que está na IA agora não é a que esta tela mostra (a leitura andou). Atualize a página e confira antes de cancelar. Nada foi cancelado.");
  if (!passo.lote?.id) throw new LeituraIndisponivel("A prancha ainda está sendo enviada à IA; aguarde alguns segundos e cancele de novo.");
  if (passo.lote.adotado) {
    // QA C1 R2-1: lote adotado nunca é cancelado na Anthropic (pode ser alheio): só é solto, e o passo vira erro.
    try { soltarLoteAdotado(passo, "cancelado nesta tela"); }
    catch (e) { Object.assign(passo, { estado: "erro", erro: (e as Error).message, reservadoEm: null }); }
    return true;
  }
  if (passo.lote.situacao === "cancelando") return false;
  const credencial = await dependencias().credencialIA().catch(() => null);
  if (!credencial) throw new LeituraIndisponivel("Sem a chave da IA não dá para pedir o cancelamento à Anthropic: confira em Integrações → Anthropic.");
  try { await dependencias().lote.cancelar(passo.lote.id, credencial, 15_000); }
  catch (e) { throw new LeituraIndisponivel(`A Anthropic não aceitou o cancelamento agora: ${erroSeguro(e)}`); }
  passo.lote.situacao = "cancelando";
  return true;
}

/** Motor em uso: só consulta a chave quando o administrador não escolheu (aí o padrão depende dela). */
export async function motorDaLeitura(config: ConfigMaquete): Promise<MotorLeitura> {
  return config.motor ?? motorEfetivo(config, !!(await dependencias().credencialIA().catch(() => null)));
}


/**
 * Junta as plantas lidas em pavimentos de uma edificação, no formato que `montarModelo` já entende.
 * Plantas do mesmo andar com o mesmo tamanho (planta baixa e planta de layout, por exemplo) contam uma vez só.
 * O que a planta baixa não traz (pé-direito, cobertura) sai como estimado, para a pessoa confirmar na revisão.
 */
export function parciaisDasPranchas(pranchas: PranchaLida[], nomesDosArquivos: string[]): { parciais: Record<string, unknown>; referencias: { pavimentoId: string; doc: number; pagina: number; arquivo?: ArquivoDoPasso; alinhamento: { x: number; y: number; larguraM: number } | null }[]; motivos: string[] } {
  type Candidata = { planta: PlantaLida; doc: number; arquivo?: ArquivoDoPasso; pagina: number; nome: string; andar: number | null; numero?: number; tipo?: boolean; semAndar: boolean; avisos: string[] };
  const candidatas: Candidata[] = [];
  for (const pr of pranchas) for (const planta of pr.plantas) {
    const { nome, andar, numero, tipo } = nomeDoPavimento(planta.titulo, candidatas.length);
    candidatas.push({ planta, doc: pr.doc, arquivo: pr.arquivo, pagina: pr.pagina, nome, andar, numero, tipo, semAndar: andar === null && !tipo, avisos: [] });
  }
  const onde = (c: Candidata) => `"${c.planta.titulo || "planta sem título"}" (${nomesDosArquivos[c.doc] ?? "PDF"}, página ${c.pagina})`;
  // Com um "TÉRREO" escrito na mesma obra, os andares numerados ("PAV. 01", "1º PAVIMENTO") ficam acima dele.
  if (candidatas.some(c => c.andar === 0 && c.numero === undefined) && candidatas.some(c => c.numero === 1)) {
    for (const c of candidatas) if (c.numero !== undefined) c.andar = c.numero;
  }
  // Planta de layout (a mesma planta com móveis) só vira pavimento se não houver a planta baixa simples do mesmo
  // andar (sem andar no título conta como térreo) ou do mesmo tamanho.
  const ehLayout = (c: Candidata) => c.planta.vista === "layout";
  const mesmoTamanho = (a: Candidata, b: Candidata) => Math.abs(a.planta.largura - b.planta.largura) < 0.25 && Math.abs(a.planta.comprimento - b.planta.comprimento) < 0.25;
  for (const c of [...candidatas]) {
    const simples = ehLayout(c) ? candidatas.find(o => !ehLayout(o) && ((o.andar ?? 0) === (c.andar ?? 0) || (c.andar === null && mesmoTamanho(o, c)))) : undefined;
    if (!simples) continue;
    candidatas.splice(candidatas.indexOf(c), 1);
    // Sem andar no título, é suposição (a de layout do mesmo andar): dito como suposição.
    simples.avisos.push(c.andar === null
      ? `${onde(c)} não diz o andar e foi tomada como a planta de layout deste andar (não virou outro pavimento). Se for de outro andar, acrescente-o na revisão.`
      : `${onde(c)} é a planta de layout deste andar e não virou outro pavimento.`);
  }
  // Pavimento-tipo sem faixa escrita vai logo acima do maior andar numerado (abaixo de duplex/cobertura).
  const andaresComuns = () => candidatas.filter(c => c.andar !== null && c.andar < 900).map(c => c.andar!);
  for (const c of candidatas) if (c.tipo && c.andar === null) c.andar = Math.max(0, ...andaresComuns()) + 1;
  // Planta sem andar no título: a primeira vira o térreo se nenhuma outra o ocupa; as demais vão para o fim, na ordem das páginas.
  for (const c of candidatas.filter(c => c.semAndar)) c.andar = !candidatas.some(o => o !== c && o.andar === 0) ? 0 : Math.max(0, ...andaresComuns()) + 1;
  const lista = candidatas;
  /** Assinatura dos cômodos: função e área (a escrita, ou a desenhada) de cada um. Mesma assinatura = mesma planta desenhada de novo. */
  const assinatura = (c: Candidata) => c.planta.comodos.map(x => `${x.funcao}:${Math.round(x.areaInformada ?? areaPoligono(x.pontos))}`).sort().join("|");
  const unicas: Candidata[] = [];
  for (const c of lista) {
    const igual = unicas.find(u => mesmoTamanho(u, c) && assinatura(u) === assinatura(c) && (u.andar === c.andar || u.semAndar || c.semAndar));
    if (igual) {
      // A mesma planta (mesmos cômodos, mesmas áreas) enviada de novo: fica uma, e isso é dito.
      const melhor = /BAIXA/i.test(c.planta.titulo) && !/BAIXA/i.test(igual.planta.titulo) ? c : c.planta.nomeados > igual.planta.nomeados ? c : igual;
      melhor.avisos.push(`${onde(c === melhor ? igual : c)} tem os mesmos cômodos e áreas desta planta e foi tratada como a mesma (não virou outro pavimento). Se for outro andar, acrescente-o na revisão.`);
      unicas[unicas.indexOf(igual)] = melhor;
      continue;
    }
    const mesmoAndar = unicas.find(u => u.andar === c.andar);
    if (mesmoAndar) {
      // Dois desenhos diferentes para o mesmo andar: os dois ficam (um logo acima do outro) para a pessoa decidir.
      c.andar = (c.andar ?? 0) + 0.01;
      c.avisos.push(`${onde(c)} e ${onde(mesmoAndar)} dizem o mesmo andar, mas os cômodos são diferentes: ficaram como pavimentos separados. Confira na revisão qual é qual.`);
    } else if (c.semAndar && (c.andar !== 0 || unicas.some(u => mesmoTamanho(u, c))) && !c.planta.pendencias.some(t => /tomado como outro andar/.test(t))) {
      // Planta sem andar posta acima dos andares com nome: nunca em silêncio (pode ser edícula ou outra casa no térreo).
      c.avisos.push(`${onde(c)} não diz o andar${unicas.some(u => mesmoTamanho(u, c)) ? " e tem o mesmo tamanho de outra planta" : ""}: ficou como pavimento separado, ${c.andar === 0 ? "no térreo" : "acima dos andares com nome"}. Se for edícula, anexo ou outra casa no térreo, ajuste na revisão.`);
    }
    unicas.push(c);
  }
  unicas.sort((a, b) => a.andar! - b.andar! || candidatas.indexOf(a) - candidatas.indexOf(b));
  unicas.forEach((c, i) => { if (c.semAndar) c.nome = c.andar === 0 ? "Térreo" : `Pavimento ${i + 1}`; });
  const origemDe = (p: PranchaLida) => `${nomesDosArquivos[p.doc] ?? "PDF"}${pranchas.filter(q => q.doc === p.doc).length > 1 ? `, página ${p.pagina}` : ""}`;
  const motivos = [
    ...pranchas.filter(p => !p.plantas.length && p.diagnostico.motivo).map(p => `${origemDe(p)}: ${p.diagnostico.motivo}`),
    ...pranchas.flatMap(p => (p.diagnostico.avisos ?? []).map(a => `${origemDe(p)}: ${a}`)),
  ];
  const parciais: Record<string, unknown> = {};
  const referencias: ReturnType<typeof parciaisDasPranchas>["referencias"] = [];
  // Mezanino e sobreloja: pé-direito menor (estimado); os níveis somam o pé-direito e a laje de cada andar de baixo.
  const PE_DIREITO = 2.7, PE_MEZANINO = 2.4, LAJE = 0.15, usados = new Set<string>();
  let nivel = 0;
  const pavimentos = unicas.map((c, j) => {
    let nome = c.nome;
    for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${c.nome} (${n})`;
    usados.add(nome.toLowerCase());
    const id = idPavimento(0, j), proximo = unicas[j + 1];
    parciais[`estrutura:${id}`] = { paredes: c.planta.paredes, aberturas: c.planta.aberturas, pendencias: [] } satisfies Estrutura;
    const meio = /^(?:Mezanino|Sobreloja|Piso intermediário)/.test(c.nome), peDireito = meio ? PE_MEZANINO : PE_DIREITO;
    if (meio) c.avisos.push(`Pé-direito estimado em ${PE_MEZANINO.toFixed(2).replace(".", ",")} m, com o piso logo acima do andar de baixo: confira as alturas no corte.`);
    parciais[`ambientes:${id}`] = { comodos: c.planta.comodos, escadas: c.planta.escadas.map(e => ({ ...e, sobePara: "" })), pendencias: [...c.planta.pendencias, ...c.avisos] };
    const k = c.planta.metrosPorPonto;
    referencias.push({ pavimentoId: id, doc: c.doc, pagina: c.pagina, ...(c.arquivo ? { arquivo: c.arquivo } : {}), alinhamento: k > 0 ? { x: -c.planta.origemPt.x * k, y: -c.planta.origemPt.y * k, larguraM: c.planta.larguraDaPaginaM } : null });
    const r = { nome, nivel: Math.round(nivel * 100) / 100, peDireito, peDireitoConfirmado: false, repeticoes: 1, doc: c.doc, pagina: c.pagina, temProximo: !!proximo };
    nivel += peDireito + LAJE;
    return r;
  });
  // A escada de cada pavimento leva ao pavimento de cima.
  pavimentos.forEach((p, j) => {
    const amb = parciais[`ambientes:${idPavimento(0, j)}`] as Ambientes;
    amb.escadas = p.temProximo ? amb.escadas.map(e => ({ ...e, sobePara: pavimentos[j + 1].nome })) : [];
    if (!p.temProximo) amb.pendencias = amb.pendencias.filter(t => !/^Escada lida/.test(t));
  });
  parciais.inventario = {
    edificacoes: pavimentos.length ? [{ nome: "Edificação", cobertura: { tipo: "duas_aguas", inclinacao: 30, beiral: 0.5, confirmada: false }, pavimentos: pavimentos.map(({ temProximo: _t, ...p }) => p) }] : [],
    implantacao: null, pendencias: [],
  } satisfies Inventario;
  return { parciais, referencias, motivos };
}

// ── Execução ──
// Toda gravação de um passo é condicional ao texto da leitura que ele leu (execucao-ia.ts): quem chega atrasado não
// regrava nada e recebe o estado atual.

const emLeitura = (id: number) => and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt), inArray(maquetes3d.status, [...PODE_LER]));

async function buscar(id: number): Promise<Maquete3d | null> {
  const [m] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt))).limit(1);
  return m ?? null;
}

const execucaoDaLeitura = (m: Maquete3d, inicio?: number) => execucaoDe(m, "leitura", e => JSON.stringify(e), ["em_leitura"], inicio);

/** O estado gravado agora (quando outra aba ou pessoa gravou antes deste pedido). */
async function estadoGravado(id: number): Promise<{ estado: EstadoLeitura; status: StatusMaquete }> {
  const m = await buscar(id);
  if (!m) throw new LeituraIndisponivel("Maquete não encontrada.");
  return { estado: lerEstadoLeitura(m.leitura), status: m.status as StatusMaquete };
}

/**
 * Começa (ou recomeça do zero) a leitura. Recomeçar descarta a planta já revisada — que vai antes para o histórico;
 * se não der para guardá-la, nada é apagado. A confirmação da IA NÃO passa para a leitura nova (vale por execução).
 * Com uma planta importada em andamento, a leitura não começa: a pessoa aplica ou descarta a importação antes.
 */
export async function iniciarLeitura(id: number): Promise<EstadoLeitura> {
  const atual = await buscar(id);
  if (!atual || !PODE_LER.includes(atual.status as StatusMaquete)) throw new LeituraIndisponivel("Esta maquete não está liberada para leitura.");
  if (atual.importacao) throw new LeituraIndisponivel("Há uma planta importada em andamento nesta maquete: aplique ou descarte a importação antes de ler o projeto de novo.");
  // QA rodada 2, N1: recomeçar no meio de uma chamada paga jogaria fora a resposta dela.
  if (atual.status === "em_leitura") exigirSemPassoEmCurso(lerEstadoLeitura(atual.leitura));
  const anterior = lerModelo(atual.modelo);
  await guardarAnterior(atual, "Planta antes de ler o projeto de novo do zero");
  const estado: EstadoLeitura = {
    ...leituraVazia(), iniciadaEm: agora().toISOString(), confirmacaoIA: null,
    parciais: anterior?.implantacao?.lotes.some(l => l.unidade) ? { implantacaoDoEstudo: anterior.implantacao } : {},
    passos: [{ chave: "inventario", tipo: "inventario", rotulo: "Inventário das pranchas e dos pavimentos", estado: "pendente" }],
  };
  const r = await db().update(maquetes3d)
    .set({ status: "em_leitura" satisfies StatusMaquete, leitura: JSON.stringify(estado), modelo: null, revisadoPor: null, revisadoEm: null, updatedAt: agora() })
    .where(and(emLeitura(id), isNull(maquetes3d.importacao), eq(maquetes3d.modeloVersao, atual.modeloVersao),
      // Só recomeça a leitura que foi conferida acima (uma reserva feita no meio do caminho não é atropelada).
      atual.leitura === null ? isNull(maquetes3d.leitura) : eq(maquetes3d.leitura, atual.leitura))).returning({ id: maquetes3d.id });
  if (!r.length) throw new LeituraIndisponivel("A maquete mudou enquanto a leitura começava (outra pessoa salvou a planta ou importou um PDF). Recarregue a página e tente de novo.");
  return estado;
}

/** Passo do fluxo antigo (motor "IA em tudo"): uma chamada paga com os PDFs inteiros, com a mesma confirmação e reserva. */
async function passoAntigoIA(m: Maquete3d, estado: EstadoLeitura, passo: PassoLeitura, config: ConfigMaquete, x: Execucao): Promise<"feito" | "aguardando" | "adiado"> {
  const credencial = await dependencias().credencialIA().catch(() => null);
  const bloqueio = bloqueioDaIA(estado, config, x, credencial,
    "O motor \"IA em tudo\" precisa da chave da IA: cadastre-a em Integrações → Anthropic, ou troque o motor para o leitor próprio ou o híbrido em Configurações.",
    UNIDADE_MOTOR_IA);
  if (bloqueio) { Object.assign(passo, { estado: "aguardando", ...bloqueio }); return "aguardando"; }
  const pdfs = await carregarPdfs(m);
  const inv = estado.parciais.inventario as Inventario | undefined;
  const ed = passo.edificacaoId ? inv?.edificacoes[Number(passo.edificacaoId.slice(2)) - 1] : undefined;
  const pav = ed && passo.pavimentoId ? ed.pavimentos[Number(passo.pavimentoId.split("-pv")[1]) - 1] : undefined;
  const [pedido, esquema] =
    passo.tipo === "inventario" ? [PEDIDO_INVENTARIO(m.tipo as TipoMaquete, pdfs.map(p => p.nome)), ESQUEMA_INVENTARIO] :
    passo.tipo === "estrutura" ? [PEDIDO_ESTRUTURA(ed!.nome, pav!.nome, passo.doc!, passo.pagina!), ESQUEMA_ESTRUTURA] :
    passo.tipo === "ambientes" ? [PEDIDO_AMBIENTES(ed!.nome, pav!.nome, passo.doc!, passo.pagina!,
      JSON.stringify(((estado.parciais[`estrutura:${passo.pavimentoId}`] as Estrutura | undefined)?.paredes ?? []).map(w => [w.id, w.ax, w.ay, w.bx, w.by])),
      ed!.pavimentos.map(p => p.nome).filter(n => n !== pav!.nome)), ESQUEMA_AMBIENTES] :
    [PEDIDO_IMPLANTACAO(passo.doc!, passo.pagina!, inv!.edificacoes.map(e => e.nome)), ESQUEMA_IMPLANTACAO];
  if (semTempoParaIA(x, passo)) return "adiado";
  await reservarChamada(x, estado, passo, config);
  let r: Awaited<ReturnType<ReturnType<typeof dependencias>["ia"]>>;
  try {
    r = await dependencias().ia({ sistema: SISTEMA, pedido, pdfs, esquema, config, credencial: credencial!, prazoMs: prazoDaIA(x) });
  } catch (e) {
    if (naoCobrado(e)) devolverReserva(x, estado);
    throw e;
  }
  estado.tokensEntrada += r.entrada;
  estado.tokensSaida += r.saida;
  Object.assign(passo, { motor: "ia", modelo: r.modelo ?? modeloDaLeitura(credencial, config), tokens: { entrada: r.entrada, saida: r.saida } });
  if (!respostaAntigaValida(passo.tipo, r.json)) {
    throw new LeituraIndisponivel("A IA devolveu uma resposta fora do formato esperado neste passo. Tentar de novo faz outra chamada paga, com nova confirmação do administrador.");
  }
  estado.parciais[passo.chave] = r.json;
  if (passo.tipo === "inventario") {
    const lido = r.json as Inventario;
    if (!lido.edificacoes.some(e => e.pavimentos.length) && !lido.implantacao && !estado.parciais.implantacaoDoEstudo) {
      throw new LeituraIndisponivel("Nenhuma planta baixa nem implantação foi encontrada nos arquivos escolhidos.");
    }
    lido.edificacoes = lido.edificacoes.filter(e => e.pavimentos.length);
    estado.passos = [{ ...passo, estado: "feito", erro: null, reservadoEm: null }, ...passosDoInventario(lido)];
  }
  return "feito";
}

/** Forma mínima da resposta de cada passo do fluxo antigo (o que a montagem percorre). */
function respostaAntigaValida(tipo: PassoLeitura["tipo"], json: unknown): boolean {
  const o = (json ?? null) as Record<string, unknown> | null;
  const listas = (...k: string[]) => !!o && typeof o === "object" && k.every(c => Array.isArray(o[c]));
  if (tipo === "inventario") return listas("edificacoes", "pendencias") && (o!.edificacoes as unknown[]).every(e => !!e && typeof e === "object" && Array.isArray((e as { pavimentos?: unknown }).pavimentos));
  if (tipo === "estrutura") return listas("paredes", "aberturas", "pendencias");
  if (tipo === "ambientes") return listas("comodos", "escadas", "pendencias");
  return listas("terreno", "vias", "lotes", "posicoes", "pendencias");
}

/** Executa o próximo passo pendente e grava o resultado (com condição). Devolve o estado atualizado. */
export async function avancarLeitura(id: number, autorId: number | null = null): Promise<{ estado: EstadoLeitura; status: StatusMaquete }> {
  const inicio = Date.now();
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  const passo = estado.passos.find(p => p.estado !== "feito");
  if (!passo) return { estado, status: m.status as StatusMaquete };
  const x = execucaoDaLeitura(m, inicio);

  if (passo.estado === "executando" && !passo.lote?.id && !passo.loteAProcurar) {
    // Outra aba está enviando este passo à IA: não envia de novo. Reserva velha: o passo foi interrompido — antes,
    // procura o lote que ele pode ter criado (QA C1, achado 2); achou, segue consultando.
    if (!reservaVencida(passo)) return { estado, status: "em_leitura" };
    if (await adotarAntesDeInterromper(estado, passo, x)) return (await gravarSeIgual(x, x.serializar(estado))) ? { estado, status: "em_leitura" } : estadoGravado(id);
    Object.assign(passo, { estado: "erro", erro: MENSAGEM_INTERROMPIDA, reservadoEm: null });
    return (await gravarSeIgual(x, x.serializar(estado))) ? { estado, status: "em_leitura" } : estadoGravado(id);
  }

  let status: StatusMaquete = "em_leitura";
  let modelo: string | undefined;
  let aguardando = false;
  try {
    const config = await carregarConfig();
    const motor = await motorDaLeitura(config);
    const geometrico = motor !== "ia" || passo.tipo === "prancha" || passo.tipo === "prancha_ia";
    if (geometrico && passo.tipo === "inventario") {
      estado.passos = [{ ...passo, estado: "feito", erro: null, motor: "geometrico" }, ...(await passosDasPranchas(m))];
    } else if (passo.tipo === "prancha") {
      await passoPrancha(m, estado, passo, motor);
    } else if (passo.tipo === "prancha_ia") {
      // "adiado" (N7): sem tempo para a IA neste pedido; o passo segue pendente e a tela chama de novo.
      // "enviado"/"mudou": o lote está na Anthropic; o passo segue "executando" e a tela consulta de novo.
      const r = await passoPranchaIA(m, estado, passo, config, x);
      if (r === "sem_mudanca") return { estado, status: "em_leitura" };
      aguardando = r !== "feito";
    } else if (passo.tipo === "montagem" && estado.passos.some(p => p.tipo === "prancha")) {
      const pranchas = pranchasParaMontagem(m, estado);
      const r = parciaisDasPranchas(pranchas, lerDocumentos(m.documentos).map(d => d.nome));
      const inv = r.parciais.inventario as Inventario;
      if (!inv.edificacoes.length && !estado.parciais.implantacaoDoEstudo) {
        throw new LeituraIndisponivel(`Nenhuma planta baixa foi reconhecida nos arquivos escolhidos. ${r.motivos.slice(0, 3).join(" ")}`.trim());
      }
      Object.assign(estado.parciais, r.parciais, { pranchasDosPavimentos: r.referencias, avisosDaLeitura: r.motivos });
      modelo = JSON.stringify(montarModelo(m.tipo as TipoMaquete, estado.parciais));
      estado.concluidaEm = agora().toISOString();
      status = "em_revisao";
    } else if (passo.tipo === "montagem") {
      modelo = JSON.stringify(montarModelo(m.tipo as TipoMaquete, estado.parciais));
      estado.concluidaEm = agora().toISOString();
      status = "em_revisao";
    } else {
      aguardando = (await passoAntigoIA(m, estado, passo, config, x)) !== "feito";
    }
    if (!aguardando) {
      const atual = estado.passos.find(p => p.chave === passo.chave)!;
      Object.assign(atual, { estado: "feito", erro: null, aguardando: null, reservadoEm: null });
    }
  } catch (e) {
    // Outra aba reservou a chamada (ou a leitura mudou): este pedido não chamou a IA e não grava nada.
    if (e instanceof ExecucaoConcorrente) return estadoGravado(id);
    const atual = estado.passos.find(p => p.chave === passo.chave)!;
    Object.assign(atual, { estado: "erro", erro: erroSeguro(e), reservadoEm: null, lote: null, loteAProcurar: null });
    status = "em_leitura";
    modelo = undefined;
  }

  const gravado = await gravarSeIgual(x, x.serializar(estado), {
    deltaIA: -x.devolver, extra: { status, ...(modelo ? { modelo, modeloVersao: m.modeloVersao + 1 } : {}) },
  });
  if (!gravado) {
    // Segunda barreira do N1: a leitura mudou durante a chamada paga. Se o passo continua reservado por este pedido,
    // o resultado dele vai para o estado atual (a resposta paga não é jogada fora).
    await gravarSobreOAtual(x, estado, async () => {
      const agoraM = await buscar(id);
      return agoraM?.status === "em_leitura" ? { estado: lerEstadoLeitura(agoraM.leitura), x: execucaoDaLeitura(agoraM) } : null;
    });
    return estadoGravado(id);
  }
  if (modelo) await registrarRevisao({ maqueteId: id, versao: m.modeloVersao + 1, modelo, origem: "leitura", motivo: "Planta lida dos PDFs do pedido", autorId });
  return { estado, status };
}

/**
 * O administrador confirma o custo da IA para ESTA leitura: autoriza as pranchas pendentes dentro do teto da maquete
 * (ou todas, com `alemDoTeto`). A confirmação expira quando elas forem lidas; "ler de novo" pede outra.
 */
export async function confirmarIA(id: number, userId: number, alemDoTeto = false, modeloVisto?: string): Promise<EstadoLeitura> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  exigirSemPassoEmCurso(estado);
  const config = await carregarConfig();
  const x = execucaoDaLeitura(m);
  // QA S-11 r2, achado 2: só confirma o modelo que a tela mostrou; senão, a tela passa a mostrar o de agora
  const doModelo = await modeloDaConfirmacao(estado, config, x, modeloVisto);
  if ("erro" in doModelo) {
    await gravarSeIgual(x, x.serializar(estado)).catch(() => false);
    throw new LeituraIndisponivel(doModelo.erro);
  }
  const r = novaConfirmacao(estado, config, m.iaPranchasLidas ?? 0, userId, alemDoTeto, doModelo.modelo);
  if ("erro" in r) throw new LeituraIndisponivel(r.erro!);
  if (!(await gravarSeIgual(x, x.serializar(estado)))) throw new LeituraIndisponivel("A leitura mudou enquanto você confirmava. Confira o que ela pede agora e confirme de novo.");
  return estado;
}

/** Segue sem a IA: as pranchas que iriam para ela ficam com o que o leitor próprio leu (e isso fica dito no passo). */
export async function pularIA(id: number): Promise<EstadoLeitura> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  exigirSemPassoEmCurso(estado);
  pularPassosIA(estado, await carregarConfig());
  const x = execucaoDaLeitura(m);
  if (!(await gravarSeIgual(x, x.serializar(estado)))) throw new LeituraIndisponivel("A leitura mudou enquanto você escolhia. Confira e tente de novo.");
  return estado;
}

/** Cancela, na Anthropic, a leitura pela IA em andamento nesta leitura (o resultado chega na próxima consulta). */
export async function cancelarLeituraIA(id: number, chave: string): Promise<EstadoLeitura> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  // Se outra aba gravou no meio, o pedido de cancelamento já foi feito: a próxima consulta vê o lote "cancelando".
  if (await cancelarLoteIA(estado, chave)) await gravarSeIgual(execucaoDaLeitura(m), JSON.stringify(estado));
  return estado;
}
