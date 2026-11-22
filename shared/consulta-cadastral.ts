// EPIC-029 (Módulo Fiscal), etapa 1 — cadastro automático por CNPJ e CEP (Brasil API, com o ViaCEP de reserva no CEP).
// Regras comuns à tela e ao servidor: limpeza e conferência do CNPJ e do CEP ANTES de qualquer consulta, alerta da
// situação cadastral, limpeza dos textos que vêm de fora e a separação "campo vazio × campo já digitado".
// Story: docs/stories/epics/epic-029-modulo-fiscal/S-1-brasil-api.md.
import { cnpjValido } from "./contratos/modelos.js";

export type TipoConsultaCadastral = "cnpj" | "cep";

/** Situações cadastrais da Receita (documentação oficial da Brasil API: 1 NULA, 2 ATIVA, 3 SUSPENSA, 4 INAPTA, 8 BAIXADA). */
export const SITUACOES_CADASTRAIS: Readonly<Record<number, string>> = { 1: "NULA", 2: "ATIVA", 3: "SUSPENSA", 4: "INAPTA", 8: "BAIXADA" };

export type EnderecoCadastral = {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigoIbge: string | null;
};

export type DadosCnpj = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  /** "ATIVA", "INAPTA", "BAIXADA", "SUSPENSA", "NULA" ou null quando a Receita não informou. */
  situacao: string | null;
  /** Preenchido quando a situação não é ATIVA: a tela mostra em destaque. */
  alerta: string | null;
  cnaePrincipal: { codigo: string; descricao: string | null } | null;
  endereco: EnderecoCadastral;
};

export type DadosCep = {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  codigoIbge: string | null;
};

export type FonteConsulta = "brasilapi" | "viacep";
export type RespostaConsulta<T> = { dados: T; fonte: FonteConsulta; doCache: boolean; consultadoEm: string };

/** CNPJ só com os 14 caracteres (o novo CNPJ alfanumérico da Receita usa letras nas 12 primeiras posições). */
export function limparCnpj(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 20);
}

/** Tem 14 caracteres e o dígito confere: só aí há consulta. */
export function cnpjParaConsulta(v: string): string | null {
  const c = limparCnpj(v);
  return c.length === 14 && cnpjValido(c) ? c : null;
}

export function limparCep(v: string): string {
  return v.replace(/\D/g, "").slice(0, 12);
}

/** CEP com 8 dígitos e que não é "00000000": só aí há consulta. */
export function cepParaConsulta(v: string): string | null {
  const c = limparCep(v);
  return /^\d{8}$/.test(c) && c !== "00000000" ? c : null;
}

export function situacaoDoCodigo(codigo: unknown, descricao: unknown): string | null {
  const texto = typeof descricao === "string" ? descricao.trim().toUpperCase() : "";
  if (Object.values(SITUACOES_CADASTRAIS).includes(texto)) return texto;
  const n = typeof codigo === "number" ? codigo : typeof codigo === "string" && /^\d+$/.test(codigo) ? Number(codigo) : NaN;
  return SITUACOES_CADASTRAIS[n] ?? null;
}

/** Alerta quando a empresa não está ATIVA na Receita (inapta, baixada, suspensa, nula ou sem informação). */
export function alertaDaSituacao(situacao: string | null): string | null {
  if (situacao === "ATIVA") return null;
  if (!situacao) return "A Receita não informou a situação cadastral deste CNPJ. Confira antes de cadastrar.";
  return `Atenção: este CNPJ está ${situacao} na Receita Federal. Confira antes de cadastrar ou emitir documento para esta empresa.`;
}

/**
 * Texto que veio de fora (Receita, Correios): sem HTML, sem caractere de controle, espaços normalizados e tamanho máximo.
 * Vazio vira null.
 */
export function limparTexto(v: unknown, max = 120): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const texto = String(v)
    .replace(/<[^>]*>?/g, " ")
    .replace(/[<>]/g, " ")
    // Controles C0/C1, separadores de linha e os invisíveis de largura zero e de direção (bidi, "Trojan Source"): QA S-1.
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return texto ? texto : null;
}

/**
 * O MEI tem o CPF do dono dentro da razão social ("FULANO DE TAL 12345678909"). LGPD (portão de QA da S-1): toda sequência
 * de 11 números (com ou sem pontuação de CPF) sai do nome antes de ir para a tela ou para o cache — CPF nunca é guardado.
 */
export function semCpf(texto: string | null): string | null {
  if (!texto) return texto;
  const limpo = texto
    .replace(/(?<![0-9])[0-9]{3}[.\s]?[0-9]{3}[.\s]?[0-9]{3}[-.\s]?[0-9]{2}(?![0-9])/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–,.;:/]+|[\s\-–,.;:/]+$/g, "")
    .trim();
  return limpo || null;
}

export function formatarCep(cep: string): string {
  const c = limparCep(cep);
  return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

/**
 * Divide a sugestão da consulta em dois grupos: os campos VAZIOS (pode preencher direto) e os campos que o usuário já
 * digitou com outro valor (conflitos: só com o botão "usar dados da Receita"). Nunca sobrescreve em silêncio.
 */
export function separarPreenchimento<K extends string>(
  atual: Partial<Record<K, string | null | undefined>>,
  sugestao: Partial<Record<K, string | null | undefined>>,
): { vazios: Partial<Record<K, string>>; conflitos: Partial<Record<K, string>> } {
  const vazios: Partial<Record<K, string>> = {};
  const conflitos: Partial<Record<K, string>> = {};
  for (const chave of Object.keys(sugestao) as K[]) {
    const novo = sugestao[chave];
    if (typeof novo !== "string" || !novo.trim()) continue;
    const velho = (atual[chave] ?? "").trim();
    if (!velho) vazios[chave] = novo;
    else if (velho.toLocaleLowerCase("pt-BR") !== novo.trim().toLocaleLowerCase("pt-BR")) conflitos[chave] = novo;
  }
  return { vazios, conflitos };
}

/** Endereço em uma linha ("Rua X, 12 - sala 3"), para os cadastros que têm um campo só de endereço. */
export function enderecoEmLinha(e: Pick<EnderecoCadastral, "logradouro" | "numero" | "complemento" | "bairro">, comBairro = false): string | null {
  const partes = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const comComplemento = [partes, e.complemento].filter(Boolean).join(" - ");
  const final = comBairro ? [comComplemento, e.bairro].filter(Boolean).join(" - ") : comComplemento;
  return final || null;
}
