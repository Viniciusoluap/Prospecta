import { describe, expect, it } from "vitest";
import { checkRoute } from "./smoke-deployment.mjs";

describe("deployment smoke", () => {
  it("aprova resposta com conteúdo na mesma origem", async () => {
    const result = await checkRoute(
      new URL("https://preview.example.com"),
      "/",
      2_000,
      async () => new Response("Prospecta", { status: 200 }),
    );

    expect(result.ok).toBe(true);
  });

  it("reprova redirecionamento externo de proteção", async () => {
    const result = await checkRoute(
      new URL("https://preview.example.com"),
      "/",
      2_000,
      async () => {
        const response = new Response("Redirecting", { status: 200 });
        Object.defineProperty(response, "url", { value: "https://vercel.com/sso-api" });
        return response;
      },
    );

    expect(result.ok).toBe(false);
    expect(result.finalPath).toBe("EXTERNAL_REDIRECT");
  });

  it("envia o bypass de automação sem colocá-lo no resultado", async () => {
    let capturedHeaders;
    const result = await checkRoute(
      new URL("https://preview.example.com"),
      "/api/health",
      2_000,
      async (_url, init) => {
        capturedHeaders = init.headers;
        return new Response("ok", { status: 200 });
      },
      "preview-bypass-secret",
    );

    expect(capturedHeaders["x-vercel-protection-bypass"]).toBe("preview-bypass-secret");
    expect(capturedHeaders["x-vercel-set-bypass-cookie"]).toBe("true");
    expect(JSON.stringify(result)).not.toContain("preview-bypass-secret");
  });
});
