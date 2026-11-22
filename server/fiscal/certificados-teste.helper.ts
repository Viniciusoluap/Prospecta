// EPIC-029 S-4 — SÓ PARA TESTES: gera certificados de TESTE (sem nenhum valor) com o openssl, numa pasta temporária.
// Nunca lê nem usa certificado real. Mesmo padrão de server/juridico-certificados.test.ts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SENHA_TESTE = "senha-de-teste-sem-valor-7Q";

export type CertTeste = { pfx: Buffer; pfxLegado: Buffer; certPem: string; chavePem: string; impressao: string };

export function pastaDeTeste() {
  const dir = mkdtempSync(join(tmpdir(), "prospecta-fiscal-teste-"));
  return { dir, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Certificado autoassinado de TESTE. `uso` controla o EKU; `ac` marca CA:TRUE. */
export function gerarCertificado(dir: string, nome: string, o: { cnpj?: string; cn?: string; uso?: "clientAuth" | "serverAuth" | null; ac?: boolean; dias?: number } = {}): CertTeste {
  const cnpj = o.cnpj ?? "11222333000181";
  const cn = o.cn ?? `EMPRESA TESTE SEM VALOR:${cnpj}`;
  const linhas = ["[req]", "distinguished_name=dn", "prompt=no", "[dn]", "C=BR", "O=TESTE SEM VALIDADE", `CN=${cn}`, "[ext]",
    `basicConstraints=critical,CA:${o.ac ? "TRUE" : "FALSE"}`, "keyUsage=critical,digitalSignature,nonRepudiation,keyEncipherment" + (o.ac ? ",keyCertSign" : ""),
    ...(o.uso === null ? [] : [`extendedKeyUsage=${o.uso ?? "clientAuth"}`]),
    ...(cnpj ? [`subjectAltName=otherName:2.16.76.1.3.3;UTF8:${cnpj}`] : [])];
  const cfg = join(dir, `${nome}.cnf`);
  writeFileSync(cfg, linhas.join("\n"));
  const k = join(dir, `${nome}-key.pem`), c = join(dir, `${nome}.pem`);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", k, "-out", c, "-days", String(o.dias ?? 20), "-config", cfg, "-extensions", "ext"], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs12", "-export", "-inkey", k, "-in", c, "-out", join(dir, `${nome}.pfx`), "-passout", `pass:${SENHA_TESTE}`], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs12", "-export", "-legacy", "-inkey", k, "-in", c, "-out", join(dir, `${nome}-legado.pfx`), "-passout", `pass:${SENHA_TESTE}`], { stdio: "ignore" });
  const impressao = execFileSync("openssl", ["x509", "-in", c, "-noout", "-fingerprint", "-sha256"]).toString().split("=")[1]!.trim().replace(/:/g, "").toLowerCase();
  return {
    pfx: readFileSync(join(dir, `${nome}.pfx`)), pfxLegado: readFileSync(join(dir, `${nome}-legado.pfx`)),
    certPem: readFileSync(c, "utf8"), chavePem: readFileSync(k, "utf8"), impressao,
  };
}
