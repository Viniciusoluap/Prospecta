// EPIC-025 (Dolores) — interruptores dos dados pessoais. ÚNICO ponto do servidor que lê DOLORES_MASCARAR_DADOS_PESSOAIS e
// DOLORES_PONTE_DADOS_PESSOAIS. A regra é POR CANAL (QA r7 A3):
//   - canal "whatsapp" (a Dolores respondendo ao dono): segue DOLORES_MASCARAR_DADOS_PESSOAIS (abaixo);
//   - canal "grupo" (etapa 4b: a resposta NO GRUPO quando ela é marcada): dados pessoais SEMPRE mascarados;
//   - canal "ponte" (a ponte HTTP da etapa 1, para quem tiver o token): dados pessoais MASCARADOS por padrão; só com
//     DOLORES_PONTE_DADOS_PESSOAIS = "1", "true", "sim", "on" ou "yes" saem completos (qualquer outro valor mascara).
// Decisão do dono em 16/11/2026 (opção B): a Dolores pode ver e informar CPF, CNPJ, telefone e e-mail dos clientes — a
// autorização vale para a Dolores no WhatsApp; a ponte HTTP precisa do interruptor próprio. No WhatsApp:
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
export const VARIAVEL_PONTE_DADOS_PESSOAIS = "DOLORES_PONTE_DADOS_PESSOAIS";
/** De onde veio a chamada (vai para `dolores_acoes.canal` e decide o interruptor dos dados pessoais). */
export type CanalDolores = "ponte" | "whatsapp";
/**
 * Etapa 4b — canal do FILTRO: além dos dois de cima, "grupo" (a Dolores respondendo NO GRUPO do cliente, quando marcada). No
 * grupo os dados pessoais saem SEMPRE mascarados: a opção B do dono vale só para a conversa direta dele (o grupo é lido por
 * todos os participantes). Não é canal da auditoria (dolores_acoes.canal continua "ponte"/"whatsapp"/"tela").
 */
export type CanalDoFiltro = CanalDolores | "grupo";

/** Valor da variável sem espaços, sem aspas em volta e em minúsculas. */
function valorNormalizado(nome: string): string | undefined {
  const bruto = process.env[nome];
  if (bruto === undefined) return undefined;
  return bruto.trim().replace(/^(["'])([^]*)\1$/, "$2").trim().toLowerCase();
}
const DESLIGADO = new Set(["", "0", "false", "nao", "não", "off", "no"]);
const LIGADO = new Set(["1", "true", "sim", "on", "yes"]);
const avisados = new Set<string>();
function avisarUmaVez(nome: string, efeito: string) {
  if (avisados.has(nome)) return;
  avisados.add(nome);
  console.warn(`[dolores] ${nome} com valor não reconhecido: ${efeito} (falha fechada). Use os valores do docs/dolores/como-ligar.md.`);
}
/** Só para testes: esquece os avisos já dados. */
export function esquecerAvisosDoInterruptor() { avisados.clear(); }

/**
 * DOLORES_MASCARAR_DADOS_PESSOAIS (canal whatsapp): libera só com ausente/vazio/"0"/"false"/"nao"/"não"/"off"/"no" (sem
 * diferenciar maiúsculas, com trim e sem aspas). "1" mascara. Qualquer outro valor mascara e avisa no log uma vez.
 */
function mascararNoWhatsapp(): boolean {
  const v = valorNormalizado(VARIAVEL_MASCARAR_DADOS_PESSOAIS);
  if (v === undefined || DESLIGADO.has(v)) return false;
  if (v !== "1") avisarUmaVez(VARIAVEL_MASCARAR_DADOS_PESSOAIS, "dados pessoais MASCARADOS");
  return true;
}
/**
 * DOLORES_PONTE_DADOS_PESSOAIS (canal ponte): o inverso — libera só com "1"/"true"/"sim"/"on"/"yes"; ausente ou qualquer
 * outro valor mascara (valor que não é nem de ligar nem de desligar avisa no log uma vez).
 */
function mascararNaPonte(): boolean {
  const v = valorNormalizado(VARIAVEL_PONTE_DADOS_PESSOAIS);
  if (v !== undefined && LIGADO.has(v)) return false;
  if (v !== undefined && !DESLIGADO.has(v)) avisarUmaVez(VARIAVEL_PONTE_DADOS_PESSOAIS, "dados pessoais da ponte MASCARADOS");
  return true;
}

/**
 * Dados pessoais mascarados neste canal? Canal desconhecido: mascara (falha fechada) — QA r8 achado 7: antes, qualquer
 * canal que não fosse "whatsapp" caía na regra da ponte (e DOLORES_PONTE_DADOS_PESSOAIS=1 o liberava).
 */
export function mascararDadosPessoais(canal: CanalDoFiltro): boolean {
  if (canal === "grupo") return true; // etapa 4b: sempre, qualquer que seja a variável
  if (canal === "whatsapp") return mascararNoWhatsapp();
  if (canal === "ponte") return mascararNaPonte();
  return true;
}

/** Filtro do que vai ao modelo/agente e na resposta ao dono, pelo canal — variáveis lidas a cada chamada. */
export function filtroDaSaida(canal: CanalDoFiltro): OpcoesFiltro {
  return { mascararDadosPessoais: mascararDadosPessoais(canal) };
}

export type TipoCampoPessoal = "cpf" | "cnpj" | "telefone" | "email";
/**
 * Campo pessoal ESTRUTURADO das leituras (CPF, CNPJ, telefone, e-mail do cliente) — a regra num lugar só.
 * Liberado (WhatsApp por padrão, opção B; ponte só com DOLORES_PONTE_DADOS_PESSOAIS): o valor completo. Mascarado: CPF
 * "***.***.***-01", CNPJ só com os 2 últimos dígitos, telefone "(99) *****-4567" e e-mail não sai (undefined: a chave some do JSON), como era antes da decisão do dono.
 * Dados bancários e credenciais NÃO passam por aqui: as leituras nunca os devolvem.
 */
export function campoPessoal(valor: string | null | undefined, tipo: TipoCampoPessoal, canal: CanalDoFiltro): string | null | undefined {
  const v = String(valor ?? "").trim();
  if (!mascararDadosPessoais(canal)) return v || null;
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
