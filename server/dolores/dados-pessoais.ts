// EPIC-025 (Dolores) — interruptor dos dados pessoais. ÚNICO ponto do servidor que lê DOLORES_MASCARAR_DADOS_PESSOAIS.
// Decisão do dono em 16/11/2026 (opção B): a Dolores pode ver e informar CPF, CNPJ, telefone e e-mail dos clientes.
//   - variável ausente, vazia, "0", "false", "nao", "não", "off" ou "no" → dados pessoais LIBERADOS no que vai ao modelo
//     e na resposta ao dono;
//   - QUALQUER outro valor ("1", "true", "sim", "S", "2", "1 # comentário"…) → volta a mascarar com o filtro completo
//     (shared/dolores/sanitizar.ts). QA r7 A4: falha fechada — valor que não é claramente "desligado" mascara, com um
//     aviso no log (uma vez, sem o valor).
// O que é GRAVADO ou vai para LOG (auditoria, comando guardado, mensagens de erro, tela de admin) usa sempre
// FILTRO_DO_REGISTRO, com o mascaramento ligado, qualquer que seja a variável. Senhas, chaves e dados bancários saem
// nos dois modos (o filtro puro cuida disso).
import { mascararCpf, mascararTelefone } from "../../shared/dolores/formato.js";
import type { OpcoesFiltro } from "../../shared/dolores/sanitizar.js";

export const VARIAVEL_MASCARAR_DADOS_PESSOAIS = "DOLORES_MASCARAR_DADOS_PESSOAIS";

/** Valor da variável sem espaços, sem aspas em volta e em minúsculas. */
function valorNormalizado(nome: string): string | undefined {
  const bruto = process.env[nome];
  if (bruto === undefined) return undefined;
  return bruto.trim().replace(/^(["'])(.*)\1$/s, "$2").trim().toLowerCase();
}
const DESLIGADO = new Set(["", "0", "false", "nao", "não", "off", "no"]);
const avisados = new Set<string>();
function avisarUmaVez(nome: string, efeito: string) {
  if (avisados.has(nome)) return;
  avisados.add(nome);
  console.warn(`[dolores] ${nome} com valor não reconhecido: ${efeito} (falha fechada). Use os valores do docs/dolores/como-ligar.md.`);
}
/** Só para testes: esquece os avisos já dados. */
export function esquecerAvisosDoInterruptor() { avisados.clear(); }

/**
 * DOLORES_MASCARAR_DADOS_PESSOAIS: libera só com ausente/vazio/"0"/"false"/"nao"/"não"/"off"/"no" (sem diferenciar
 * maiúsculas, com trim e sem aspas). "1" mascara. Qualquer outro valor mascara e avisa no log uma vez.
 */
export function mascararDadosPessoais(): boolean {
  const v = valorNormalizado(VARIAVEL_MASCARAR_DADOS_PESSOAIS);
  if (v === undefined || DESLIGADO.has(v)) return false;
  if (v !== "1") avisarUmaVez(VARIAVEL_MASCARAR_DADOS_PESSOAIS, "dados pessoais MASCARADOS");
  return true;
}

/** Filtro do que vai ao modelo (ponte, etapa 1 e 2) e na resposta ao dono — segue a variável (lida a cada chamada). */
export function filtroDaSaida(): OpcoesFiltro {
  return { mascararDadosPessoais: mascararDadosPessoais() };
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
