import { getDb } from "./db";
import { sql } from "drizzle-orm";

/**
 * Schedule 10 attempts × 3 sub-attempts = 30 follow-up rows for a new lead.
 * Attempts are 1 day apart starting from tomorrow.
 * Sub-attempts within each day: 08:00, 10:00, 12:00.
 */
export async function scheduleLeadFollowUps(leadId: number): Promise<void> {
  const db = getDb();

  try {
    const rows: { leadId: number; attempt: number; subAttempt: number; scheduledAt: Date; status: string }[] = [];

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const HOURS = [8, 10, 12];

    for (let attempt = 1; attempt <= 10; attempt++) {
      for (let subIdx = 0; subIdx < HOURS.length; subIdx++) {
        const scheduledAt = new Date(tomorrow);
        scheduledAt.setDate(tomorrow.getDate() + (attempt - 1));
        scheduledAt.setHours(HOURS[subIdx], 0, 0, 0);

        rows.push({
          leadId,
          attempt,
          subAttempt: subIdx + 1,
          scheduledAt,
          status: "pending",
        });
      }
    }

    for (const row of rows) {
      await db.execute(sql`
        INSERT INTO lead_follow_ups (lead_id, attempt, sub_attempt, scheduled_at, status, created_at)
        VALUES (${row.leadId}, ${row.attempt}, ${row.subAttempt}, ${row.scheduledAt}, ${row.status}, NOW())
      `);
    }

    console.log(`[FollowUpScheduler] Scheduled ${rows.length} follow-ups for lead ${leadId}`);
  } catch (error) {
    console.error("[FollowUpScheduler] Error scheduling follow-ups:", error);
  }
}

/**
 * Process pending follow-ups that are due.
 */
async function processPendingFollowUps(): Promise<void> {
  const db = getDb();

  try {
    // Get all pending follow-ups that are due
    const pending = await db.execute(sql`
      SELECT lf.id, lf.lead_id, lf.attempt, lf.sub_attempt, lf.scheduled_at,
             l.temperature, l.name as lead_name
      FROM lead_follow_ups lf
      JOIN leads l ON l.id = lf.lead_id
      WHERE lf.status = 'pending'
        AND lf.scheduled_at <= NOW()
      ORDER BY lf.scheduled_at ASC
      LIMIT 100
    `);

    const rows = (pending as any).rows || (Array.isArray(pending) ? pending : []);
    const followUps: any[] = Array.isArray(rows) ? rows : [];

    for (const fu of followUps) {
      try {
        // Mark as sent
        await db.execute(sql`
          UPDATE lead_follow_ups
          SET status = 'sent', executed_at = NOW()
          WHERE id = ${fu.id}
        `);

        console.log(`[FollowUpScheduler] Processed follow-up #${fu.id} for lead ${fu.lead_id} (attempt ${fu.attempt}.${fu.sub_attempt})`);

        // If this is the 10th attempt (last one), escalate
        if (fu.attempt === 10 && fu.sub_attempt === 3) {
          await db.execute(sql`
            INSERT INTO tasks (title, description, assigned_to, priority, status, due_date, lead_id, created_at, updated_at)
            VALUES (
              ${`ESCALONAMENTO: Lead sem resposta após 10 tentativas`},
              ${`Lead "${fu.lead_name}" (ID: ${fu.lead_id}) não respondeu após 10 tentativas de follow-up. Ação manual necessária.`},
              'vinicius',
              'critical',
              'pending',
              NOW(),
              ${fu.lead_id},
              NOW(),
              NOW()
            )
          `);
          console.log(`[FollowUpScheduler] Escalation task created for lead ${fu.lead_id}`);
        }

        // If no response after any attempt, cool down the lead temperature
        if (fu.attempt >= 3 && fu.temperature === "warm") {
          await db.execute(sql`
            UPDATE leads SET temperature = 'cold', updated_at = NOW()
            WHERE id = ${fu.lead_id}
          `);
          console.log(`[FollowUpScheduler] Lead ${fu.lead_id} temperature set to cold`);
        }
      } catch (innerErr) {
        console.error(`[FollowUpScheduler] Error processing follow-up #${fu.id}:`, innerErr);
      }
    }

    // Check for leads rejected > 6 months ago and schedule new cycle
    try {
      const oldRejected = await db.execute(sql`
        SELECT l.id, l.name
        FROM leads l
        WHERE l.stage = 'rejected'
          AND l.updated_at <= DATE_SUB(NOW(), INTERVAL 6 MONTH)
          AND NOT EXISTS (
            SELECT 1 FROM lead_follow_ups lf2
            WHERE lf2.lead_id = l.id
              AND lf2.status = 'pending'
              AND lf2.attempt = 1
          )
        LIMIT 20
      `);

      const rejectedRows = (oldRejected as any).rows || (Array.isArray(oldRejected) ? oldRejected : []);
      const rejectedLeads: any[] = Array.isArray(rejectedRows) ? rejectedRows : [];

      for (const lead of rejectedLeads) {
        console.log(`[FollowUpScheduler] Re-scheduling follow-ups for rejected lead ${lead.id} after 6 months`);
        await scheduleLeadFollowUps(lead.id);
      }
    } catch (err) {
      console.error("[FollowUpScheduler] Error checking old rejected leads:", err);
    }
  } catch (error) {
    console.error("[FollowUpScheduler] Error in processPendingFollowUps:", error);
  }
}

/**
 * Start the follow-up scheduler — runs every 15 minutes.
 */
export function startFollowUpScheduler(): void {
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

  console.log("[FollowUpScheduler] Starting — will process follow-ups every 15 minutes");

  // Run immediately on startup
  processPendingFollowUps().catch((err) =>
    console.error("[FollowUpScheduler] Initial run error:", err)
  );

  // Then run every 15 minutes
  setInterval(() => {
    processPendingFollowUps().catch((err) =>
      console.error("[FollowUpScheduler] Scheduled run error:", err)
    );
  }, INTERVAL_MS);
}
