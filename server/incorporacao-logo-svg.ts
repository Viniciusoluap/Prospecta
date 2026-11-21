// EPIC-027 C8 (21/11) — limpeza do SVG do logotipo, a MESMA para o arquivo enviado e para o SVG escrito pela IA.
// SVG é conteúdo não confiável: só fica o que está na lista do que é desenho (lista de permissão, não de proibição).
// - recusa: maior que o limite, mais de um elemento raiz ou raiz que não é <svg>, XML malformado, entidades (<!ENTITY)
//   e DOCTYPE com declarações internas;
// - remove: DOCTYPE simples, instruções de processamento (ex.: <?xml-stylesheet?>), comentários, <script>,
//   <foreignObject>, animações (<set>/<animate> podem trocar um href), <a>, metadados de editores e qualquer elemento
//   fora da lista; atributos on*, href/xlink:href que não seja âncora interna (#id) — em <image>, só imagem embutida
//   PNG/JPG/GIF/WebP —, qualquer valor com javascript:/vbscript:, url(...) que não seja #id, @import e expression().
// Portão de QA (21/11), defesa em profundidade:
// - recusa antes do parse quando há mais de LIMITE_NOS_SVG elementos (conta barata, linear), e durante a limpeza quando o
//   aninhamento passa de LIMITE_PROFUNDIDADE_SVG níveis — nunca estoura a pilha (erro 500);
// - em <style> e em qualquer atributo (inclusive style=) sai o valor com "\" (escape de CSS), @import, image-set(),
//   -webkit-image-set(), src(), expression() ou url(...) que não seja #id. O <style> continua aceito porque SVG exportado
//   por editores (Illustrator, Figma) pinta por classe; o prompt da IA pede só atributos de apresentação;
// - "bomba de <use>": mais de LIMITE_USE_SVG <use> ou <use> apontando para algo que contém outro <use> → recusa.
// O que é exibido continua sendo o PNG gerado no navegador a partir deste SVG (um <img> não executa script).
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Limite do SVG devolvido pela IA. */
export const LIMITE_SVG_IA_BYTES = 200 * 1024;

const ELEMENTOS = new Set([
  "svg", "g", "defs", "title", "desc", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker", "image",
  "style", "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite", "feFlood", "feMerge",
  "feMergeNode", "feDropShadow", "feMorphology",
]);
/** Elementos que só fazem sentido apontando para algo: sem href aceito, saem. */
const PRECISAM_DE_HREF = new Set(["use", "image", "textPath"]);
const IMAGEM_EMBUTIDA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const ANCORA = /^#[\w.:-]+$/;
const VALOR_PERIGOSO = /(java|vb)script\s*:|expression\s*\(|@import|behavior\s*:|-moz-binding|image-set\s*\(|\bsrc\s*\(|\\/i;

/** Mais elementos que isto: recusado antes do parse. */
export const LIMITE_NOS_SVG = 5_000;
/** Aninhamento máximo de elementos. */
export const LIMITE_PROFUNDIDADE_SVG = 64;
/** Quantidade máxima de <use>. */
export const LIMITE_USE_SVG = 50;

export class SvgRecusado extends Error {}

/** Todo url(...) do texto aponta para uma âncora interna (#id)? */
function soUrlsInternas(texto: string): boolean {
  const urls = Array.from(texto.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi));
  if (urls.some(m => !ANCORA.test(m[2].trim()))) return false;
  // "url(" sem fechar direito também não passa
  return (texto.match(/url\s*\(/gi)?.length ?? 0) === urls.length;
}

function valorSeguro(valor: string): boolean {
  // entidades numéricas já foram resolvidas pelo parser; tira espaços e controles que separam "java script:"
  const compacto = valor.replace(/[\u0000- ]+/g, "");
  if (VALOR_PERIGOSO.test(valor) || VALOR_PERIGOSO.test(compacto)) return false;
  return soUrlsInternas(valor);
}

type No = { nodeType: number; childNodes: ArrayLike<No>; parentNode: No | null; removeChild(n: No): void };
type Elemento = No & {
  localName: string; namespaceURI: string | null; tagName: string;
  attributes: ArrayLike<{ name: string; localName: string; namespaceURI: string | null; value: string }>;
  removeAttribute(n: string): void; removeAttributeNS(ns: string | null, n: string): void;
  getAttribute(n: string): string | null; setAttribute(n: string, v: string): void;
  textContent: string | null;
};

function limparElemento(el: Elemento) {
  for (const a of Array.from(el.attributes)) {
    const nome = a.name.toLowerCase();
    const local = (a.localName || a.name).toLowerCase();
    const remover = () => (a.namespaceURI ? el.removeAttributeNS(a.namespaceURI, a.localName) : el.removeAttribute(a.name));
    if (nome === "xmlns" || nome === "xmlns:xlink") continue;
    if (nome.startsWith("xmlns:")) { remover(); continue; }
    if (local.startsWith("on")) { remover(); continue; }
    if (local === "href" && (a.namespaceURI === XLINK_NS || !a.namespaceURI)) {
      const v = a.value.trim();
      const ok = ANCORA.test(v) || (el.localName === "image" && IMAGEM_EMBUTIDA.test(v));
      if (!ok) remover();
      continue;
    }
    // atributo de outro espaço de nomes (sodipodi:, inkscape:, xml:base…), exceto xml:space e xml:lang
    if (a.namespaceURI && !(nome === "xml:space" || nome === "xml:lang")) { remover(); continue; }
    if (nome.includes(":") && !(nome === "xml:space" || nome === "xml:lang")) { remover(); continue; }
    if (!valorSeguro(a.value)) remover();
  }
  if (PRECISAM_DE_HREF.has(el.localName) && !el.getAttribute("href") && !el.getAttribute("xlink:href")) {
    el.parentNode?.removeChild(el);
    return false;
  }
  if (el.localName === "style" && !valorSeguro(el.textContent ?? "")) {
    el.parentNode?.removeChild(el);
    return false;
  }
  return true;
}

/** Limpa os filhos de `no`; `profundidade` é o nível de `no` (raiz = 1). Recursão limitada por LIMITE_PROFUNDIDADE_SVG. */
function limparFilhos(no: No, profundidade: number, conta: { nos: number; uses: Elemento[]; elementos: Elemento[] }) {
  for (const filho of Array.from(no.childNodes)) {
    if (filho.nodeType === 1) {
      const el = filho as Elemento;
      const doSvg = el.namespaceURI === SVG_NS || el.namespaceURI === null;
      if (!doSvg || !ELEMENTOS.has(el.localName)) { no.removeChild(filho); continue; }
      if (profundidade + 1 > LIMITE_PROFUNDIDADE_SVG)
        throw new SvgRecusado(`O SVG tem elementos aninhados demais (mais de ${LIMITE_PROFUNDIDADE_SVG} níveis). Exporte o desenho de novo, achatando os grupos.`);
      if (++conta.nos > LIMITE_NOS_SVG) throw new SvgRecusado(`O SVG tem elementos demais (mais de ${LIMITE_NOS_SVG}).`);
      if (limparElemento(el)) {
        conta.elementos.push(el);
        if (el.localName === "use") conta.uses.push(el);
        limparFilhos(el, profundidade + 1, conta);
      }
    } else if (filho.nodeType !== 3 && filho.nodeType !== 4) {
      // texto e CDATA ficam (dentro de <text> e <style>; o <style> já foi conferido); o resto sai
      no.removeChild(filho); // comentários, instruções de processamento, etc.
    }
  }
}

/** `el` é ou contém um <use>? (busca com pilha explícita; a árvore já tem profundidade e tamanho limitados) */
function contemUse(el: Elemento): boolean {
  const pilha: No[] = [el];
  while (pilha.length) {
    const n = pilha.pop()!;
    if (n.nodeType === 1 && (n as Elemento).localName === "use") return true;
    pilha.push(...Array.from(n.childNodes));
  }
  return false;
}

/** Bomba de <use>: teto de quantidade e nenhum <use> apontando para algo que contém outro <use>. */
function conferirUses(conta: { uses: Elemento[]; elementos: Elemento[] }) {
  if (conta.uses.length > LIMITE_USE_SVG) throw new SvgRecusado(`O SVG tem mais de ${LIMITE_USE_SVG} elementos <use>.`);
  if (!conta.uses.length) return;
  const porId = new Map<string, Elemento>();
  for (const e of conta.elementos) { const id = e.getAttribute("id"); if (id && !porId.has(id)) porId.set(id, e); }
  for (const u of conta.uses) {
    const alvo = porId.get((u.getAttribute("href") || u.getAttribute("xlink:href") || "").trim().slice(1));
    if (alvo && contemUse(alvo)) throw new SvgRecusado("O SVG tem um <use> que repete outro <use>, o que não é aceito.");
  }
}

/** Mais de LIMITE_NOS_SVG aberturas de elemento? Para de contar assim que passa (não monta lista). */
function elementosDemais(texto: string): boolean {
  const abre = /<[A-Za-z_]/g;
  let n = 0;
  while (abre.exec(texto)) if (++n > LIMITE_NOS_SVG) return true;
  return false;
}

/**
 * SVG limpo (UTF-8) ou `SvgRecusado` com o motivo em português. `limiteBytes`: 200 KB para a IA; o envio usa o limite
 * geral do logotipo.
 */
export function sanitizarSvg(bytes: Uint8Array | string, limiteBytes: number): Buffer {
  const tamanho = typeof bytes === "string" ? Buffer.byteLength(bytes, "utf8") : bytes.length;
  if (tamanho > limiteBytes) throw new SvgRecusado(`O SVG passa do limite de ${Math.round(limiteBytes / 1024)} KB.`);
  let texto = (typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: false }).decode(bytes)).replace(/^﻿/, "");
  // conta barata (linear) ANTES do parse: arquivo com elementos demais nem chega ao parser
  if (elementosDemais(texto)) throw new SvgRecusado(`O SVG tem elementos demais (mais de ${LIMITE_NOS_SVG}).`);
  if (/<!ENTITY/i.test(texto)) throw new SvgRecusado("O SVG declara entidades XML, o que não é aceito.");
  const doctypes = texto.match(/<!DOCTYPE[^>]*>/gi) ?? [];
  if (doctypes.some(d => d.includes("[")) || /<!DOCTYPE[^>]*\[/i.test(texto)) throw new SvgRecusado("O SVG traz um DOCTYPE com declarações internas, o que não é aceito.");
  texto = texto.replace(/<!DOCTYPE[^>]*>/gi, "");
  let doc;
  try {
    doc = new DOMParser({ onError: (nivel: string, msg: string) => { if (nivel !== "warning") throw new Error(msg); } })
      .parseFromString(texto, "image/svg+xml");
  } catch {
    throw new SvgRecusado("O SVG não é um XML válido.");
  }
  const raizes = Array.from(doc.childNodes as unknown as ArrayLike<No>).filter(n => n.nodeType === 1) as Elemento[];
  if (raizes.length !== 1 || raizes[0].localName !== "svg" || (raizes[0].namespaceURI !== SVG_NS && raizes[0].namespaceURI !== null))
    throw new SvgRecusado("O arquivo precisa ter um único elemento <svg> na raiz.");
  // tudo fora da raiz (comentários, <?xml-stylesheet?>, etc.) sai
  for (const n of Array.from(doc.childNodes as unknown as ArrayLike<No>)) if (n !== raizes[0]) (doc as unknown as No).removeChild(n);
  const raiz = raizes[0];
  limparElemento(raiz);
  const conta = { nos: 1, uses: [] as Elemento[], elementos: [raiz] as Elemento[] };
  limparFilhos(raiz, 1, conta);
  conferirUses(conta);
  if (!raiz.getAttribute("xmlns")) raiz.setAttribute("xmlns", SVG_NS);
  const saida = new XMLSerializer().serializeToString(doc as never);
  return Buffer.from(saida, "utf8");
}
