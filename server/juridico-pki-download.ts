// Jurídico — download de certificados (AIA) e LCR (CRL DP) públicos para a conferência ICP-Brasil (22/11/2026).
//
// Segurança (SSRF): este módulo NUNCA recebe URL digitada pelo usuário. Só é chamado por server/juridico-pki.ts com
// endereços lidos das extensões AIA/CRL de certificados que já estão em conferência. Como um certificado pode ser
// fabricado por quem envia o PDF, o endereço continua sendo tratado como hostil:
//   - só http/https, porta padrão, sem usuário/senha, sem IP literal (IPv4 ou IPv6) e com nome de domínio completo;
//   - o nome é resolvido SÓ em IPv4 (IPv6 recusado: nenhuma conexão é aberta por IPv6); TODOS os endereços devolvidos
//     precisam ser públicos; a conexão usa o IP conferido (fixado), sem nova resolução (evita "DNS rebinding");
//   - redirecionamentos contam como novas requisições e passam pela mesma conferência;
//   - prazo total por sessão (inclui DNS, conexões e redirecionamentos), limite de requisições, de bytes por resposta e
//     por sessão, e de requisições simultâneas no processo;
//   - o conteúdo baixado nunca é devolvido ao usuário: só serve se for certificado/LCR que confere criptograficamente.
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

export const LIMITES_PKI = {
  prazoTotalMs: 18_000,
  prazoConexaoMs: 5_000,
  requisicoesPorSessao: 12,
  redirecionamentos: 2,
  bytesPorResposta: 10 * 1024 * 1024,
  bytesPorSessao: 24 * 1024 * 1024,
  concorrenciaGlobal: 4,
  tamanhoUrl: 1024,
} as const;

/** Falha de rede ou de disponibilidade: a conferência fica pendente e pode ser tentada de novo. */
export class ErroRedePki extends Error {
  readonly transitoria = true;
  constructor(message: string) { super(message); this.name = "ErroRedePki"; }
}
/** Endereço recusado pela política (rede privada, IP literal, porta etc.): repetir não resolve. */
export class EnderecoRecusadoPki extends Error {
  readonly transitoria = false;
  constructor(message = "Endereço de certificadora recusado.") { super(message); this.name = "EnderecoRecusadoPki"; }
}

const bloqueados = new BlockList();
for (const [rede, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) bloqueados.addSubnet(rede, bits, "ipv4");

export function ipPublico(ip: string): boolean {
  return isIP(ip) === 4 && !bloqueados.check(ip, "ipv4");
}

export function urlCertificadora(valor: string): URL {
  if (typeof valor !== "string" || valor.length > LIMITES_PKI.tamanhoUrl) throw new EnderecoRecusadoPki();
  let url: URL;
  try { url = new URL(valor); } catch { throw new EnderecoRecusadoPki(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const portaPadrao = !url.port || (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !portaPadrao
    || !host || host.includes(":") || host.startsWith("[") || isIP(host) || !host.includes(".")
    || !/^[a-z0-9.-]+$/.test(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new EnderecoRecusadoPki();
  }
  url.hash = "";
  return url;
}

export type Resolver = (host: string) => Promise<string[]>;
export type RespostaPki = { status: number; location?: string; corpo?: Buffer };
export type Transporte = (pedido: { url: URL; ip: string; signal: AbortSignal; limiteBytes: number }) => Promise<RespostaPki>;

const resolverPadrao: Resolver = async host => (await dnsLookup(host, { family: 4, all: true })).map(item => item.address);

function abortavel<T>(promessa: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ErroRedePki("Tempo de consulta à certificadora esgotado."));
  return new Promise((resolve, reject) => {
    const parar = () => reject(new ErroRedePki("Tempo de consulta à certificadora esgotado."));
    signal.addEventListener("abort", parar, { once: true });
    promessa.then(v => { signal.removeEventListener("abort", parar); resolve(v); }, e => { signal.removeEventListener("abort", parar); reject(e); });
  });
}

/** Conexão HTTP(S) com o IP já conferido. Sem agente compartilhado, sem compressão, com limite de bytes. */
export const transportePadrao: Transporte = ({ url, ip, signal, limiteBytes }) => new Promise((resolve, reject) => {
  // Node pode pedir a resolução com `all: true` (autoSelectFamily); as duas formas devolvem só o IP fixado.
  const fixado = ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options?.all) callback(null, [{ address: ip, family: 4 }]);
    else callback(null, ip, 4);
  }) as unknown as LookupFunction;
  const fazer = url.protocol === "https:" ? httpsRequest : httpRequest;
  const req = fazer({
    protocol: url.protocol, hostname: url.hostname, servername: url.hostname, port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80, // urlCertificadora só aceita porta padrão
    path: `${url.pathname}${url.search}`, method: "GET", agent: false, signal, lookup: fixado, family: 4, timeout: LIMITES_PKI.prazoConexaoMs,
    headers: { Accept: "application/pkix-cert, application/pkix-crl, application/pkcs7-mime, application/octet-stream", "Accept-Encoding": "identity", "User-Agent": "Prospecta-Conferencia-ICP/1.0" },
  }, (res: IncomingMessage) => {
    const status = res.statusCode || 0;
    if (status >= 300 && status < 400) { res.resume(); resolve({ status, location: typeof res.headers.location === "string" ? res.headers.location : undefined }); return; }
    if (status !== 200) { res.resume(); resolve({ status }); return; }
    const declarado = Number(res.headers["content-length"]);
    if (Number.isFinite(declarado) && declarado > limiteBytes) { res.destroy(); reject(new ErroRedePki("Resposta da certificadora acima do limite.")); return; }
    const partes: Buffer[] = []; let tamanho = 0;
    res.on("data", (chunk: Buffer) => {
      tamanho += chunk.length;
      if (tamanho > limiteBytes) res.destroy(new ErroRedePki("Resposta da certificadora acima do limite."));
      else partes.push(chunk);
    });
    res.on("end", () => resolve({ status, corpo: Buffer.concat(partes) }));
    res.on("error", e => reject(e instanceof ErroRedePki ? e : new ErroRedePki("Falha na leitura da certificadora.")));
  });
  req.on("timeout", () => req.destroy(new ErroRedePki("Tempo de conexão com a certificadora esgotado.")));
  req.on("error", e => reject(e instanceof ErroRedePki ? e : new ErroRedePki("Certificadora indisponível.")));
  req.end();
});

// Limite de requisições simultâneas no processo inteiro (todas as sessões).
let emUso = 0;
const fila: (() => void)[] = [];
async function ocupar(signal: AbortSignal) {
  if (signal.aborted) throw new ErroRedePki("Tempo de consulta à certificadora esgotado.");
  if (emUso < LIMITES_PKI.concorrenciaGlobal) { emUso++; return; }
  // Na fila, a vaga é passada diretamente por liberar() (emUso não muda); se o prazo vencer antes, sai da fila.
  await new Promise<void>((resolve, reject) => {
    const vez = () => { signal.removeEventListener("abort", desistir); resolve(); };
    const desistir = () => { const i = fila.indexOf(vez); if (i >= 0) fila.splice(i, 1); reject(new ErroRedePki("Tempo de consulta à certificadora esgotado.")); };
    fila.push(vez);
    signal.addEventListener("abort", desistir, { once: true });
  });
}
function liberar() {
  const proxima = fila.shift();
  if (proxima) proxima();
  else emUso--;
}
export function _estadoConcorrencia() { return { emUso, naFila: fila.length }; }

export type OpcoesSessao = { prazoMs?: number; resolver?: Resolver; transporte?: Transporte; requisicoes?: number; signal?: AbortSignal };

/** Uma sessão = uma conferência. Prazo, requisições e bytes são somados em todas as URLs e redirecionamentos. */
export class SessaoPki {
  readonly signal: AbortSignal;
  private readonly resolver: Resolver;
  private readonly transporte: Transporte;
  private readonly maxRequisicoes: number;
  requisicoes = 0;
  bytes = 0;
  falhasTransitorias = 0;
  constructor(opcoes: OpcoesSessao = {}) {
    const prazo = AbortSignal.timeout(Math.max(1, Math.min(opcoes.prazoMs ?? LIMITES_PKI.prazoTotalMs, LIMITES_PKI.prazoTotalMs)));
    this.signal = opcoes.signal ? AbortSignal.any([prazo, opcoes.signal]) : prazo;
    this.resolver = opcoes.resolver ?? resolverPadrao;
    this.transporte = opcoes.transporte ?? transportePadrao;
    this.maxRequisicoes = Math.min(opcoes.requisicoes ?? LIMITES_PKI.requisicoesPorSessao, LIMITES_PKI.requisicoesPorSessao);
  }

  async baixar(endereco: string): Promise<Buffer> {
    try { return await this.baixarSemContar(endereco); }
    catch (e) {
      if (e instanceof EnderecoRecusadoPki) throw e;
      this.falhasTransitorias++;
      throw e instanceof ErroRedePki ? e : new ErroRedePki("Certificadora indisponível.");
    }
  }

  private async baixarSemContar(endereco: string): Promise<Buffer> {
    let url = urlCertificadora(endereco);
    for (let salto = 0; ; salto++) {
      if (this.signal.aborted) throw new ErroRedePki("Tempo de consulta à certificadora esgotado.");
      if (this.requisicoes >= this.maxRequisicoes) throw new ErroRedePki("Limite de consultas à certificadora atingido nesta conferência.");
      this.requisicoes++;
      const ips = await abortavel(this.resolver(url.hostname), this.signal).catch(e => { throw e instanceof ErroRedePki ? e : new ErroRedePki("Endereço da certificadora não encontrado."); });
      if (!Array.isArray(ips) || !ips.length) throw new ErroRedePki("Endereço da certificadora não encontrado.");
      // Todos os endereços precisam ser IPv4 públicos; basta um interno para recusar.
      if (ips.some(ip => !ipPublico(ip))) throw new EnderecoRecusadoPki();
      const limiteBytes = Math.min(LIMITES_PKI.bytesPorResposta, LIMITES_PKI.bytesPorSessao - this.bytes);
      if (limiteBytes <= 0) throw new ErroRedePki("Limite de dados da conferência atingido.");
      await ocupar(this.signal);
      let resposta: RespostaPki;
      try { resposta = await abortavel(this.transporte({ url, ip: ips[0], signal: this.signal, limiteBytes }), this.signal); }
      finally { liberar(); }
      if (resposta.status >= 300 && resposta.status < 400) {
        if (!resposta.location || salto >= LIMITES_PKI.redirecionamentos) throw new ErroRedePki("Redirecionamento da certificadora não aceito.");
        let proxima: string;
        try { proxima = new URL(resposta.location, url).href; } catch { throw new EnderecoRecusadoPki(); }
        url = urlCertificadora(proxima);
        continue;
      }
      if (resposta.status !== 200 || !resposta.corpo) throw new ErroRedePki("Certificadora indisponível.");
      if (resposta.corpo.length > limiteBytes) throw new ErroRedePki("Resposta da certificadora acima do limite.");
      this.bytes += resposta.corpo.length;
      return resposta.corpo;
    }
  }
}
