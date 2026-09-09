import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { COOKIE_NAME } from "../shared/const.js";
import { getTokenFromRequest, SESSION_COOKIE_NAME } from "./_core/auth-utils.js";
import { getSessionCookieOptions } from "./_core/cookies.js";

function request(headers: Record<string, string> = {}, protocol = "http") {
  return { headers, protocol } as Request;
}

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("production session contract", () => {
  it("uses one canonical cookie name across login and session reading", () => {
    expect(SESSION_COOKIE_NAME).toBe(COOKIE_NAME);
    expect(getTokenFromRequest(request({ cookie: `${COOKIE_NAME}=signed-token` }))).toBe("signed-token");
  });

  it("uses a Safari-compatible same-origin cookie policy in production", () => {
    process.env.NODE_ENV = "production";

    expect(getSessionCookieOptions(request())).toEqual({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("recognizes TLS terminated by a trusted proxy", () => {
    process.env.NODE_ENV = "test";

    expect(getSessionCookieOptions(request({ "x-forwarded-proto": "https" }))).toMatchObject({
      sameSite: "lax",
      secure: true,
    });
  });

  it("keeps local HTTP development usable", () => {
    process.env.NODE_ENV = "development";

    expect(getSessionCookieOptions(request())).toMatchObject({
      sameSite: "lax",
      secure: false,
    });
  });
});
