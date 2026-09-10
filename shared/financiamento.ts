import { z } from "zod";

export const FINANCIAMENTO_STATUS = [
  "pre_analise", "documentacao", "analise_banco", "aprovado",
  "contrato", "registro", "liberado", "cancelado",
] as const;

export const FINANCIAMENTO_TIPOS = [
  "mcmv", "sbpe", "pro_cotista", "construcao", "reforma",
] as const;

export const FINANCIAMENTO_BANCOS = [
  "caixa", "bb", "bradesco", "itau", "santander", "outro",
] as const;

export const FINANCIAMENTO_STATUS_LABELS: Record<(typeof FINANCIAMENTO_STATUS)[number], string> = {
  pre_analise: "Pré-análise",
  documentacao: "Documentação",
  analise_banco: "Análise do banco",
  aprovado: "Aprovado",
  contrato: "Contrato",
  registro: "Registro",
  liberado: "Liberado",
  cancelado: "Cancelado",
};

export const FINANCIAMENTO_TIPO_LABELS: Record<(typeof FINANCIAMENTO_TIPOS)[number], string> = {
  mcmv: "Minha Casa Minha Vida",
  sbpe: "SBPE",
  pro_cotista: "Pró-Cotista FGTS",
  construcao: "Construção",
  reforma: "Reforma",
};

export const FINANCIAMENTO_BANCO_LABELS: Record<(typeof FINANCIAMENTO_BANCOS)[number], string> = {
  caixa: "Caixa Econômica Federal",
  bb: "Banco do Brasil",
  bradesco: "Bradesco",
  itau: "Itaú",
  santander: "Santander",
  outro: "Outro",
};

export const FINANCIAMENTO_CHECKLIST_PADRAO = [
  { grupo: "Comprador", item: "RG e CPF" },
  { grupo: "Comprador", item: "Certidão de nascimento ou casamento" },
  { grupo: "Comprador", item: "Comprovante de residência" },
  { grupo: "Comprador", item: "Comprovante de renda" },
  { grupo: "Comprador", item: "Extratos bancários dos últimos 3 meses" },
  { grupo: "Comprador", item: "CTPS ou contrato de trabalho" },
  { grupo: "Imóvel", item: "Matrícula atualizada" },
  { grupo: "Imóvel", item: "Certidão de ônus e ações reais" },
  { grupo: "Imóvel", item: "IPTU do exercício atual" },
  { grupo: "Imóvel", item: "Planta baixa aprovada" },
  { grupo: "Imóvel", item: "Habite-se ou auto de conclusão" },
  { grupo: "Banco", item: "Proposta de financiamento assinada" },
  { grupo: "Banco", item: "Laudo de avaliação do imóvel" },
  { grupo: "Banco", item: "Aprovação de crédito" },
  { grupo: "Banco", item: "Minuta do contrato assinada" },
] as const;

const optionalText = z.string().trim().max(500).optional().nullable();

export const financiamentoInputSchema = z.object({
  clienteNome: z.string().trim().min(2).max(255),
  clienteCpf: z.string().trim().max(14).optional().nullable(),
  clienteTel: z.string().trim().min(8).max(30),
  clienteEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  imovel: z.string().trim().min(2).max(500),
  tipo: z.enum(FINANCIAMENTO_TIPOS),
  banco: z.enum(FINANCIAMENTO_BANCOS),
  bancoOutro: z.string().trim().max(120).optional().nullable(),
  valorImovel: z.number().nonnegative(),
  valorFinanciado: z.number().nonnegative(),
  entrada: z.number().nonnegative(),
  taxa: z.number().nonnegative(),
  prazo: z.number().int().positive().max(600),
  parcela: z.number().nonnegative().optional().nullable(),
  protocolo: z.string().trim().max(120).optional().nullable(),
  observacoes: optionalText,
  leadId: z.number().int().positive().optional().nullable(),
  imovelVinculadoId: z.number().int().positive().optional().nullable(),
  corretorId: z.number().int().positive().optional().nullable(),
}).refine((value) => value.valorFinanciado <= value.valorImovel, {
  message: "O valor financiado não pode superar o valor do imóvel",
  path: ["valorFinanciado"],
});

export type FinanciamentoInput = z.infer<typeof financiamentoInputSchema>;
