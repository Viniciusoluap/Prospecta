// EPIC-029 S-7 (22/11/2026) — validação do leiaute contra o XSD OFICIAL antes de qualquer envio à Sefin Nacional.
// XSD em shared/fiscal/xsd/ (versão, URL de origem e SHA-256 no README da pasta), um conjunto por ambiente:
// produção = v1.01 de 09/02/2026; produção restrita = v1.01 de 20/10/2026 (NT 009). O validador é o libxml2 compilado para
// WebAssembly (`xmllint-wasm`, MIT): JS/WASM puro, sem binário do sistema, roda na função da Vercel.
// Regras:
// - FALHA FECHADA: validador indisponível, XSD ausente ou erro inesperado → ErroLeiaute ("nada foi enviado");
// - as mensagens devolvidas citam só o NOME do campo e o tipo do problema — nunca o valor (CPF, nome, descrição…);
// - nada é logado.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// QA S-7 (B7): o validador é carregado SOB DEMANDA (import dinâmico dentro do try). Se o pacote não entrar na função da Vercel
// (pnpm guarda o pacote em node_modules/.pnpm/… e node_modules/xmllint-wasm é só um link), só a validação falha — FECHADA, com
// ErroLeiaute —, sem derrubar o carregamento do servidor inteiro. Os arquivos que o pacote lê por __dirname (o .wasm e o
// worker) são conferidos no caminho REAL antes de validar; `vercel.json` inclui esse caminho real (glob de node_modules/.pnpm).
type ValidateXml = typeof import("xmllint-wasm").validateXML;
export const ARQUIVOS_DO_VALIDADOR = ["xmllint.wasm", "xmllint-node.js", "index-node.js"] as const;

/** Pasta REAL (links resolvidos) do pacote xmllint-wasm. Lança se não achar. */
export function pastaRealDoValidador(): string {
  return dirname(realpathSync(createRequire(import.meta.url).resolve("xmllint-wasm")));
}

/** Confere que os arquivos do validador existem na pasta; `pasta` só para teste. Lança ErroLeiaute (falha fechada). */
export function conferirArquivosDoValidador(pasta?: string): void {
  let dir: string;
  try { dir = pasta ?? pastaRealDoValidador(); } catch { throw new ErroLeiaute(FRASE_VALIDADOR_INDISPONIVEL); }
  for (const f of ARQUIVOS_DO_VALIDADOR) if (!existsSync(join(dir, f))) throw new ErroLeiaute(FRASE_VALIDADOR_INDISPONIVEL);
}
export const FRASE_VALIDADOR_INDISPONIVEL = "Não foi possível conferir o leiaute agora (validador indisponível). Nada foi enviado.";

export type DocumentoLeiaute = "dps" | "pedRegEvento";
export type AmbienteLeiaute = "producao" | "producao_restrita";

/** Pasta do XSD de cada ambiente (dentro de shared/fiscal/xsd/). */
export const PASTA_DO_AMBIENTE: Record<AmbienteLeiaute, string> = {
  producao: "producao-20260209",
  producao_restrita: "producao-restrita-20261020",
};
const RAIZ: Record<DocumentoLeiaute, string> = { dps: "DPS_v1.01.xsd", pedRegEvento: "pedRegEvento_v1.01.xsd" };
const ARQUIVOS = ["DPS_v1.01.xsd", "pedRegEvento_v1.01.xsd", "tiposComplexos_v1.01.xsd", "tiposSimples_v1.01.xsd", "tiposEventos_v1.01.xsd", "xmldsig-core-schema.xsd"] as const;
export const TAMANHO_MAXIMO_XML = 1024 * 1024;

export class ErroLeiaute extends Error {
  constructor(message: string, readonly erros: string[] = []) { super(message); this.name = "ErroLeiaute"; }
}

export type ResultadoLeiaute = { valido: boolean; erros: string[] };

/**
 * O XSD de produção usa `^…$` num `pattern` (série). No XSD essas letras NÃO são âncoras (o padrão já é ancorado) e o libxml2
 * as lê como caracteres; o validador da Sefin (.NET) as lê como âncoras. Tirar o `^` inicial e o `$` final dá o mesmo
 * significado do servidor oficial. Só em memória — os arquivos ficam iguais aos oficiais.
 */
export function ajustarAncoras(xsd: string): string {
  return xsd.replace(/(<xs:pattern\s+value=")\^([^"]*?)\$(")/g, "$1$2$3");
}

const cache = new Map<string, { fileName: string; contents: string }[]>();
function esquemas(ambiente: AmbienteLeiaute, pastaBase?: URL) {
  const chave = `${ambiente}|${pastaBase?.href ?? ""}`;
  const pronto = cache.get(chave);
  if (pronto) return pronto;
  const base = pastaBase ?? new URL(`../../shared/fiscal/xsd/${PASTA_DO_AMBIENTE[ambiente]}/`, import.meta.url);
  const lidos = ARQUIVOS.map(nome => {
    // BOM tirado: o conteúdo vai para o sistema de arquivos em memória do validador como texto UTF-8.
    const texto = readFileSync(new URL(nome, base), "utf8").replace(/^﻿/, "");
    return { fileName: nome, contents: ajustarAncoras(texto) };
  });
  cache.set(chave, lidos);
  return lidos;
}

/** Mensagem do libxml2 → frase só com o nome do campo e o tipo do problema (sem nenhum valor do documento). */
export function fraseDoErro(mensagem: string): string {
  const campo = /Element '\{[^}]*\}([A-Za-z0-9_]+)'/.exec(mensagem)?.[1] ?? /Element '([A-Za-z0-9_]+)'/.exec(mensagem)?.[1] ?? null;
  const atributo = /attribute '([A-Za-z0-9_]+)'/.exec(mensagem)?.[1] ?? null;
  const esperados = Array.from(new Set(Array.from(mensagem.matchAll(/\{[^}]*\}([A-Za-z0-9_]+)/g)).map(m => m[1]!).filter(n => n !== campo))).slice(0, 6);
  const faceta = /\[facet '([A-Za-z]+)'\]/.exec(mensagem)?.[1];
  let tipo: string;
  if (faceta) tipo = `fora do formato do leiaute (${faceta})`;
  else if (/Missing child element/.test(mensagem)) tipo = `falta campo obrigatório${esperados.length ? ` (${esperados.join(", ")})` : ""}`;
  else if (/is not expected/.test(mensagem)) tipo = `fora de ordem ou não previsto no leiaute${esperados.length ? ` (esperado: ${esperados.join(", ")})` : ""}`;
  else if (/not a valid value|is not accepted/.test(mensagem)) tipo = "valor inválido para o leiaute";
  else if (/No matching global declaration|root/.test(mensagem)) tipo = "documento de tipo errado";
  else tipo = "não confere com o leiaute";
  const onde = atributo ? `atributo ${atributo}${campo ? ` de ${campo}` : ""}` : campo ? `campo ${campo}` : "documento";
  return `${onde}: ${tipo}`;
}

/**
 * Valida o XML (assinado ou não — a assinatura é opcional no XSD) contra o XSD do ambiente. Devolve `valido` e a lista de
 * frases sem valores. Lança ErroLeiaute só quando NÃO conseguiu validar (falha fechada para quem chama).
 */
export async function validarLeiaute(xml: string, documento: DocumentoLeiaute, ambiente: AmbienteLeiaute | string, o: { pastaBase?: URL; pastaValidador?: string; carregar?: () => Promise<ValidateXml> } = {}): Promise<ResultadoLeiaute> {
  if (ambiente !== "producao" && ambiente !== "producao_restrita") throw new ErroLeiaute("Ambiente sem leiaute para validar. Nada foi enviado.");
  if (!xml || xml.length > TAMANHO_MAXIMO_XML) throw new ErroLeiaute("Documento vazio ou grande demais para validar. Nada foi enviado.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { valido: false, erros: ["documento: DOCTYPE/ENTITY não é aceito"] };
  let r: Awaited<ReturnType<ValidateXml>>;
  try {
    conferirArquivosDoValidador(o.pastaValidador);
    const validateXML = o.carregar ? await o.carregar() : (await import("xmllint-wasm")).validateXML;
    if (typeof validateXML !== "function") throw new Error("validador");
    const todos = esquemas(ambiente, o.pastaBase);
    const raiz = todos.find(f => f.fileName === RAIZ[documento])!;
    r = await validateXML({ xml: [{ fileName: "documento.xml", contents: xml }], schema: [raiz], preload: todos.filter(f => f !== raiz) });
  } catch {
    throw new ErroLeiaute(FRASE_VALIDADOR_INDISPONIVEL);
  }
  if (r.valid) return { valido: true, erros: [] };
  const erros = Array.from(new Set(r.errors.map(e => fraseDoErro(e.message)))).slice(0, 20);
  return { valido: false, erros: erros.length ? erros : ["documento: não confere com o leiaute"] };
}

/** Atalho: valida e lança ErroLeiaute com a lista quando inválido. */
export async function exigirLeiaute(xml: string, documento: DocumentoLeiaute, ambiente: AmbienteLeiaute | string, o: { pastaBase?: URL; pastaValidador?: string; carregar?: () => Promise<ValidateXml> } = {}): Promise<void> {
  const r = await validarLeiaute(xml, documento, ambiente, o);
  if (!r.valido) {
    throw new ErroLeiaute(`O ${documento === "dps" ? "documento da nota (DPS)" : "pedido de cancelamento"} não confere com o leiaute oficial: ${r.erros.slice(0, 5).join("; ")}. Nada foi enviado.`, r.erros);
  }
}
