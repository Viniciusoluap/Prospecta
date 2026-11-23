// Gera server/certificados/icp-intermediarias.json — intermediárias ICP-Brasil (certificados PÚBLICOS de AC) que a
// conferência de assinaturas usa antes de ir à rede (AIA). Uso (Node 20+), com a pasta do ACcompactado.zip extraída:
//   curl -O http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip  (+ hashsha512.txt)
//   unzip ACcompactado.zip -d /tmp/ac && node scripts/icp-intermediarias.mjs /tmp/ac
// Só entra certificado de AC (CA:TRUE) conferido POR ASSINATURA, salto a salto, até uma raiz de
// server/certificados/icp-raizes.json (as raízes continuam sendo a única âncora de confiança), vigente na data da geração,
// de assinatura de documentos (fora SSL, code signing, carimbo de tempo, SPB, OM-BR) e sem marcação de "retirado".
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const raizDoRepo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ARQ_RAIZES = path.join(raizDoRepo, "server/certificados/icp-raizes.json");
const SAIDA = path.join(raizDoRepo, "server/certificados/icp-intermediarias.json");
const pastas = process.argv.slice(2);
if (!pastas.length) { console.error("Informe a(s) pasta(s) com os .crt do ACcompactado.zip extraído."); process.exit(1); }

/** Raízes RSA usadas pela conferência (v6 Ed448 e v7 com algoritmo próprio ficam de fora: o servidor não confere). */
const RAIZES_SUPORTADAS = /Raiz Brasileira v(5|10|11|12|13)$/;
const NAO_ASSINA_DOCUMENTO = /SSL|CODE ?SIGN|CODESIGN|\bCode\b|TIMESTAMP|Tempo|\bCS\b|OM-BR|SPB/i;

const sha = der => crypto.createHash("sha256").update(der).digest("hex");
const cn = nome => (/(?:^|\n)CN=([^\n]+)/.exec(nome) || [])[1] || nome;
function lerArquivo(arquivo) {
  const bytes = fs.readFileSync(arquivo), texto = bytes.toString("latin1"), ders = [];
  if (texto.includes("-----BEGIN CERTIFICATE-----")) {
    for (const m of texto.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)) ders.push(Buffer.from(m[1].replace(/\s/g, ""), "base64"));
  } else ders.push(bytes);
  return ders.flatMap(der => { try { const x = new crypto.X509Certificate(der); return [{ x, der: Buffer.from(x.raw), arquivo: path.basename(arquivo) }]; } catch { return []; } });
}
const listar = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listar(path.join(d, e.name)) : [path.join(d, e.name)]);

const aceitos = new Map();
for (const r of JSON.parse(fs.readFileSync(ARQ_RAIZES, "utf8"))) {
  const x = new crypto.X509Certificate(r.pem);
  if (RAIZES_SUPORTADAS.test(cn(x.subject))) aceitos.set(sha(Buffer.from(x.raw)), { x, raiz: true });
}
const candidatos = new Map();
for (const pasta of pastas) for (const arquivo of listar(pasta)) {
  if (!/\.(crt|cer|pem|der)$/i.test(arquivo) || /retir/i.test(arquivo)) continue;
  for (const c of lerArquivo(arquivo)) if (!candidatos.has(sha(c.der))) candidatos.set(sha(c.der), c);
}
for (let mudou = true; mudou;) {
  mudou = false;
  for (const [h, c] of candidatos) {
    if (aceitos.has(h) || !c.x.ca || c.x.subject === c.x.issuer) continue;
    for (const [hp, p] of aceitos) {
      let ok = false;
      try { ok = p.x.subject === c.x.issuer && c.x.checkIssued(p.x) && c.x.verify(p.x.publicKey); } catch { ok = false; }
      if (ok) { aceitos.set(h, { ...c, pai: hp }); mudou = true; break; }
    }
  }
}
const agora = new Date();
const lista = [...aceitos.entries()].filter(([, a]) => !a.raiz).map(([h, a]) => {
  let topo = a.pai; while (!aceitos.get(topo).raiz) topo = aceitos.get(topo).pai;
  return { nome: cn(a.x.subject), emissor: cn(aceitos.get(a.pai).x.subject), raiz: cn(aceitos.get(topo).x.subject), arquivo: a.arquivo, sha256: h,
    validoDe: new Date(a.x.validFrom).toISOString().slice(0, 10), validoAte: new Date(a.x.validTo).toISOString().slice(0, 10), der: a.der.toString("base64"),
    vigente: new Date(a.x.validFrom) <= agora && new Date(a.x.validTo) > agora };
}).filter(l => l.vigente && !NAO_ASSINA_DOCUMENTO.test(l.nome))
  .sort((a, b) => a.raiz.localeCompare(b.raiz) || a.emissor.localeCompare(b.emissor) || a.nome.localeCompare(b.nome))
  .map(({ vigente, ...resto }) => resto);
fs.writeFileSync(SAIDA, `${JSON.stringify(lista, null, 1)}\n`);
console.log(`${candidatos.size} certificados lidos; ${lista.length} intermediárias gravadas em ${path.relative(raizDoRepo, SAIDA)}.`);
for (const l of lista) console.log(`| ${l.nome} | ${l.emissor} | ${l.validoAte} | \`${l.sha256}\` |`);
