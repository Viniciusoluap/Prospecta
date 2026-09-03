import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const CORE_KEYS = ["AUTH_SECRET", "JWT_SECRET"];
const FULL_KEYS = ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN", "BLOB_READ_WRITE_TOKEN"];

function valuePresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function databaseFingerprint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const identity = `${parsed.hostname}:${parsed.port || "default"}${parsed.pathname}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export function verifyReleaseEnvironment(env, { target, profile = "full" }) {
  if (!['preview', 'production'].includes(target)) {
    throw new Error("Target inválido. Use preview ou production.");
  }

  if (!['core', 'full'].includes(profile)) {
    throw new Error("Profile inválido. Use core ou full.");
  }

  const missing = CORE_KEYS.filter((key) => !valuePresent(env[key]));
  const databaseUrl = env.DATABASE_URL || env.DATABASE_URL_UNPOOLED;

  if (!valuePresent(databaseUrl)) {
    missing.push("DATABASE_URL|DATABASE_URL_UNPOOLED");
  }

  if (profile === "full") {
    missing.push(...FULL_KEYS.filter((key) => !valuePresent(env[key])));
  }

  const errors = [];
  if (missing.length > 0) {
    errors.push(`Variáveis ausentes: ${missing.join(", ")}`);
  }

  if (valuePresent(env.AUTH_SECRET) && env.AUTH_SECRET === env.JWT_SECRET) {
    errors.push("AUTH_SECRET e JWT_SECRET devem ser distintos.");
  }

  if (target === "preview") {
    if (valuePresent(env.VERCEL_ENV) && env.VERCEL_ENV !== "preview") {
      errors.push(`VERCEL_ENV deve ser preview, recebido ${env.VERCEL_ENV}.`);
    }
    if (profile === "full" && env.ASAAS_ENVIRONMENT !== "sandbox") {
      errors.push("ASAAS_ENVIRONMENT deve ser sandbox no preview.");
    }
    if (
      valuePresent(env.EXPECTED_PREVIEW_BRANCH) &&
      valuePresent(env.VERCEL_GIT_COMMIT_REF) &&
      env.EXPECTED_PREVIEW_BRANCH !== env.VERCEL_GIT_COMMIT_REF
    ) {
      errors.push("A branch do deployment não corresponde à branch esperada.");
    }
  }

  if (target === "production") {
    if (valuePresent(env.VERCEL_ENV) && env.VERCEL_ENV !== "production") {
      errors.push(`VERCEL_ENV deve ser production, recebido ${env.VERCEL_ENV}.`);
    }
    if (profile === "full" && env.ASAAS_ENVIRONMENT !== "production") {
      errors.push("ASAAS_ENVIRONMENT deve ser production no release final.");
    }
    if (env.CONFIRM_PRODUCTION_RELEASE !== "RELEASE_AUTORIZADO") {
      errors.push("CONFIRM_PRODUCTION_RELEASE não autoriza a janela de produção.");
    }
  }

  let fingerprint = null;
  if (valuePresent(databaseUrl)) {
    try {
      fingerprint = databaseFingerprint(databaseUrl);
      if (
        target === "preview" &&
        valuePresent(env.PRODUCTION_DATABASE_FINGERPRINT) &&
        fingerprint === env.PRODUCTION_DATABASE_FINGERPRINT
      ) {
        errors.push("O banco do preview coincide com o fingerprint de produção.");
      }
    } catch {
      errors.push("A URL do banco não possui formato válido.");
    }
  }

  return {
    ok: errors.length === 0,
    target,
    profile,
    databaseFingerprint: fingerprint,
    checkedKeys: [...CORE_KEYS, "DATABASE_URL|DATABASE_URL_UNPOOLED", ...(profile === "full" ? FULL_KEYS : [])],
    errors,
  };
}

function parseArguments(argv) {
  const read = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  return {
    target: read("--target", "preview"),
    profile: read("--profile", "full"),
  };
}

async function main() {
  const result = verifyReleaseEnvironment(process.env, parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
