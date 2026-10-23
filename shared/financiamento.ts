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
  // A chave persistida permanece por compatibilidade com registros e integrações antigas.
  liberado: "Concluído",
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
  { grupo: "Financiamento e imóvel", item: "Certidão de inteiro teor" },
  { grupo: "Financiamento e imóvel", item: "ART" },
  { grupo: "Financiamento e imóvel", item: "Alvará" },
  { grupo: "Financiamento e imóvel", item: "Memorial descritivo" },
  { grupo: "Financiamento e imóvel", item: "Habite-se" },
  { grupo: "Financiamento e imóvel", item: "Projeto aprovado" },
  { grupo: "Financiamento e imóvel", item: "Conta de água" },
  { grupo: "Financiamento e imóvel", item: "PCI em PDF" },
  { grupo: "Financiamento e imóvel", item: "PCI em XLS" },
  { grupo: "Financiamento e imóvel", item: "PLS" },
  { grupo: "Financiamento e imóvel", item: "CNO e CND" },
  { grupo: "Financiamento e imóvel", item: "Outros" },
] as const;

const optionalText = z.string().trim().max(500).optional().nullable();

const financiamentoBaseInputSchema = z.object({
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
});

export const financiamentoInputSchema = financiamentoBaseInputSchema.refine((value) => value.valorFinanciado <= value.valorImovel, {
  message: "O valor financiado não pode superar o valor do imóvel",
  path: ["valorFinanciado"],
});

/**
 * EPIC-017 (story 1.5): novo financiamento nasce sempre de um lead do CRM. Nome,
 * CPF, telefone e e-mail do cliente são migrados do lead pelo servidor.
 */
export const financiamentoFromLeadSchema = financiamentoBaseInputSchema
  .omit({ clienteNome: true, clienteCpf: true, clienteTel: true, clienteEmail: true })
  .extend({ leadId: z.number().int().positive() })
  .refine((value) => value.valorFinanciado <= value.valorImovel, {
    message: "O valor financiado não pode superar o valor do imóvel",
    path: ["valorFinanciado"],
  });

export const financiamentoUpdateSchema = financiamentoBaseInputSchema.partial().refine(
  (value) => value.valorFinanciado === undefined || value.valorImovel === undefined || value.valorFinanciado <= value.valorImovel,
  { message: "O valor financiado não pode superar o valor do imóvel", path: ["valorFinanciado"] },
);

export type FinanciamentoInput = z.infer<typeof financiamentoInputSchema>;
