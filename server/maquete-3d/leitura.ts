// Maquete 3D (EPIC-022) — motor de leitura: transforma os PDFs do projeto no modelo em três camadas
// (shared/maquete-3d/modelo.ts). A leitura é feita em passos curtos, um por chamada, para caber no limite de
// tempo da função; o estado fica gravado em maquetes_3d.leitura e qualquer passo pode ser repetido.
//   inventário → para cada pavimento: estrutura (paredes e aberturas) e ambientes (cômodos e escadas)
//              → implantação (quando houver prancha) → montagem (sem IA: junta, valida e grava o modelo).
// Regra do dono: a geometria do projeto não é inventada. O que a prancha não traz vira "estimada" ou pendência,
// e a pessoa confirma na revisão antes de publicar.
import { and, eq, inArray, isNull } from "drizzle-orm";
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
import { jpegDaPagina, pdfDeUmJpeg } from "./pdf-pagina.js";
import { lerPagina, nomeDoPavimento, type Diagnostico, type PlantaLida } from "./geometrico.js";
import { guardarAnterior, registrarRevisao } from "./revisoes.js";
import { LIMITE_PASSO_MS, LeituraIndisponivel, agora, carregarConfig, db, dependencias, erroSeguro, modeloDaLeitura, type AnexoIA, type PdfLido, alvoDoDocumento } from "./base.js";

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

export type PranchaLida = { doc: number; pagina: number; plantas: PlantaLida[]; diagnostico: Diagnostico & { lidaPor?: "geometrico" | "ia" } };

async function bytesDoDocumento(m: Maquete3d, indice: number) {
  const d = lerDocumentos(m.documentos)[indice];
  if (!d) throw new LeituraIndisponivel("Um dos PDFs desta maquete não está mais na lista.");
  const dados = await dependencias().lerPdf(d, alvoDoDocumento(m, d));
  if (dados.length > MAX_BYTES_DOCUMENTOS) throw new LeituraIndisponivel(`O arquivo "${d.nome}" passa de ${Math.round(MAX_BYTES_DOCUMENTOS / 1048576)} MB.`);
  return { d, dados };
}

async function abrirDocumento(m: Maquete3d, indice: number) {
  const { d, dados } = await bytesDoDocumento(m, indice);
  try { return await dependencias().abrirPdf(dados); }
  catch { throw new LeituraIndisponivel(`Não foi possível abrir "${d.nome}": o arquivo não é um PDF válido ou está protegido por senha.`); }
}

/** Inventário do leitor geométrico: conta as páginas e cria um passo por prancha (`so`: só aquele documento). */
export async function passosDasPranchas(m: Maquete3d, so?: number): Promise<PassoLeitura[]> {
  const docs = lerDocumentos(m.documentos), passos: PassoLeitura[] = [];
  if (!docs.length) throw new LeituraIndisponivel("Nenhum PDF foi escolhido para esta maquete.");
  for (let d = 0; d < docs.length; d++) {
    if (so !== undefined && d !== so) continue;
    const pdf = await abrirDocumento(m, d);
    try {
      for (let p = 1; p <= pdf.paginas && passos.length < MAX_PAGINAS; p++) {
        passos.push({ chave: `prancha:${d}:${p}`, tipo: "prancha", rotulo: `Leitura de ${docs[d].nome}${pdf.paginas > 1 ? ` — página ${p}` : ""}`, estado: "pendente", doc: d, pagina: p });
      }
    } finally { await pdf.fechar(); }
  }
  return [...passos, { chave: "montagem", tipo: "montagem", rotulo: "Montagem e conferência do modelo", estado: "pendente" }];
}

async function lerPrancha(m: Maquete3d, doc: number, pagina: number): Promise<PranchaLida> {
  const pdf = await abrirDocumento(m, doc);
  try { return { doc, pagina, ...lerPagina(await pdf.pagina(pagina)) }; }
  finally { await pdf.fechar(); }
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
export type EnvioIA = "imagem" | "pdf_pagina" | "pdf_original";

/**
 * O mínimo da página para a IA: o JPEG da prancha como imagem; JPEG grande demais vai num PDF de uma página só;
 * sem JPEG extraível (prancha vetorial fraca, outro formato de imagem), o PDF original com a instrução da página.
 */
export function anexoDaPagina(dados: Buffer, nome: string, pagina: number, totalPaginas: number): { anexo: AnexoIA; envio: EnvioIA } {
  const img = jpegDaPagina(dados, pagina);
  if (img && img.jpeg.length <= MAX_BYTES_IMAGEM_IA && Math.max(img.largura, img.altura) <= MAX_LADO_IMAGEM_IA) {
    return { anexo: { tipo: "imagem", base64: img.jpeg.toString("base64") }, envio: "imagem" };
  }
  if (img) {
    const pdf = pdfDeUmJpeg(img);
    if (pdf.length <= MAX_BYTES_DOCUMENTOS) return { anexo: { tipo: "pdf", nome: `${nome} — página ${pagina}`, base64: pdf.toString("base64") }, envio: "pdf_pagina" };
  }
  if (totalPaginas > MAX_PAGINAS_PDF_IA) throw new LeituraIndisponivel(`"${nome}" tem ${totalPaginas} páginas, mais que as ${MAX_PAGINAS_PDF_IA} que a IA aceita de uma vez. Envie só as pranchas das plantas baixas.`);
  return { anexo: { tipo: "pdf", nome, base64: dados.toString("base64") }, envio: "pdf_original" };
}

type PlantaDaIA = {
  titulo: string; escala: number; escalaLegivel: boolean; temCotas: boolean;
  paredes: PlantaLida["paredes"]; aberturas: PlantaLida["aberturas"]; comodos: PlantaLida["comodos"];
  escadas: (Omit<PlantaLida["escadas"][number], "sobePara" | "tipo" | "degraus"> & { tipo: string; degraus: number | null })[]; pendencias: string[];
};

/**
 * Resposta da IA no formato do leitor próprio, para a montagem ser a mesma. Nada é inventado: sem cota escrita, nada
 * fica confirmado; sem escala legível, pendência pedindo para acertar uma medida conhecida na revisão.
 */
export function plantasDaIA(json: unknown, imagem: boolean): PlantaLida[] {
  const r = (json ?? {}) as { plantas?: PlantaDaIA[]; pendencias?: string[] };
  const gerais = (r.pendencias ?? []).filter(t => typeof t === "string");
  return (r.plantas ?? []).map((p, i): PlantaLida => {
    const semCota = !p.temCotas;
    const confirmada = (c: boolean) => c === true && !semCota;
    const pts = [...p.paredes.flatMap(w => [{ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }]), ...p.comodos.flatMap(c => c.pontos)];
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    const largura = xs.length ? Math.max(...xs) - Math.min(...xs) : 0, comprimento = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    const pendencias = [...(p.pendencias ?? []), ...(i === 0 ? gerais : [])];
    if (!p.escalaLegivel) pendencias.push("A escala não está escrita de forma legível na prancha: as medidas são estimadas pela IA. Na revisão, acerte uma medida conhecida (uma cota, a largura de uma porta) e confira as demais.");
    if (imagem) pendencias.push(`Planta lida pela IA a partir de uma imagem${semCota ? ", sem cotas legíveis" : ""}: confira paredes, aberturas e cômodos sobre a prancha ao fundo antes de validar.`);
    return {
      titulo: String(p.titulo ?? "").slice(0, 120), escala: p.escalaLegivel && p.escala > 0 ? Math.round(p.escala) : 0, escalaOrigem: p.escalaLegivel && p.escala > 0 ? "texto" : "suposta",
      origemPt: { x: 0, y: 0 }, metrosPorPonto: 0, larguraDaPaginaM: 0, largura, comprimento,
      paredes: p.paredes.map(w => ({ ...w, confirmada: confirmada(w.confirmada) })),
      aberturas: p.aberturas.map(a => ({ ...a, confirmada: confirmada(a.confirmada) })),
      comodos: p.comodos.map(c => ({ ...c, confirmada: confirmada(c.confirmada) })),
      escadas: p.escadas.map(e => ({ ...e, sobePara: "", degraus: e.degraus ?? 0, confirmada: confirmada(e.confirmada) })) as PlantaLida["escadas"],
      pendencias, nomeados: p.comodos.filter(c => c.nome?.trim()).length, razaoAreas: null, vista: "planta",
    };
  });
}

const rotuloDaPrancha = (passo: PassoLeitura) => passo.rotulo.replace(/^Leitura de /, "");

/** Passo "prancha": leitor próprio; se a prancha cair num critério, agenda a leitura pela IA antes do passo final. */
export async function passoPrancha(m: Maquete3d, estado: EstadoLeitura, passo: PassoLeitura, motor: MotorLeitura, config: ConfigMaquete): Promise<void> {
  const lida: PranchaLida = await lerPrancha(m, passo.doc!, passo.pagina!);
  lida.diagnostico.lidaPor = "geometrico";
  estado.parciais[passo.chave] = lida;
  Object.assign(passo, { motor: "geometrico", modelo: null, tokens: null });
  const motivo = motivoParaIA(lida, motor);
  const chave = `ia:${passo.doc}:${passo.pagina}`;
  if (!motivo || estado.passos.some(p => p.chave === chave)) return;
  if (estado.passos.filter(p => p.tipo === "prancha_ia").length >= config.limitePranchasIA) {
    estado.foraDoLimiteIA = [...(estado.foraDoLimiteIA ?? []), `${rotuloDaPrancha(passo)}: ${motivo}. Passou do limite de ${config.limitePranchasIA} prancha(s) pela IA por maquete (Configurações) e ficou o que o leitor próprio leu.`];
    return;
  }
  const final = estado.passos.findIndex(p => p.tipo === "montagem");
  const novo: PassoLeitura = { chave, tipo: "prancha_ia", rotulo: `Leitura pela IA — ${rotuloDaPrancha(passo)}`, estado: "pendente", doc: passo.doc, pagina: passo.pagina, motivoIA: motivo };
  estado.passos.splice(final < 0 ? estado.passos.length : final, 0, novo);
}

export const mensagemSemChave = (motivo: string | null | undefined) => motivo === MOTIVOS_IA.imagem
  ? "Esta prancha é uma imagem e precisa da leitura por IA; cadastre a chave em Integrações → Anthropic (ou envie o PDF exportado do programa de desenho)."
  : `O leitor próprio não leu bem esta prancha (${motivo ?? "leitura insuficiente"}) e ela precisa da leitura por IA; cadastre a chave em Integrações → Anthropic (ou envie o PDF exportado do programa de desenho).`;

/**
 * Passo "prancha_ia". Sem chave ou sem a confirmação do custo, o passo fica "aguardando" (não é erro): o pedido,
 * o pagamento e os passos feitos ficam como estão e a leitura retoma deste passo. Tempo esgotado ou IA
 * sobrecarregada: erro do passo, que pode ser repetido.
 */
export async function passoPranchaIA(m: Maquete3d, estado: EstadoLeitura, passo: PassoLeitura, config: ConfigMaquete, confirmada: boolean): Promise<"feito" | "aguardando"> {
  const inicio = Date.now();
  const credencial = await dependencias().credencialIA();
  const pendentes = estado.passos.filter(p => p.tipo === "prancha_ia" && p.estado !== "feito").length;
  if (!credencial) { Object.assign(passo, { estado: "aguardando", aguardando: "chave", erro: mensagemSemChave(passo.motivoIA) }); return "aguardando"; }
  if (!confirmada) {
    Object.assign(passo, { estado: "aguardando", aguardando: "confirmacao", erro: `${pendentes} prancha(s) precisam da leitura por IA (paga, modelo ${modeloDaLeitura(credencial, config)}). Um administrador confirma uma vez para esta maquete.` });
    return "aguardando";
  }
  const chaveGeo = `prancha:${passo.doc}:${passo.pagina}`;
  const geo = estado.parciais[chaveGeo] as PranchaLida | undefined;
  const { d, dados } = await bytesDoDocumento(m, passo.doc!);
  let total = 1;
  const pdf = await dependencias().abrirPdf(dados).catch(() => null);
  if (pdf) { total = pdf.paginas; await pdf.fechar(); }
  const { anexo, envio } = anexoDaPagina(dados, d.nome, passo.pagina!, total);
  const imagem = (!!geo && geo.diagnostico.segmentos < 40 && geo.diagnostico.imagens > 0) || envio !== "pdf_original";
  const r = await dependencias().ia({
    sistema: SISTEMA, pedido: PEDIDO_PRANCHA(d.nome, passo.pagina!, envio, imagem), pdfs: [], anexos: [anexo],
    esquema: ESQUEMA_PRANCHA, config, credencial, prazoMs: LIMITE_PASSO_MS - (Date.now() - inicio) - 2_000,
  });
  const plantas = plantasDaIA(r.json, imagem);
  const recusa = ((r.json as { pendencias?: string[] } | null)?.pendencias ?? []).slice(0, 2).map(t => ` ${t}`).join("");
  estado.parciais[chaveGeo] = {
    doc: passo.doc!, pagina: passo.pagina!, plantas,
    diagnostico: {
      ...(geo?.diagnostico ?? { segmentos: 0, arcos: 0, textos: 0, imagens: 0, escalas: [] }), plantas: plantas.length, avisos: [], lidaPor: "ia",
      motivo: plantas.length ? null : `A IA não encontrou planta baixa de pavimento nesta prancha.${recusa}`,
    },
  } satisfies PranchaLida;
  estado.tokensEntrada += r.entrada;
  estado.tokensSaida += r.saida;
  Object.assign(passo, { motor: "ia", modelo: r.modelo ?? modeloDaLeitura(credencial, config), tokens: { entrada: r.entrada, saida: r.saida }, aguardando: null, envio });
  return "feito";
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
export function parciaisDasPranchas(pranchas: PranchaLida[], nomesDosArquivos: string[]): { parciais: Record<string, unknown>; referencias: { pavimentoId: string; doc: number; pagina: number; alinhamento: { x: number; y: number; larguraM: number } | null }[]; motivos: string[] } {
  type Candidata = { planta: PlantaLida; doc: number; pagina: number; nome: string; andar: number | null; numero?: number; tipo?: boolean; semAndar: boolean; avisos: string[] };
  const candidatas: Candidata[] = [];
  for (const pr of pranchas) for (const planta of pr.plantas) {
    const { nome, andar, numero, tipo } = nomeDoPavimento(planta.titulo, candidatas.length);
    candidatas.push({ planta, doc: pr.doc, pagina: pr.pagina, nome, andar, numero, tipo, semAndar: andar === null && !tipo, avisos: [] });
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
    referencias.push({ pavimentoId: id, doc: c.doc, pagina: c.pagina, alinhamento: k > 0 ? { x: -c.planta.origemPt.x * k, y: -c.planta.origemPt.y * k, larguraM: c.planta.larguraDaPaginaM } : null });
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

const emLeitura = (id: number) => and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt), inArray(maquetes3d.status, [...PODE_LER]));

async function buscar(id: number): Promise<Maquete3d | null> {
  const [m] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt))).limit(1);
  return m ?? null;
}

/** Começa (ou recomeça do zero) a leitura. Recomeçar descarta a planta já revisada. */
export async function iniciarLeitura(id: number): Promise<EstadoLeitura> {
  const atual = await buscar(id);
  const anterior = lerModelo(atual?.modelo);
  // A planta que ler de novo apaga fica no histórico (EPIC-024 S-05): pode ser restaurada depois.
  if (atual && PODE_LER.includes(atual.status as StatusMaquete)) await guardarAnterior(atual, "Planta antes de ler o projeto de novo do zero");
  const estado: EstadoLeitura = {
    // A confirmação do custo da IA vale para a maquete: ler de novo não pergunta outra vez.
    ...leituraVazia(), iniciadaEm: agora().toISOString(), confirmacaoIA: lerEstadoLeitura(atual?.leitura).confirmacaoIA ?? null,
    parciais: anterior?.implantacao?.lotes.some(l => l.unidade) ? { implantacaoDoEstudo: anterior.implantacao } : {},
    passos: [{ chave: "inventario", tipo: "inventario", rotulo: "Inventário das pranchas e dos pavimentos", estado: "pendente" }],
  };
  const r = await db().update(maquetes3d)
    .set({ status: "em_leitura" satisfies StatusMaquete, leitura: JSON.stringify(estado), modelo: null, revisadoPor: null, revisadoEm: null, updatedAt: agora() })
    .where(emLeitura(id)).returning({ id: maquetes3d.id });
  if (!r.length) throw new LeituraIndisponivel("Esta maquete não está liberada para leitura.");
  return estado;
}

/** Executa o próximo passo pendente e grava o resultado. Devolve o estado atualizado. */
export async function avancarLeitura(id: number, autorId: number | null = null): Promise<{ estado: EstadoLeitura; status: StatusMaquete }> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  const passo = estado.passos.find(p => p.estado !== "feito");
  if (!passo) return { estado, status: m.status as StatusMaquete };

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
      await passoPrancha(m, estado, passo, motor, config);
    } else if (passo.tipo === "prancha_ia") {
      aguardando = (await passoPranchaIA(m, estado, passo, config, !!estado.confirmacaoIA)) === "aguardando";
    } else if (passo.tipo === "montagem" && estado.passos.some(p => p.tipo === "prancha")) {
      const pranchas = estado.passos.filter(p => p.tipo === "prancha").map(p => estado.parciais[p.chave] as PranchaLida | undefined).filter((p): p is PranchaLida => !!p);
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
      const credencial = await dependencias().credencialIA().catch(() => null);
      const r = await dependencias().ia({ sistema: SISTEMA, pedido, pdfs, esquema, config, credencial });
      estado.tokensEntrada += r.entrada;
      estado.tokensSaida += r.saida;
      estado.parciais[passo.chave] = r.json;
      Object.assign(passo, { motor: "ia", modelo: r.modelo ?? modeloDaLeitura(credencial, config), tokens: { entrada: r.entrada, saida: r.saida } });
      if (passo.tipo === "inventario") {
        const lido = r.json as Inventario;
        if (!lido.edificacoes?.some(e => e.pavimentos.length) && !lido.implantacao && !estado.parciais.implantacaoDoEstudo) {
          throw new LeituraIndisponivel("Nenhuma planta baixa nem implantação foi encontrada nos arquivos escolhidos.");
        }
        lido.edificacoes = lido.edificacoes.filter(e => e.pavimentos.length);
        estado.passos = [{ ...passo, estado: "feito", erro: null }, ...passosDoInventario(lido)];
      }
    }
    if (!aguardando) {
      const atual = estado.passos.find(p => p.chave === passo.chave)!;
      atual.estado = "feito";
      atual.erro = null;
      atual.aguardando = null;
    }
  } catch (e) {
    const atual = estado.passos.find(p => p.chave === passo.chave)!;
    atual.estado = "erro";
    atual.erro = erroSeguro(e);
  }

  const gravado = await db().update(maquetes3d)
    .set({ leitura: JSON.stringify(estado), status, updatedAt: agora(), ...(modelo ? { modelo, modeloVersao: m.modeloVersao + 1 } : {}) })
    .where(and(eq(maquetes3d.id, id), eq(maquetes3d.status, "em_leitura"))).returning({ id: maquetes3d.id });
  if (modelo && gravado.length) await registrarRevisao({ maqueteId: id, versao: m.modeloVersao + 1, modelo, origem: "leitura", motivo: "Planta lida dos PDFs do pedido", autorId });
  return { estado, status };
}

/** O administrador confirma o custo da IA (uma vez por maquete); os passos parados na confirmação voltam a andar. */
export async function confirmarIA(id: number, userId: number): Promise<EstadoLeitura> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  estado.confirmacaoIA = { em: agora().toISOString(), por: userId, pranchas: estado.passos.filter(p => p.tipo === "prancha_ia" && p.estado !== "feito").length };
  for (const p of estado.passos) if (p.estado === "aguardando" && p.aguardando === "confirmacao") Object.assign(p, { estado: "pendente", aguardando: null, erro: null });
  await db().update(maquetes3d).set({ leitura: JSON.stringify(estado), updatedAt: agora() }).where(and(eq(maquetes3d.id, id), eq(maquetes3d.status, "em_leitura")));
  return estado;
}

/** Segue sem a IA: as pranchas que iriam para ela ficam com o que o leitor próprio leu (e isso fica dito no passo). */
export async function pularIA(id: number): Promise<EstadoLeitura> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  for (const p of estado.passos) if (p.tipo === "prancha_ia" && p.estado !== "feito") Object.assign(p, { estado: "feito", motor: "pulada", aguardando: null, erro: null });
  await db().update(maquetes3d).set({ leitura: JSON.stringify(estado), updatedAt: agora() }).where(and(eq(maquetes3d.id, id), eq(maquetes3d.status, "em_leitura")));
  return estado;
}
