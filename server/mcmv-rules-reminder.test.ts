import { describe, expect, it, vi, beforeEach } from "vitest";

const getDashboardSetting = vi.fn();
const saveDashboardSetting = vi.fn();
const notifyAdminByEmail = vi.fn();

vi.mock("./db.js", () => ({ getDashboardSetting, saveDashboardSetting }));
vi.mock("./_core/email-smtp.js", () => ({ notifyAdminByEmail }));

describe("checkAndSendReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envia o lembrete e salva a data quando nunca foi enviado antes", async () => {
    getDashboardSetting.mockResolvedValue(undefined);
    notifyAdminByEmail.mockResolvedValue(true);

    const { checkAndSendReminder } = await import("./mcmv-rules-reminder.js");
    await checkAndSendReminder();

    expect(notifyAdminByEmail).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: expect.stringContaining("MCMV") })
    );
    expect(saveDashboardSetting).toHaveBeenCalledWith(
      "mcmv_rules_reminder_last_sent_at",
      expect.any(String)
    );
  });

  it("não envia novamente se o prazo de 30 dias ainda não venceu", async () => {
    const dezDiasAtras = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    getDashboardSetting.mockResolvedValue(dezDiasAtras);

    const { checkAndSendReminder } = await import("./mcmv-rules-reminder.js");
    await checkAndSendReminder();

    expect(notifyAdminByEmail).not.toHaveBeenCalled();
    expect(saveDashboardSetting).not.toHaveBeenCalled();
  });

  it("envia de novo quando já passaram mais de 30 dias do último envio", async () => {
    const trintaCincoDiasAtras = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    getDashboardSetting.mockResolvedValue(trintaCincoDiasAtras);
    notifyAdminByEmail.mockResolvedValue(true);

    const { checkAndSendReminder } = await import("./mcmv-rules-reminder.js");
    await checkAndSendReminder();

    expect(notifyAdminByEmail).toHaveBeenCalledTimes(1);
    expect(saveDashboardSetting).toHaveBeenCalledTimes(1);
  });

  it("não salva a data se o envio do e-mail falhar, para tentar novamente depois", async () => {
    getDashboardSetting.mockResolvedValue(undefined);
    notifyAdminByEmail.mockResolvedValue(false);

    const { checkAndSendReminder } = await import("./mcmv-rules-reminder.js");
    await checkAndSendReminder();

    expect(notifyAdminByEmail).toHaveBeenCalledTimes(1);
    expect(saveDashboardSetting).not.toHaveBeenCalled();
  });
});
