import { z } from "zod";
const id = z.number().int().positive();
const name = z.string().trim().min(2).max(255);
const money = z.number().finite().min(0).max(9999999999999.99);
const notes = z.string().max(10000).default("");
export const VISIT_STATUS = [
  "agendada",
  "confirmada",
  "realizada",
  "cancelada",
] as const;
export const PROJECT_STATUS = [
  "orcamento",
  "solicitado",
  "em_elaboracao",
  "revisao",
  "aprovado",
  "entregue",
  "cancelado",
] as const;
/** Tipos de projeto (mesma lista do Santa Fé: PROJETO_TIPO_CONFIG). */
export const PROJECT_TYPE_LABELS: Record<string, string> = {
  projeto_arquitetonico: "Projeto Arquitetônico",
  projeto_estrutural: "Projeto Estrutural",
  projeto_eletrico: "Projeto Elétrico",
  projeto_hidrossanitario: "Projeto Hidrossanitário",
  projeto_completo: "Projeto Completo",
  orcamento_obra: "Orçamento de Obra",
  laudo_tecnico: "Laudo Técnico",
  art_rrt: "ART / RRT",
};
export const COMMISSION_STATUS = [
  "pendente",
  "aprovada",
  "paga",
  "cancelada",
] as const;
export const VISIT_TYPES = [
  "imovel",
  "lote",
  "obra",
  "escritorio",
  "regularizacao",
  "avaliacao",
  "financiamento",
  "outro",
  "terreno",
  "reuniao",
] as const;
export const visitInput = z
  .object({
    leadId: id.nullable(),
    propertyId: id.nullable(),
    brokerId: id.nullable(),
    clientName: z.string().trim().max(255),
    clientPhone: z.string().trim().max(40),
    scheduledAt: z.coerce.date(),
    status: z.enum(VISIT_STATUS),
    visitType: z.enum(VISIT_TYPES),
    // Seleção real: id de um administrador/colaborador ativo, carregado do
    // banco (ver agendaRouter.options). Nunca texto livre.
    responsibleId: id.nullable(),
    notes,
  })
  .refine(v => v.leadId !== null || v.clientName.length >= 2, {
    message: "Selecione um lead ou informe o cliente",
    path: ["clientName"],
  });
// EPIC-018 (story 2.1): foto e especialidades saíram do cadastro de corretor.
// Continuam opcionais no contrato para preservar dados já gravados: quando
// ausentes, o servidor não altera os valores existentes.
export const brokerInput = z.object({
  name,
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(20),
  creci: z.string().trim().min(1).max(40),
  active: z.boolean(),
  avatar: z
    .union([
      z.literal(""),
      z
        .string()
        .url()
        .refine(v => v.startsWith("https://")),
    ])
    .optional(),
  specialties: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  notes,
  // EPIC-020 Lote 3 (item 32): regra de comissão do corretor, usada nas obras
  // que não têm percentual próprio. Vazio = sem regra (nunca vira 0%).
  defaultCommissionPct: z
    .string()
    .trim()
    .transform(v => v.replace(",", "."))
    .refine(v => v === "" || (/^\d{1,3}(\.\d{1,4})?$/.test(v) && Number(v) <= 100), "Percentual de comissão inválido (0 a 100)")
    .optional(),
});

/** EPIC-018 (story 2.5): "construção" passa a se chamar "obra" em toda a tela. */
export const COMMISSION_BUSINESS_TYPES = [
  "venda_imovel",
  "locacao",
  "obra",
  "financiamento",
  "outro",
] as const;
export type CommissionBusinessType = (typeof COMMISSION_BUSINESS_TYPES)[number];
export const COMMISSION_BUSINESS_TYPE_LABELS: Record<CommissionBusinessType, string> = {
  venda_imovel: "Venda de imóvel",
  locacao: "Locação",
  obra: "Obra",
  financiamento: "Financiamento",
  outro: "Outro",
};
/** Rótulo de exibição; aceita o valor legado "construcao" gravado antes da migration 0031. */
export function commissionBusinessTypeLabel(value: string) {
  const normalized = value === "construcao" ? "obra" : value;
  return COMMISSION_BUSINESS_TYPE_LABELS[normalized as CommissionBusinessType] ?? value.replaceAll("_", " ");
}

/** Story 2.4: valor sugerido = percentual de referência sobre o valor cadastrado. */
export function suggestedCommissionAmount(baseValue: number | string | null | undefined, percent: number | string) {
  const base = Number(baseValue);
  const pct = Number(percent);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct) || pct < 0) return null;
  return Math.round(base * pct) / 100;
}

export const commissionInput = z
  .object({
    beneficiary: z.enum(["corretor", "empresa"]),
    businessType: z.preprocess(
      v => (v === "construcao" ? "obra" : v),
      z.enum(COMMISSION_BUSINESS_TYPES)
    ),
    brokerId: id.nullable(),
    // Stories 2.3/2.5: imóvel ou obra cadastrados — sem digitação livre.
    propertyId: id.nullable().default(null),
    constructionProjectId: id.nullable().default(null),
    amount: money,
    percent: z.number().min(0).max(100),
    status: z.enum(COMMISSION_STATUS),
    dueDate: z.coerce.date(),
    notes,
  })
  .refine(v => v.beneficiary !== "corretor" || v.brokerId !== null, {
    message: "Selecione o corretor",
    path: ["brokerId"],
  })
  .refine(v => v.businessType !== "obra" || v.constructionProjectId !== null, {
    message: "Selecione a obra cadastrada",
    path: ["constructionProjectId"],
  })
  .refine(v => v.businessType === "obra" || v.propertyId !== null, {
    message: "Selecione o imóvel cadastrado",
    path: ["propertyId"],
  });
export const projectInput = z
  .object({
    name,
    types: z.array(z.string().trim().min(1).max(80)).min(1, "Selecione ao menos um tipo de projeto.").max(20),
    status: z.enum(PROJECT_STATUS),
    clientName: name,
    clientPhone: z.string().trim().max(40),
    // Item 07: o engenheiro é um colaborador escolhido por ID; o nome vem do cadastro.
    // Texto livre só é aceito para manter registros anteriores sem vínculo.
    engineerUserId: id.nullable().default(null),
    engineer: z.string().trim().max(255).default(""),
    engineerRegistration: z.string().trim().max(60).nullable().default(null),
    value: money,
    paidValue: money,
    deadline: z.coerce.date().nullable(),
    leadId: id.nullable(),
    description: notes,
    checklist: z
      .array(
        z.object({ text: z.string().trim().min(1).max(500), done: z.boolean() })
      )
      .max(100),
    files: z
      .array(
        z.object({
          name,
          url: z
            .string()
            .url()
            .refine(v => v.startsWith("https://"), "Use um link HTTPS"),
        })
      )
      .max(100),
  })
  .refine(v => v.paidValue <= v.value, {
    message: "Valor pago não pode superar o valor do projeto",
    path: ["paidValue"],
  });
export function commissionPaidAt(status: string, previous: Date | null = null) {
  return status === "paga" ? (previous ?? new Date()) : null;
}
export function validCoordinates(lat: string | null, lng: string | null) {
  return (
    lat !== null &&
    lng !== null &&
    lat.trim() !== "" &&
    lng.trim() !== "" &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lng)) <= 180
  );
}
