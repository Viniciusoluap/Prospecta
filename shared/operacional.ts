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
    responsibleName: z.string().trim().max(255),
    notes,
  })
  .refine(v => v.leadId !== null || v.clientName.length >= 2, {
    message: "Selecione um lead ou informe o cliente",
    path: ["clientName"],
  });
export const brokerInput = z.object({
  name,
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(20),
  creci: z.string().trim().min(1).max(40),
  active: z.boolean(),
  avatar: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .refine(v => v.startsWith("https://")),
  ]),
  specialties: z.array(z.string().trim().min(1).max(80)).max(30),
  notes,
});
export const commissionInput = z
  .object({
    beneficiary: z.enum(["corretor", "empresa"]),
    businessType: z.enum([
      "venda_imovel",
      "locacao",
      "construcao",
      "financiamento",
      "outro",
    ]),
    brokerId: id.nullable(),
    property: name,
    amount: money,
    percent: z.number().min(0).max(100),
    status: z.enum(COMMISSION_STATUS),
    dueDate: z.coerce.date(),
    notes,
  })
  .refine(v => v.beneficiary !== "corretor" || v.brokerId !== null, {
    message: "Selecione o corretor",
    path: ["brokerId"],
  });
export const projectInput = z
  .object({
    name,
    types: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    status: z.enum(PROJECT_STATUS),
    clientName: name,
    clientPhone: z.string().trim().max(40),
    engineer: name,
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
