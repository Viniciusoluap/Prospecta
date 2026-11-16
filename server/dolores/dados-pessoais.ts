// EPIC-025 (Dolores) — interruptor dos dados pessoais. ÚNICO ponto do servidor que lê DOLORES_MASCARAR_DADOS_PESSOAIS.
// Decisão do dono em 16/11/2026 (opção B): a Dolores pode ver e informar CPF, CNPJ, telefone e e-mail dos clientes.
//   - variável ausente, vazia ou "0" → dados pessoais LIBERADOS no que vai ao modelo e na resposta ao dono;
//   - "1" → volta a mascarar com o filtro completo (shared/dolores/sanitizar.ts).
// O que é GRAVADO ou vai para LOG (auditoria, comando guardado, mensagens de erro, tela de admin) usa sempre
// FILTRO_DO_REGISTRO, com o mascaramento ligado, qualquer que seja a variável. Senhas, chaves e dados bancários saem
// nos dois modos (o filtro puro cuida disso).
import { mascararCpf, mascararTelefone } from "../../shared/dolores/formato.js";
import type { OpcoesFiltro } from "../../shared/dolores/sanitizar.js";

export const VARIAVEL_MASCARAR_DADOS_PESSOAIS = "DOLORES_MASCARAR_DADOS_PESSOAIS";

/** Filtro do que vai ao modelo (ponte, etapa 1 e 2) e na resposta ao dono — segue a variável (lida a cada chamada). */
export function filtroDaSaida(): OpcoesFiltro {
  return { mascararDadosPessoais: process.env[VARIAVEL_MASCARAR_DADOS_PESSOAIS]?.trim() === "1" };
}

/** O interruptor está ligado (dados pessoais mascarados no que vai ao modelo e ao dono)? */
export function mascararDadosPessoais(): boolean {
  return filtroDaSaida().mascararDadosPessoais === true;
}

export type TipoCampoPessoal = "cpf" | "cnpj" | "telefone" | "email";
/**
 * Campo pessoal ESTRUTURADO das leituras (CPF, CNPJ, telefone, e-mail do cliente) — a regra num lugar só.
 * Liberado (padrão, opção B): o valor completo. Ligado: CPF "***.***.***-01", CNPJ só com os 2 últimos dígitos, telefone
 * "(99) *****-4567" e e-mail não sai (undefined: a chave some do JSON), como era antes da decisão do dono.
 * Dados bancários e credenciais NÃO passam por aqui: as leituras nunca os devolvem.
 */
export function campoPessoal(valor: string | null | undefined, tipo: TipoCampoPessoal): string | null | undefined {
  const v = String(valor ?? "").trim();
  if (!mascararDadosPessoais()) return v || null;
  if (!v) return tipo === "email" ? undefined : null;
  switch (tipo) {
    case "cpf": return mascararCpf(v);
    case "telefone": return mascararTelefone(v);
    case "cnpj": { const d = v.replace(/\D/g, ""); return d.length === 14 ? `**.***.***/****-${d.slice(-2)}` : "***"; }
    case "email": return undefined;
  }
}

/** Filtro do que é gravado no banco ou vai para log: sempre mascarado, independentemente da variável. */
export const FILTRO_DO_REGISTRO: Readonly<OpcoesFiltro> = Object.freeze({ mascararDadosPessoais: true });
