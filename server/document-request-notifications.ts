import { and, eq, isNull } from "drizzle-orm";
import { leads, users, userNotifications } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { sendEmail, adminNotificationTemplate } from "./_core/email-smtp.js";

/** Notificação fica vinculada ao usuário cliente; email usa sempre o cadastro atual do CRM. */
export async function notifyClientDocumentRequest(leadId: number, document: string, path = "/portal/documentos") {
  const db = getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1);
  if (!lead) throw new Error("Cliente não encontrado no CRM");
  const clients = await db.select({ id: users.id }).from(users).where(and(eq(users.leadId, leadId), eq(users.role, "cliente"), eq(users.active, true)));
  const title = "Documento solicitado";
  const message = `Solicitamos: ${document}. Acesse seu portal para enviar o arquivo.`;
  if (clients.length) await db.insert(userNotifications).values(clients.map(user => ({ userId: user.id, title, message, type: "system" as const, relatedId: leadId, actionUrl: path })));
  if (!lead.email?.trim()) return { emailSent: false, emailWarning: "Cliente sem email cadastrado no CRM. Solicitação disponível no portal." };
  const origin = process.env.PUBLIC_SITE_URL || "https://www.prospectaconstrucoes.com";
  const template = adminNotificationTemplate({ titulo: title, linhas: [{ label: "Cliente", valor: lead.name }, { label: "Documento", valor: document }, { label: "Portal", valor: `${origin}${path}` }] });
  const emailSent = await sendEmail({ to: lead.email.trim(), recipientName: lead.name, subject: template.subject, html: template.html, templateType: "admin_notification", metadata: { leadId, document, kind: "document_request" } });
  return { emailSent, emailWarning: emailSent ? null : "Solicitação registrada, mas o email não foi enviado. Tente solicitar novamente." };
}
