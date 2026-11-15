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
  FUNCOES_COMODO, TIPOS_ABERTURA, TIPOS_COBERTURA, TIPOS_ESCADA, lerModelo, modeloSchema, type Edificacao, type Implantacao,
  type ModeloMaquete, type OrigemMedida, type Pavimento, type TipoMaquete,
} from "../../shared/maquete-3d/modelo.js";
import {
  MAX_BYTES_DOCUMENTOS, PODE_LER, TIPOS_PRANCHA, documentoSchema, leituraVazia, lerEstadoLeitura, type DocumentoMaquete,
  type EstadoLeitura, type PassoLeitura, type StatusMaquete,
} from "../../shared/maquete-3d/regras.js";
import { LeituraIndisponivel, agora, carregarConfig, db, dependencias, erroSeguro, type PdfLido } from "./base.js";

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
    id: texto, tipo: umDe(TIPOS_ESCADA), pontos: lista(pontoJson), inicio: pontoJson, fim: pontoJson, largura: numero,
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
- "escadas": cada escada ou rampa, com o contorno em "pontos", o ponto "inicio" (onde se pisa neste pavimento) e "fim" (onde chega no pavimento de cima), a largura, o número de degraus se estiver indicado, e "sobePara" com o nome exato do pavimento de destino entre: ${pavimentos.map(n => `"${n}"`).join(", ") || "(nenhum outro pavimento)"}. Registre a escada só no pavimento de onde ela parte para cima. Ids: e1, e2, ...`;

const PEDIDO_IMPLANTACAO = (doc: number, pagina: number, edificacoes: string[]) => `Leia a planta de implantação que está no arquivo ${doc}, página ${pagina}.

Use um sistema próprio: origem (0, 0) no canto superior esquerdo do retângulo que envolve o terreno, x para a direita, y para baixo, em metros.
- "terreno": contorno do terreno.
- "vias": cada rua interna, com o eixo (sequência de pontos) e a largura da caixa.
- "lotes": cada lote com nome/número, quadra, contorno e área escrita (ou null). Ids: l1, l2, ...
- "posicoes": cada construção desenhada no terreno: "edificacao" é o nome exato de uma destas: ${edificacoes.map(n => `"${n}"`).join(", ") || "(nenhuma)"}; "x" e "y" são a posição do canto superior esquerdo da construção; "rotacao" em graus, sentido horário. Ids: i1, i2, ...
Se a prancha tiver lotes demais para listar com segurança, liste os que conseguir ler com precisão e registre o restante em "pendencias".`;

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
  const alvoId = (m.origem === "projeto" ? m.projectId : m.studyId)!;
  const pdfs: PdfLido[] = [];
  let total = 0;
  for (const d of docs) {
    const dados = await dependencias().lerPdf(d, alvoId);
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
      terreno: imp.terreno as never, vias: imp.vias as never, ruas: [],
      lotes: imp.lotes.map(l => ({ id: String(l.id), nome: String(l.nome ?? ""), quadra: String(l.quadra ?? ""), poligono: l.pontos as never, areaInformada: typeof l.areaInformada === "number" && l.areaInformada > 0 ? l.areaInformada : null, tipo: "vendavel" as const, unidade: null })),
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

// ── Execução ──

const emLeitura = (id: number) => and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt), inArray(maquetes3d.status, [...PODE_LER]));

async function buscar(id: number): Promise<Maquete3d | null> {
  const [m] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt))).limit(1);
  return m ?? null;
}

/** Começa (ou recomeça do zero) a leitura. Recomeçar descarta a planta já revisada. */
export async function iniciarLeitura(id: number): Promise<EstadoLeitura> {
  const anterior = lerModelo((await buscar(id))?.modelo);
  const estado: EstadoLeitura = {
    ...leituraVazia(), iniciadaEm: agora().toISOString(),
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
export async function avancarLeitura(id: number): Promise<{ estado: EstadoLeitura; status: StatusMaquete }> {
  const m = await buscar(id);
  if (!m || m.status !== "em_leitura") throw new LeituraIndisponivel("Não há leitura em andamento para esta maquete.");
  const estado = lerEstadoLeitura(m.leitura);
  const passo = estado.passos.find(p => p.estado !== "feito");
  if (!passo) return { estado, status: m.status as StatusMaquete };

  let status: StatusMaquete = "em_leitura";
  let modelo: string | undefined;
  try {
    if (passo.tipo === "montagem") {
      modelo = JSON.stringify(montarModelo(m.tipo as TipoMaquete, estado.parciais));
      estado.concluidaEm = agora().toISOString();
      status = "em_revisao";
    } else {
      const [config, pdfs] = await Promise.all([carregarConfig(), carregarPdfs(m)]);
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
      const r = await dependencias().ia({ sistema: SISTEMA, pedido, pdfs, esquema, config });
      estado.tokensEntrada += r.entrada;
      estado.tokensSaida += r.saida;
      estado.parciais[passo.chave] = r.json;
      if (passo.tipo === "inventario") {
        const lido = r.json as Inventario;
        if (!lido.edificacoes?.some(e => e.pavimentos.length) && !lido.implantacao && !estado.parciais.implantacaoDoEstudo) {
          throw new LeituraIndisponivel("Nenhuma planta baixa nem implantação foi encontrada nos arquivos escolhidos.");
        }
        lido.edificacoes = lido.edificacoes.filter(e => e.pavimentos.length);
        estado.passos = [{ ...passo, estado: "feito", erro: null }, ...passosDoInventario(lido)];
      }
    }
    const atual = estado.passos.find(p => p.chave === passo.chave)!;
    atual.estado = "feito";
    atual.erro = null;
  } catch (e) {
    const atual = estado.passos.find(p => p.chave === passo.chave)!;
    atual.estado = "erro";
    atual.erro = erroSeguro(e);
  }

  await db().update(maquetes3d)
    .set({ leitura: JSON.stringify(estado), status, updatedAt: agora(), ...(modelo ? { modelo, modeloVersao: m.modeloVersao + 1 } : {}) })
    .where(and(eq(maquetes3d.id, id), eq(maquetes3d.status, "em_leitura")));
  return { estado, status };
}
