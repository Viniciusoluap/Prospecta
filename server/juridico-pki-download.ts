import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const bloqueados = new BlockList();
for (const [rede, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) bloqueados.addSubnet(rede, bits, "ipv4");

export function urlCertificadora(valor: string) {
  const url = new URL(valor);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port && url.port !== "80" && url.port !== "443" || isIP(url.hostname) || url.hostname.includes(":")) throw new Error("Endereço de certificadora indisponível.");
  return url;
}

/** Somente certificados/LCR públicos. DNS fixado na conexão impede redirecionamento para redes privadas. */
export async function baixarMaterialPki(valor: string, signal: AbortSignal, redirecionamentos = 0): Promise<Buffer> {
  const url = urlCertificadora(valor);
  const destinos = await lookup(url.hostname, { family: 4, all: true });
  if (signal.aborted || !destinos.length || destinos.some(d => bloqueados.check(d.address, "ipv4"))) throw new Error("Consulta à certificadora indisponível.");
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", signal, timeout: 5000,
      lookup: (_hostname, _options, callback) => callback(null, destinos[0].address, 4),
      headers: { Accept: "application/pkix-cert, application/pkix-crl, application/pkcs7-mime, */*", "Accept-Encoding": "identity" },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location && redirecionamentos < 2) {
        response.resume();
        baixarMaterialPki(new URL(response.headers.location, url).href, signal, redirecionamentos + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Certificadora indisponível.")); return; }
      const partes: Buffer[] = [];
      let tamanho = 0;
      response.on("data", (chunk: Buffer) => {
        tamanho += chunk.length;
        if (tamanho > 10 * 1024 * 1024) response.destroy(new Error("Resposta da certificadora acima do limite."));
        else partes.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(partes)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Tempo de consulta à certificadora esgotado.")));
    request.on("error", reject);
    request.end();
  });
}
