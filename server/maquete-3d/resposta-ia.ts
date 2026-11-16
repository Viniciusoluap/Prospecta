// Maquete 3D (EPIC-024 S-03, correções do QA) — a resposta da IA para UMA prancha, conferida antes de entrar na
// leitura. A saída estruturada da API não basta: o que vier fora do formato é descartado item a item (com pendência
// visível, nunca em silêncio), e a geometria absurda também (cômodo com menos de 3 pontos ou de área ~0, coordenada
// fora da escala de uma construção, parede de comprimento ~0, abertura sem parede, cômodo repetido por cima de outro).
// Nada aqui lança: resposta inteira inválida vira "nenhuma planta" com o motivo, e quem chama mantém o leitor próprio.
import { z } from "zod";
import { FUNCOES_COMODO, TIPOS_ABERTURA, TIPOS_ESCADA, areaPoligono, type Ponto } from "../../shared/maquete-3d/modelo.js";
import { dentroDoPoligono } from "../../shared/maquete-3d/geometria3d.js";
import type { PlantaLida } from "./geometrico.js";

/** Coordenada maior que isto (m) não é de uma planta de pavimento: está fora da escala. */
export const COORDENADA_MAX_M = 500;
/** Cômodo ou escada com área menor que isto (m²) é um traço, não um ambiente. */
export const AREA_MIN_M2 = 0.3;
/** Dois cômodos que se cobrem mais que isto (fração da área do menor) estão um por cima do outro. */
export const SOBREPOSICAO_MAX = 0.6;
/**
 * Só é "o mesmo cômodo desenhado duas vezes" quando, além de se cobrirem, as áreas forem parecidas (menor/maior a
 * partir disto) e a função ou o nome forem os mesmos. Closet dentro da suíte e cozinha dentro de "Sala/Cozinha"
 * ficam os dois, com pendência para conferir (QA rodada 2, N4).
 */
export const RAZAO_AREA_REPETIDO = 0.7;

/** Lado maior que isto (m) não é de um pavimento comum: as medidas podem ter vindo em centímetros (QA rodada 2, N5). */
export const LADO_MAX_PAVIMENTO_M = 80;
/** Área desenhada / área escrita fora desta faixa (fator 2 no lado) indica unidade ou escala errada. */
export const RAZAO_AREA_MAX = 4;

const m2 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("pt-BR");
/**
 * Unidade ou escala errada na resposta da IA (centímetros tomados como metros, por exemplo): compara a área
 * desenhada com a área escrita na prancha (mediana dos cômodos com área escrita) e o tamanho do pavimento. Na dúvida,
 * devolve o texto da pendência — que fica visível e impede a validação até a pessoa acertar a escala. Nunca corrige
 * em silêncio.
 */
export function medidaSuspeita(comodos: { pontos: Ponto[]; areaInformada: number | null }[], largura: number, comprimento: number): string | null {
  const comArea = comodos.filter(c => typeof c.areaInformada === "number" && c.areaInformada > 0);
  if (comArea.length) {
    const razoes = comArea.map(c => areaPoligono(c.pontos) / c.areaInformada!).sort((a, b) => a - b);
    const mediana = razoes[Math.floor(razoes.length / 2)];
    if (mediana > RAZAO_AREA_MAX || mediana < 1 / RAZAO_AREA_MAX) {
      const desenhada = comArea.reduce((t, c) => t + areaPoligono(c.pontos), 0), escrita = comArea.reduce((t, c) => t + c.areaInformada!, 0);
      const lado = Math.sqrt(mediana);
      const unidade = lado > 70 && lado < 140 ? " (parece que as medidas vieram em centímetros)" : lado > 7 && lado < 14 ? " (parece que as medidas vieram em decímetros)" : "";
      return `As medidas lidas pela IA não batem com as áreas escritas na prancha: os cômodos desenhados somam ${m2(desenhada)} m² e as áreas escritas, ${m2(escrita)} m²${unidade}. Acerte a escala na revisão (com uma cota conhecida) e confira a planta antes de validar.`;
    }
  }
  const lado = Math.max(largura, comprimento);
  if (lado > LADO_MAX_PAVIMENTO_M) {
    return `A planta lida pela IA tem ${m2(lado)} m de lado, grande demais para um pavimento: as medidas podem ter vindo em centímetros ou fora de escala. Acerte a escala na revisão (com uma cota conhecida) e confira a planta antes de validar.`;
  }
  return null;
}

const nomeNormal = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Mesmo cômodo repetido (e não um cômodo dentro de outro): áreas parecidas e a mesma função ou o mesmo nome. */
export function comodoRepetido(a: { nome: string; funcao: string; pontos: Ponto[] }, b: { nome: string; funcao: string; pontos: Ponto[] }): boolean {
  const aa = areaPoligono(a.pontos), ab = areaPoligono(b.pontos);
  const razao = Math.min(aa, ab) / Math.max(aa, ab || 1);
  const mesmoNome = !!nomeNormal(a.nome) && nomeNormal(a.nome) === nomeNormal(b.nome);
  return razao >= RAZAO_AREA_REPETIDO && (a.funcao === b.funcao || mesmoNome);
}

const num = z.number().finite();
const id = z.string().trim().min(1).max(40);
const pontoZ = z.object({ x: num, y: num });
const paredeZ = z.object({ id, ax: num, ay: num, bx: num, by: num, espessura: num, externa: z.boolean(), confirmada: z.boolean() });
const aberturaZ = z.object({
  id, paredeId: id, tipo: z.enum(TIPOS_ABERTURA), posicao: num, largura: num, altura: num, peitoril: num, entradaPrincipal: z.boolean(), confirmada: z.boolean(),
});
const comodoZ = z.object({ id, nome: z.string().max(200), funcao: z.enum(FUNCOES_COMODO), pontos: z.array(pontoZ).max(200), areaInformada: num.nullable(), confirmada: z.boolean() });
const escadaZ = z.object({
  id, tipo: z.enum(TIPOS_ESCADA), pontos: z.array(pontoZ).max(200), inicio: pontoZ, fim: pontoZ, percurso: z.array(pontoZ).max(200),
  largura: num, degraus: z.number().int().nullable(), confirmada: z.boolean(),
});
const plantaZ = z.object({
  titulo: z.string().max(400).catch(""), escala: num.catch(0), escalaLegivel: z.boolean().catch(false), temCotas: z.boolean().catch(false),
  paredes: z.array(z.unknown()).catch([]), aberturas: z.array(z.unknown()).catch([]), comodos: z.array(z.unknown()).catch([]),
  escadas: z.array(z.unknown()).catch([]), pendencias: z.array(z.unknown()).catch([]),
});
const respostaZ = z.object({ plantas: z.array(z.unknown()), pendencias: z.array(z.unknown()).catch([]) });

type Parede = z.infer<typeof paredeZ>;
type Comodo = z.infer<typeof comodoZ>;

const foraDeEscala = (pts: Ponto[]) => pts.some(p => Math.abs(p.x) > COORDENADA_MAX_M || Math.abs(p.y) > COORDENADA_MAX_M);
const textos = (v: unknown[]) => v.filter((t): t is string => typeof t === "string" && !!t.trim()).map(t => t.slice(0, 300));

/** Fração da área do menor polígono coberta pelo outro (amostragem numa grade: barato e sem biblioteca). */
export function sobreposicao(a: Ponto[], b: Ponto[]): number {
  const [menor, maior] = areaPoligono(a) <= areaPoligono(b) ? [a, b] : [b, a];
  const xs = menor.map(p => p.x), ys = menor.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const N = 16;
  let dentro = 0, ambos = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = { x: x0 + ((i + 0.5) / N) * (x1 - x0), y: y0 + ((j + 0.5) / N) * (y1 - y0) };
    if (!dentroDoPoligono(p, menor)) continue;
    dentro++;
    if (dentroDoPoligono(p, maior)) ambos++;
  }
  return dentro ? ambos / dentro : 0;
}

/** Itens de uma lista que passam no esquema; os demais são contados. */
function validos<T>(lista: unknown[], esquema: z.ZodType<T>, max: number): { itens: T[]; fora: number; cortados: number } {
  const itens: T[] = [];
  let fora = 0;
  for (const v of lista) { const r = esquema.safeParse(v); if (r.success) itens.push(r.data); else fora++; }
  return { itens: itens.slice(0, max), fora, cortados: Math.max(0, itens.length - max) };
}

/** Uma planta da IA conferida: o que sobrou e as pendências do que foi descartado. */
function conferirPlanta(bruta: z.infer<typeof plantaZ>) {
  const pendencias: string[] = textos(bruta.pendencias);
  const avisar = (n: number, texto: string) => { if (n > 0) pendencias.push(texto.replace("{n}", String(n))); };

  const paredes = validos(bruta.paredes, paredeZ, 800), aberturas = validos(bruta.aberturas, aberturaZ, 800);
  const comodos = validos(bruta.comodos, comodoZ, 300), escadas = validos(bruta.escadas, escadaZ, 20);
  const fora = paredes.fora + aberturas.fora + comodos.fora + escadas.fora;
  avisar(fora, "A IA devolveu {n} item(ns) fora do formato esperado nesta planta (parede, abertura, cômodo ou escada): foram descartados. Confira a planta sobre a prancha ao fundo e desenhe o que faltar.");
  avisar(paredes.cortados + aberturas.cortados + comodos.cortados + escadas.cortados, "A IA devolveu mais elementos do que uma planta comporta: {n} item(ns) passaram do limite e foram descartados. Confira na revisão.");

  // Geometria absurda.
  const nomeDe = (c: Comodo) => c.nome.trim() || c.id;
  const paredesOk = paredes.itens.filter((w: Parede) => {
    const pts = [{ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }];
    return !foraDeEscala(pts) && Math.hypot(w.bx - w.ax, w.by - w.ay) >= 0.05;
  });
  avisar(paredes.itens.length - paredesOk.length, "A IA devolveu {n} parede(s) de comprimento quase zero ou fora da escala da planta: foram descartadas. Confira as paredes na revisão.");
  const idsParede = new Set(paredesOk.map(w => w.id));
  const aberturasOk = aberturas.itens.filter(a => idsParede.has(a.paredeId));
  avisar(aberturas.itens.length - aberturasOk.length, "A IA devolveu {n} abertura(s) numa parede que não existe (ou foi descartada): foram descartadas. Confira portas e janelas na revisão.");

  const comodosOk: Comodo[] = [];
  for (const c of comodos.itens) {
    const problema = c.pontos.length < 3 ? "tem menos de 3 pontos"
      : foraDeEscala(c.pontos) ? "tem coordenadas fora da escala de uma planta"
      : areaPoligono(c.pontos) < AREA_MIN_M2 ? "tem área quase zero"
      : null;
    if (problema) { pendencias.push(`O cômodo "${nomeDe(c)}" lido pela IA ${problema} e foi descartado: desenhe-o na revisão, se existir.`); continue; }
    const porCima = comodosOk.filter(o => sobreposicao(o.pontos, c.pontos) > SOBREPOSICAO_MAX);
    const igual = porCima.find(o => comodoRepetido(o, c));
    if (igual) { pendencias.push(`O cômodo "${nomeDe(c)}" lido pela IA repete "${nomeDe(igual)}" (mesma função e quase a mesma área, um por cima do outro) e foi descartado. Confira na revisão.`); continue; }
    // Cômodo dentro de outro (closet na suíte, cozinha em "Sala/Cozinha"): os dois ficam, com pendência para conferir.
    for (const o of porCima) pendencias.push(`O cômodo "${nomeDe(c)}" lido pela IA fica dentro de "${nomeDe(o)}" (ou por cima dele): os dois foram mantidos. Confira na revisão se um está mesmo dentro do outro.`);
    comodosOk.push(c);
  }
  const escadasOk = escadas.itens.filter(e => e.pontos.length >= 3 && !foraDeEscala([...e.pontos, e.inicio, e.fim, ...e.percurso]) && areaPoligono(e.pontos) >= AREA_MIN_M2);
  avisar(escadas.itens.length - escadasOk.length, "A IA devolveu {n} escada(s) sem contorno válido ou fora da escala: foram descartadas. Desenhe a escada na revisão.");

  return { paredes: paredesOk, aberturas: aberturasOk, comodos: comodosOk, escadas: escadasOk, pendencias };
}

/**
 * Resposta da IA no formato do leitor próprio, para a montagem ser a mesma. Nada é inventado: sem cota escrita, nada
 * fica confirmado; sem escala legível, pendência pedindo para acertar uma medida conhecida na revisão.
 * `motivo`: por que não veio nenhuma planta (resposta fora do formato), para quem chama manter o leitor próprio.
 */
export function lerRespostaPrancha(json: unknown, imagem: boolean): { plantas: PlantaLida[]; gerais: string[]; motivo: string | null } {
  const r = respostaZ.safeParse(json);
  if (!r.success) return { plantas: [], gerais: [], motivo: "A IA devolveu uma resposta fora do formato esperado." };
  const gerais = textos(r.data.pendencias);
  const brutas = r.data.plantas.map(p => plantaZ.safeParse(p));
  const plantas = brutas.filter(b => b.success).map((b, i): PlantaLida => {
    const p = b.data!;
    const c = conferirPlanta(p);
    const semCota = !p.temCotas;
    const confirmada = (v: boolean) => v === true && !semCota;
    const pts = [...c.paredes.flatMap(w => [{ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }]), ...c.comodos.flatMap(x => x.pontos)];
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    const largura = xs.length ? Math.max(...xs) - Math.min(...xs) : 0, comprimento = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    const suspeita = medidaSuspeita(c.comodos, largura, comprimento);
    const pendencias = [...(suspeita ? [suspeita] : []), ...c.pendencias, ...(i === 0 ? gerais : [])];
    if (!p.escalaLegivel) pendencias.push("A escala não está escrita de forma legível na prancha: as medidas são estimadas pela IA. Na revisão, acerte uma medida conhecida (uma cota, a largura de uma porta) e confira as demais.");
    if (imagem) pendencias.push(`Planta lida pela IA a partir de uma imagem${semCota ? ", sem cotas legíveis" : ""}: confira paredes, aberturas e cômodos sobre a prancha ao fundo antes de validar.`);
    return {
      titulo: p.titulo.slice(0, 120), escala: p.escalaLegivel && p.escala > 0 ? Math.round(p.escala) : 0, escalaOrigem: p.escalaLegivel && p.escala > 0 ? "texto" : "suposta",
      origemPt: { x: 0, y: 0 }, metrosPorPonto: 0, larguraDaPaginaM: 0, largura, comprimento,
      paredes: c.paredes.map(w => ({ ...w, confirmada: confirmada(w.confirmada) })),
      aberturas: c.aberturas.map(a => ({ ...a, confirmada: confirmada(a.confirmada) })) as PlantaLida["aberturas"],
      comodos: c.comodos.map(x => ({ ...x, nome: x.nome.slice(0, 80), confirmada: confirmada(x.confirmada) })),
      escadas: c.escadas.map(e => ({ ...e, percurso: e.percurso.slice(0, 60), sobePara: "", degraus: e.degraus ?? 0, confirmada: confirmada(e.confirmada) })) as unknown as PlantaLida["escadas"],
      pendencias, nomeados: c.comodos.filter(x => x.nome.trim()).length, razaoAreas: null, vista: "planta",
    };
  });
  // Planta que ficou sem nenhuma parede nem cômodo válido não vira pavimento vazio.
  const cheias = plantas.filter(p => p.paredes.length || p.comodos.length);
  const descartadas = brutas.length - cheias.length;
  const vazias = plantas.filter(p => !p.paredes.length && !p.comodos.length).flatMap(p => p.pendencias).filter(t => /descartad/.test(t)).slice(0, 3);
  if (descartadas && cheias.length) cheias[0].pendencias.push(`A IA devolveu ${descartadas} planta(s) fora do formato esperado ou sem nenhum elemento válido nesta prancha: foram descartadas. Confira se falta algum pavimento.`, ...vazias);
  return {
    plantas: cheias, gerais,
    motivo: cheias.length ? null : descartadas ? `A IA devolveu a planta fora do formato esperado ou sem nenhum elemento válido.${vazias.length ? ` ${vazias.join(" ")}` : ""}` : null,
  };
}
