import { describe, expect, it } from "vitest";
import { verifyReleaseEnvironment } from "./release-preflight.mjs";

const previewEnvironment = {
  AUTH_SECRET: "auth-preview-secret",
  JWT_SECRET: "jwt-preview-secret",
  DATABASE_URL: "postgresql://user:password@preview-db.example.com:5432/prospecta_preview",
  ASAAS_ENVIRONMENT: "sandbox",
  ASAAS_API_KEY: "sandbox-key",
  ASAAS_WEBHOOK_TOKEN: "sandbox-webhook",
  BLOB_READ_WRITE_TOKEN: "preview-blob",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/nextjs-santa-fe-unification",
  EXPECTED_PREVIEW_BRANCH: "codex/nextjs-santa-fe-unification",
};

describe("release preflight", () => {
  it("aprova um preview isolado e completo", () => {
    const result = verifyReleaseEnvironment(previewEnvironment, {
      target: "preview",
      profile: "full",
    });

    expect(result.ok).toBe(true);
    expect(result.databaseFingerprint).toHaveLength(16);
  });

  it("reprova ausência de segredos sem expor valores", () => {
    const result = verifyReleaseEnvironment({}, { target: "preview", profile: "full" });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("AUTH_SECRET");
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("reprova Asaas de produção no preview", () => {
    const result = verifyReleaseEnvironment(
      { ...previewEnvironment, ASAAS_ENVIRONMENT: "production" },
      { target: "preview", profile: "full" },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("ASAAS_ENVIRONMENT deve ser sandbox no preview.");
  });

  it("reprova banco que coincide com o fingerprint de produção", () => {
    const baseline = verifyReleaseEnvironment(previewEnvironment, {
      target: "preview",
      profile: "full",
    });
    const result = verifyReleaseEnvironment(
      { ...previewEnvironment, PRODUCTION_DATABASE_FINGERPRINT: baseline.databaseFingerprint },
      { target: "preview", profile: "full" },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("O banco do preview coincide com o fingerprint de produção.");
  });

  it("exige autorização explícita no target de produção", () => {
    const result = verifyReleaseEnvironment(
      { ...previewEnvironment, VERCEL_ENV: "production", ASAAS_ENVIRONMENT: "production" },
      { target: "production", profile: "full" },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "CONFIRM_PRODUCTION_RELEASE não autoriza a janela de produção.",
    );
  });
});
