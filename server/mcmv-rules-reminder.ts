import { getDashboardSetting, saveDashboardSetting } from "./db.js";

/**
 * Lembrete periódico por e-mail: não existe API pública oficial da Caixa/MCMV
 * para as faixas de renda, subsídio e taxa de juros usadas no simulador
 * (client/src/pages/SimuladorFinanciamento.tsx). A cada 30 dias, avisa o
 * admin por e-mail para conferir a portaria vigente e, se preciso, atualizar
 * os valores manualmente. Não há scraping de fonte não-oficial nem aviso
 * visual no simulador público — decisão registrada em
 * docs/stories/epics/epic-014-correcoes-site-institucional/PLANO-EXECUCAO.md.
 */
const SETTING_KEY = "mcmv_rules_reminder_last_sent_at";
const INTERVAL_DAYS = 30;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // verifica a cada 6h se já passou o prazo

export async function checkAndSendReminder(): Promise<void> {
  try {
    const lastSentRaw = await getDashboardSetting(SETTING_KEY);
    const lastSentAt = lastSentRaw ? new Date(lastSentRaw) : null;
    const dueAt = lastSentAt ? new Date(lastSentAt.getTime() + INTERVAL_DAYS * 24 * 60 * 60 * 1000) : new Date();

    if (lastSentAt && dueAt > new Date()) {
      return; // ainda não venceu o prazo de 30 dias
    }

    const { notifyAdminByEmail } = await import("./_core/email-smtp.js");
    const sent = await notifyAdminByEmail({
      titulo: "Revisão periódica das regras do MCMV no simulador",
      linhas: [
        {
          label: "O que fazer",
          valor:
            "Conferir a portaria vigente da Caixa/Ministério das Cidades (faixas de renda, subsídio máximo e taxa de juros) e atualizar os valores em client/src/pages/SimuladorFinanciamento.tsx se houver mudança.",
        },
        { label: "Motivo", valor: "Não existe API pública oficial para essas regras; a atualização é manual." },
        { label: "Periodicidade", valor: `A cada ${INTERVAL_DAYS} dias` },
      ],
    });

    if (sent) {
      await saveDashboardSetting(SETTING_KEY, new Date().toISOString());
      console.log("[McmvRulesReminder] Lembrete enviado ao admin");
    } else {
      console.error("[McmvRulesReminder] Falha ao enviar lembrete; tentará novamente na próxima verificação");
    }
  } catch (error) {
    console.error("[McmvRulesReminder] Erro ao verificar/enviar lembrete:", error);
  }
}

/** Inicia a verificação periódica do lembrete de 30 dias. */
export function startMcmvRulesReminder(): void {
  console.log(`[McmvRulesReminder] Iniciando — lembrete ao admin a cada ${INTERVAL_DAYS} dias`);

  checkAndSendReminder().catch((err) =>
    console.error("[McmvRulesReminder] Erro na verificação inicial:", err)
  );

  setInterval(() => {
    checkAndSendReminder().catch((err) =>
      console.error("[McmvRulesReminder] Erro na verificação agendada:", err)
    );
  }, CHECK_INTERVAL_MS);
}
