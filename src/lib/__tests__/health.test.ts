import { describe, expect, it, vi } from "vitest";
import { buildHealthReport } from "@/lib/health";

describe("health report", () => {
  it("fica saudável quando o banco responde", async () => {
    const probe = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const report = await buildHealthReport(probe, {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "1234567890abcdef",
    });

    expect(report.status).toBe("ok");
    expect(report.checks.database).toBe("ok");
    expect(report.version).toBe("1234567890ab");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("fica degradado sem expor o erro do banco", async () => {
    const report = await buildHealthReport(
      async () => {
        throw new Error("postgresql://usuario:senha@producao/banco");
      },
      { NODE_ENV: "production" },
    );

    expect(report.status).toBe("degraded");
    expect(report.checks.database).toBe("error");
    expect(JSON.stringify(report)).not.toContain("senha");
  });
});
