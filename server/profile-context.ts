import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema.js";

type SessionUser = Pick<User, "id" | "role" | "active" | "leadId">;

export type ClientContext = { userId: number; leadId: number };
export type BrokerContext = { userId: number; brokerId: number };

export function requireClientContext(
  user: SessionUser | null | undefined
): ClientContext {
  if (!user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Faça login como cliente",
    });
  if (!user.active || user.role !== "cliente") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Esta conta não possui perfil de cliente",
    });
  }
  if (!user.leadId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Perfil de cliente ainda não vinculado ao cadastro",
    });
  }
  return { userId: user.id, leadId: user.leadId };
}

export function requireBrokerContext(
  user: SessionUser | null | undefined
): BrokerContext {
  if (!user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Faça login como corretor",
    });
  if (!user.active || user.role !== "corretor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Esta conta não possui perfil de corretor",
    });
  }
  return { userId: user.id, brokerId: user.id };
}

export function isActiveFinancingStatus(status: string): boolean {
  return status !== "liberado" && status !== "cancelado";
}
