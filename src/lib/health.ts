export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  version: string;
  environment: string;
  checks: {
    application: "ok";
    database: "ok" | "error";
  };
}

interface HealthEnvironment {
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}

export async function buildHealthReport(
  databaseProbe: () => Promise<unknown>,
  env: HealthEnvironment = process.env,
): Promise<HealthReport> {
  let database: "ok" | "error" = "ok";

  try {
    await databaseProbe();
  } catch {
    database = "error";
  }

  return {
    status: database === "ok" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
    environment: env.VERCEL_ENV || env.NODE_ENV || "unknown",
    checks: {
      application: "ok",
      database,
    },
  };
}
