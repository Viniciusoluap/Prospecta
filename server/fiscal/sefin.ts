// EPIC-029 S-4 (22/11/2026) — cliente mTLS do Sistema Nacional NFS-e (Sefin Nacional e ADN). FUNDAÇÃO: nada aqui é
// chamado pela emissão ainda (o gatilho do banco e a rota continuam recusando EMITINDO/EMITIDA).
// Padrão de server/_core/inter.ts (https.request com cert/key PEM em memória), com regras mais duras:
// - host FIXO por ambiente (desligado / producao_restrita / producao, de fiscal_emissores.ambiente); URL montada aqui,
//   nunca recebida pronta; host diferente do esperado é recusado antes de abrir conexão;
// - `rejectUnauthorized` sempre true (proibido desligar — PESQUISA §6, R5); `ca` = raízes do Node + raízes ICP-Brasil
//   (server/certificados/icp-raizes.json, as mesmas da conferência de assinaturas do Jurídico);
// - tempo-limite (25 s, R10) e teto de tamanho da resposta;
// - sem log de XML, corpo ou dado pessoal: erros levam só o status HTTP ou o código do erro de rede.
// Endereços e caminhos: PESQUISA.md §1 (commit a586c55). HOSTS, BASES da Sefin e MÉTODOS: [OFICIAL] — produção restrita
// `/API/SefinNacional` (o caminho sem "/API" também existe: `baseAlternativa`, escolhida por opção), produção
// `/SefinNacional`. A base do ADN e os nomes dos campos JSON (`CAMPOS_JSON`) continuam [NÃO CONFIRMADO] (o Swagger só abre
// com certificado de cliente): o cliente recusa destino sem host E base confirmados. Nada disto é chamado pela emissão
// (desligada); só o "testar conexão" de um emissor em produção restrita consulta o convênio municipal (só leitura).
import { request as requestHttps, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { rootCertificates } from "node:tls";
import { gunzipSync, gzipSync } from "node:zlib";
import raizes from "../certificados/icp-raizes.json" with { type: "json" };
import type { AmbienteFiscal } from "../../drizzle/schema-fiscal.js";
import type { getDb } from "../db.js";
import { credencialDoEmissor } from "./certificado.js";

type DrizzleDb = ReturnType<typeof getDb>;

export type ServicoNacional = "sefin" | "adn";
export type Endereco = { host: string; base: string; baseAlternativa?: string; hostConfirmado: boolean; baseConfirmada: boolean; fonte: string; porta?: number };
export type MapaEnderecos = Record<Exclude<AmbienteFiscal, "desligado">, Record<ServicoNacional, Endereco>>;

/** PESQUISA §1.1: hosts [OFICIAL] (página "APIs – Prod. Restrita e Produção"); base deduzida do Swagger [NÃO CONFIRMADO]. */
export const ENDERECOS: MapaEnderecos = {
  producao_restrita: {
    sefin: { host: "sefin.producaorestrita.nfse.gov.br", base: "/API/SefinNacional", baseAlternativa: "/SefinNacional", hostConfirmado: true, baseConfirmada: true,
      fonte: "OFICIAL (PESQUISA a586c55); o caminho sem /API também existe" },
    adn: { host: "adn.producaorestrita.nfse.gov.br", base: "/contribuintes", hostConfirmado: true, baseConfirmada: false,
      fonte: "host OFICIAL; base /contribuintes consistente com MAN-ADN e nfelib — NÃO CONFIRMADO" },
  },
  producao: {
    sefin: { host: "sefin.nfse.gov.br", base: "/SefinNacional", hostConfirmado: true, baseConfirmada: true, fonte: "OFICIAL (PESQUISA a586c55), sem /API" },
    adn: { host: "adn.nfse.gov.br", base: "/contribuintes", hostConfirmado: true, baseConfirmada: false, fonte: "host OFICIAL; base NÃO CONFIRMADA" },
  },
};

export type Caminho = { servico: ServicoNacional; metodo: "GET" | "POST" | "HEAD"; modelo: string; confirmado: boolean; fonte: string };
/** PESQUISA §1.2/§1.3 [OFICIAL, MAN-API e MAN-ADN]. Sem uso pela emissão nesta etapa. */
export const CAMINHOS = {
  emitir: { servico: "sefin", metodo: "POST", modelo: "/nfse", confirmado: true, fonte: "MAN-API §1.2 (síncrono)" },
  consultarNfse: { servico: "sefin", metodo: "GET", modelo: "/nfse/{chave}", confirmado: true, fonte: "MAN-API" },
  /** Idempotência: devolve a chave da NFS-e gerada pela DPS (só prestador/tomador/intermediário). */
  consultarDps: { servico: "sefin", metodo: "GET", modelo: "/dps/{id}", confirmado: true, fonte: "MAN-API" },
  existeDps: { servico: "sefin", metodo: "HEAD", modelo: "/dps/{id}", confirmado: true, fonte: "MAN-API" },
  eventos: { servico: "sefin", metodo: "POST", modelo: "/nfse/{chave}/eventos", confirmado: true, fonte: "MAN-API (cancelamento e101101)" },
  convenioMunicipal: { servico: "sefin", metodo: "GET", modelo: "/parametros_municipais/{ibge}/convenio", confirmado: true, fonte: "MAN-API; FAQ 19.6" },
  distribuicao: { servico: "adn", metodo: "GET", modelo: "/DFe/{nsu}", confirmado: true, fonte: "MAN-ADN §1.1.1 (até 50 por chamada)" },
  // DANFSe: a API do ADN foi SUSPENSA em 03/08/2026 (NT 008) — o PDF é gerado pelo sistema. Sem caminho aqui.
} as const satisfies Record<string, Caminho>;
export type NomeCaminho = keyof typeof CAMINHOS;

/** Nomes dos campos JSON — [TERCEIROS] (nfelib e nfse-php, iguais); [NÃO CONFIRMADO no Swagger]. */
export const CAMPOS_JSON = {
  dps: "dpsXmlGZipB64", nfse: "nfseXmlGZipB64", chave: "chaveAcesso", pedidoEvento: "pedidoRegistroEventoXmlGZipB64", evento: "eventoXmlGZipB64",
  confirmado: false,
} as const;

/**
 * Consulta INOFENSIVA do "testar conexão" (só leitura, sem efeito fiscal): o convênio do município sede do emissor, que
 * também diz se ele emite pela Sefin Nacional (`aderenteEmissorNacional`). Caminho [OFICIAL]; a base ainda não.
 */
export const CAMINHO_TESTE_CONEXAO: { servico: ServicoNacional; nome: NomeCaminho } | null = { servico: "sefin", nome: "convenioMunicipal" };

export const TEMPO_LIMITE_MS = 25_000;
export const TAMANHO_MAXIMO_RESPOSTA = 5 * 1024 * 1024;

export class ErroSefin extends Error {
  constructor(message: string, readonly status: number | null = null) { super(message); this.name = "ErroSefin"; }
}

/** Raízes ICP-Brasil (públicas, do ITI) + raízes padrão do Node: a verificação do servidor nunca é desligada. */
export const CA_CONFIAVEIS: string[] = [...rootCertificates, ...(raizes as { pem: string }[]).map(r => r.pem)];

export const MENSAGEM_DESLIGADO = "A emissão desta empresa está desligada (ambiente \"desligado\"). Nada foi enviado.";
export const MENSAGEM_PRODUCAO_BLOQUEADA = "Produção bloqueada nesta etapa: só a produção restrita (testes) será liberada, na homologação com o dono.";

/** Destino fixo do ambiente. Desligado, produção (nesta etapa) e endereço não confirmado → recusa. */
export function destinoDo(ambiente: AmbienteFiscal | string, servico: ServicoNacional, enderecos: MapaEnderecos = ENDERECOS): Endereco {
  if (ambiente === "desligado") throw new ErroSefin(MENSAGEM_DESLIGADO);
  if (ambiente === "producao") throw new ErroSefin(MENSAGEM_PRODUCAO_BLOQUEADA);
  if (ambiente !== "producao_restrita") throw new ErroSefin("Ambiente fiscal desconhecido. Nada foi enviado.");
  const d = enderecos.producao_restrita[servico];
  if (!d?.hostConfirmado || !d.baseConfirmada) throw new ErroSefin("O endereço exato deste serviço (base da API) ainda não foi confirmado no Swagger oficial. Nada foi enviado.");
  return d;
}

/** Monta a URL com host fixo. Caminho com esquema, host, "..", "//", "@" ou "\" é recusado. */
export function montarUrl(destino: Endereco, caminho: string, usarBaseAlternativa = false): URL {
  if (!/^\/[A-Za-z0-9_\-./{}%=?&]*$/.test(caminho) || caminho.includes("..") || caminho.includes("//")) {
    throw new ErroSefin("Caminho recusado pelo cliente fiscal.");
  }
  const autoridade = destino.porta ? `${destino.host}:${destino.porta}` : destino.host;
  const base = usarBaseAlternativa ? destino.baseAlternativa : destino.base;
  if (base == null) throw new ErroSefin("Este serviço não tem base alternativa.");
  const url = new URL(`https://${autoridade}${base}${caminho}`);
  if (url.protocol !== "https:" || url.host !== autoridade || url.username || url.password) throw new ErroSefin("Endereço fora da lista do cliente fiscal.");
  return url;
}

/** Preenche um modelo de CAMINHOS ("/nfse/{chave}") com valores só de letras/números. */
export function caminhoDe(nome: NomeCaminho, valores: Record<string, string> = {}, caminhos: Record<string, Caminho> = CAMINHOS): string {
  const c: Caminho | undefined = caminhos[nome];
  if (!c) throw new ErroSefin("Caminho desconhecido.");
  if (!c.confirmado) throw new ErroSefin(`O caminho "${nome}" ainda não foi confirmado na documentação oficial. Nada foi enviado.`);
  return c.modelo.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = valores[k] ?? "";
    if (!/^[A-Za-z0-9]{1,60}$/.test(v)) throw new ErroSefin(`Valor inválido para ${k}.`);
    return v;
  });
}

/** XML → GZIP → Base64 (formato `dpsXmlGZipB64` citado em PESQUISA §1 [NÃO CONFIRMADO]). */
export const compactarXml = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");
export const descompactarXml = (b64: string) => gunzipSync(Buffer.from(b64, "base64")).toString("utf8");

export type CredencialMtls = { certPem: string; chavePem: string; cadeiaPem?: string[] };
export type RespostaSefin = { status: number; corpo: string };
type RequestImpl = (opcoes: RequestOptions, aoResponder: (res: IncomingMessage) => void) => ClientRequest;

/** Opções TLS do cliente (exportado para o teste-vigia conferir que a verificação nunca é desligada). */
export function opcoesTls(url: URL, credencial: CredencialMtls, metodo: string, cabecalhos: Record<string, string>, tempoLimiteMs: number, ca: string[]): RequestOptions {
  return {
    protocol: "https:", hostname: url.hostname, port: url.port ? Number(url.port) : 443, path: `${url.pathname}${url.search}`,
    method: metodo, headers: cabecalhos, servername: url.hostname,
    cert: [credencial.certPem, ...(credencial.cadeiaPem ?? [])].join("\n"), key: credencial.chavePem,
    ca, rejectUnauthorized: true, minVersion: "TLSv1.2", timeout: tempoLimiteMs, agent: false,
  };
}

/**
 * Cliente de um serviço nacional para um ambiente. `enderecos`, `ca` e `requestImpl` só existem para os testes
 * (servidor falso local); em produção valem as constantes deste arquivo.
 */
export function criarClienteSefin(o: {
  ambiente: AmbienteFiscal | string; servico: ServicoNacional; credencial: CredencialMtls;
  enderecos?: MapaEnderecos; ca?: string[]; requestImpl?: RequestImpl; tempoLimiteMs?: number;
  /** Produção restrita: usar o caminho sem "/API" (fallback configurável — PESQUISA a586c55). */
  usarBaseAlternativa?: boolean;
}) {
  const destino = destinoDo(o.ambiente, o.servico, o.enderecos);
  const tempo = o.tempoLimiteMs ?? TEMPO_LIMITE_MS;
  const enviar = o.requestImpl ?? (requestHttps as unknown as RequestImpl);
  return {
    destino,
    requisitar(metodo: "GET" | "POST" | "HEAD", caminho: string, corpoJson?: unknown): Promise<RespostaSefin> {
      const url = montarUrl(destino, caminho, o.usarBaseAlternativa ?? false);
      const corpo = corpoJson === undefined ? undefined : JSON.stringify(corpoJson);
      const cabecalhos: Record<string, string> = { Accept: "application/json", ...(corpo ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(corpo)) } : {}) };
      return new Promise<RespostaSefin>((resolve, reject) => {
        let req: ClientRequest;
        try {
          req = enviar(opcoesTls(url, o.credencial, metodo, cabecalhos, tempo, o.ca ?? CA_CONFIAVEIS), res => {
            const partes: Buffer[] = []; let total = 0;
            res.on("data", (p: Buffer) => {
              total += p.length;
              if (total > TAMANHO_MAXIMO_RESPOSTA) { res.destroy(); reject(new ErroSefin("Resposta grande demais do serviço nacional.")); return; }
              partes.push(p);
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8") }));
            res.on("error", () => reject(new ErroSefin("A resposta do serviço nacional foi interrompida.")));
          });
        } catch { reject(new ErroSefin("Não foi possível abrir a conexão segura.")); return; }
        req.on("timeout", () => req.destroy(Object.assign(new Error("tempo"), { code: "ETIMEDOUT" })));
        // Só o código do erro (ex.: DEPTH_ZERO_SELF_SIGNED_CERT, ETIMEDOUT): nada do corpo, do XML ou do certificado.
        req.on("error", (e: NodeJS.ErrnoException) => reject(new ErroSefin(e.code === "ETIMEDOUT"
          ? `O serviço nacional não respondeu em ${Math.round(tempo / 1000)} s (resultado incerto: consultar antes de reenviar).`
          : `Falha na conexão segura com o serviço nacional (${e.code ?? "erro de rede"}).`)));
        if (corpo) req.write(corpo);
        req.end();
      });
    },
  };
}

export type ResultadoTeste = { ok: boolean; mensagem: string; ambiente: string };

/**
 * "Testar conexão" do cartão. Desligado → recusa sem rede. Produção → bloqueado. Produção restrita → só se a base estiver
 * CONFIRMADA (hoje não está) e houver certificado ativo; consulta o convênio do município sede e devolve só o status HTTP.
 */
export async function testarConexaoSefin(
  db: DrizzleDb, emissor: { id: number; ambiente: string; municipioIbge?: string | null },
  deps: { teste?: typeof CAMINHO_TESTE_CONEXAO; enderecos?: MapaEnderecos; ca?: string[]; requestImpl?: RequestImpl; credencial?: () => Promise<CredencialMtls> } = {},
): Promise<ResultadoTeste> {
  const ambiente = emissor.ambiente;
  const teste = deps.teste === undefined ? CAMINHO_TESTE_CONEXAO : deps.teste;
  try {
    if (!teste) { destinoDo(ambiente, "sefin", deps.enderecos); return { ok: false, ambiente, mensagem: "Não há consulta de teste definida. Nada foi enviado." }; }
    const destino = destinoDo(ambiente, teste.servico, deps.enderecos);
    if (!emissor.municipioIbge) return { ok: false, ambiente, mensagem: "Cadastre o código IBGE do município da empresa emissora para testar. Nada foi enviado." };
    const caminho = caminhoDe(teste.nome, { ibge: emissor.municipioIbge });
    const credencial = deps.credencial ? await deps.credencial() : await credencialDoEmissor(db, emissor.id);
    const cliente = criarClienteSefin({ ambiente, servico: teste.servico, credencial, enderecos: deps.enderecos, ca: deps.ca, requestImpl: deps.requestImpl });
    const r = await cliente.requisitar("GET", caminho);
    return { ok: r.status >= 200 && r.status < 300, ambiente, mensagem: `Conexão segura com ${destino.host} aberta (HTTP ${r.status}).` };
  } catch (e) {
    if (e instanceof ErroSefin || (e instanceof Error && e.name === "ErroCertificado")) return { ok: false, ambiente, mensagem: e.message };
    return { ok: false, ambiente, mensagem: "Não foi possível testar a conexão agora." };
  }
}
