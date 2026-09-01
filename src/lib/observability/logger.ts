import { randomUUID } from "node:crypto";

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;

export function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id") ?? randomUUID();
}

export function logOperationalError(
  event: string,
  error: unknown,
  context: LogContext = {},
): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(JSON.stringify({
    ...context,
    timestamp: new Date().toISOString(),
    level: "error",
    event,
    errorName,
  }));
}
