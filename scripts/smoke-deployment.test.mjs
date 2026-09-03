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
});
