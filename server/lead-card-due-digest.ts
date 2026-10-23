import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { leads, userNotifications, users } from "../drizzle/schema.js";
import { sendEmail } from "./_core/email-smtp.js";
import { getDb } from "./db.js";
import { SEPARADOR_ITENS, datasParaBR, linhaPrazoCard, tituloPrazosCards } from "../shared/notificacao-formato.js";
import { ensureLeadCardDeadlineSchema, todayInImperatriz } from "./lead-card-deadline-schema.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] || c);

/** A single digest per recipient, with independent due dates for each lead. */
export async function sendLeadCardDueDigests(now = new Date()) {
  await ensureLeadCardDeadlineSchema();
  const database = getDb();
  const today = todayInImperatriz(now);
  const [recipients, dueLeads] = await Promise.all([
    database.select({ id: users.id, email: users.email, role: users.role }).from(users)
      .where(and(eq(users.active, true), inArray(users.role, ["admin", "colaborador"]))),
    database.select({ id: leads.id, name: leads.name, stage: leads.stage,
      responsibleUserId: leads.responsibleUserId, cardDueDate: leads.cardDueDate })
      .from(leads).where(and(isNull(leads.deletedAt), ne(leads.stage, "finalized"),
        isNotNull(leads.cardDueDate), lte(leads.cardDueDate, today))),
  ]);
  let emailSent = 0;
  let notifications = 0;
  for (const recipient of recipients) {
    const assigned = dueLeads.filter(lead => recipient.role === "admin" || lead.responsibleUserId === recipient.id);
    if (!assigned.length) continue;
    const pending: Record<"email" | "notice", typeof assigned> = { email: [], notice: [] };
    for (const channel of ["email", "notice"] as const) {
      const recorded = await database.execute(sql`SELECT lead_id, due_date::text AS due_date
        FROM lead_card_due_alerts WHERE user_id = ${recipient.id} AND channel = ${channel}`);
      const sentKeys = new Set(recorded.rows.map(row => `${row.lead_id}:${row.due_date}`));
      pending[channel] = assigned.filter(lead => !sentKeys.has(`${lead.id}:${lead.cardDueDate}`));
    }
    if (!pending.email.length && !pending.notice.length) continue;

    // Claim by recipient/day: parallel cron invocations cannot send two digests.
    const claim = await database.execute(sql`INSERT INTO lead_card_due_digest_claims (user_id, digest_date)
      VALUES (${recipient.id}, ${today}::date) ON CONFLICT DO NOTHING RETURNING user_id`);
    if (!claim.rows.length) continue;
    try {
      if (pending.notice.length) {
        const count = pending.notice.length;
        await database.insert(userNotifications).values({
          // H4 (23/10): título curto e um cliente por linha, com data no padrão BR.
          userId: recipient.id, type: "system", title: tituloPrazosCards(count),
          message: pending.notice.map(lead => linhaPrazoCard(lead.name, lead.cardDueDate)).join(SEPARADOR_ITENS),
          actionUrl: "/admin/crm",
        });
        for (const lead of pending.notice) await database.execute(sql`INSERT INTO lead_card_due_alerts
          (user_id, lead_id, due_date, channel) VALUES (${recipient.id}, ${lead.id}, ${lead.cardDueDate}::date, 'notice')
          ON CONFLICT DO NOTHING`);
        notifications++;
      }
      if (pending.email.length && recipient.email) {
        const origin = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
        const lines = pending.email.map(lead => `<li>${escapeHtml(lead.name)} — prazo ${escapeHtml(datasParaBR(lead.cardDueDate!))} — ${origin ? `<a href="${escapeHtml(origin)}/admin/crm/${lead.id}">Abrir lead #${lead.id}</a>` : `Lead #${lead.id}`}</li>`).join("");
        const sent = await sendEmail({
          to: recipient.email,
          subject: `[CRM] ${tituloPrazosCards(pending.email.length)}`,
          html: `<p>Estes cards precisam da sua atenção hoje:</p><ul>${lines}</ul><p>Acesse o CRM para atualizar cada card.</p>`,
          templateType: "admin_notification",
        });
        if (sent) {
          for (const lead of pending.email) await database.execute(sql`INSERT INTO lead_card_due_alerts
            (user_id, lead_id, due_date, channel) VALUES (${recipient.id}, ${lead.id}, ${lead.cardDueDate}::date, 'email')
            ON CONFLICT DO NOTHING`);
          emailSent++;
        }
      }
    } finally {
      // Failed emails can be retried, while successful channels remain deduplicated.
      if (pending.email.length && recipient.email) {
        const remaining = await database.execute(sql`SELECT 1 FROM lead_card_due_alerts WHERE user_id = ${recipient.id}
          AND channel = 'email' AND lead_id = ${pending.email[0].id} AND due_date = ${pending.email[0].cardDueDate}::date LIMIT 1`);
        if (!remaining.rows.length) await database.execute(sql`DELETE FROM lead_card_due_digest_claims WHERE user_id = ${recipient.id} AND digest_date = ${today}::date`);
      }
    }
  }
  return { emailSent, notifications };
}
