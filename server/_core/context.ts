import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "./auth-utils.js";
import { getUserById } from "../db.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const token = getTokenFromRequest(opts.req);
    if (token) {
      const payload = await verifySessionToken(token);
      if (payload) {
        const loadedUser = await getUserById(payload.userId);
        user = loadedUser?.active ? loadedUser : null;
      }
    }
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
