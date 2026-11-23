// EPIC-029 S-4 (22/11/2026) — cofre do certificado A1 da emissão de NFS-e. ÚNICO ponto que abre o .pfx e decifra a
// senha (teste-vigia em server/fiscal/certificado.test.ts). Regras (CLAUDE.md, decisão b do EPIC-029):
// - o .pfx e a senha são enviados pelo dono (do cartão do Jurídico, onde ele já cadastrou o A1, ou por arquivo);
// - ficam cifrados SEPARADOS (encryptSecret, AES-256-GCM); a tela vê só titular, CNPJ, AC, validade e impressão digital;
// - nada daqui devolve o arquivo, a senha ou a chave privada a uma rota; nada vai para log, erro ou histórico;
// - remover = desativar (a linha fica; o banco recusa apagar e recusa trocar o conteúdo cifrado).
// O .pfx é aberto em JS puro (P12Signer do @libpdf/core + pkijs), que lê também o PFX legado RC2/3DES que o OpenSSL 3
// do Node recusa (R4); a chave privada sai em PEM só em memória, para o mTLS e a assinatura XML.
import { createPrivateKey, X509Certificate, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { P12Signer } from "@libpdf/core";
import { and, desc, eq } from "drizzle-orm";
import { Certificate } from "pkijs";
import raizes from "../certificados/icp-raizes.json" with { type: "json" };
import { fiscalCertificadosHistorico, fiscalEmissores, fiscalEmissoresCertificado, type OrigemCertificadoFiscal } from "../../drizzle/schema-fiscal.js";
import { decryptSecret, encryptSecret } from "../_core/secret-vault.js";
import type { getDb } from "../db.js";

type DrizzleDb = ReturnType<typeof getDb>;

export const TAMANHO_MAXIMO_PFX = 1024 * 1024;
/** Aviso de vencimento: 30 dias antes (S-4, item 1). */
export const DIAS_AVISO_VENCIMENTO = 30;
/** OID ICP-Brasil do CNPJ da pessoa jurídica no subjectAltName (otherName) do e-CNPJ. */
const OID_CNPJ_ICP = "2.16.76.1.3.3";

/** Erro de cofre com frase pronta para a tela — nunca com a senha, o arquivo ou o texto da biblioteca. */
export class ErroCertificado extends Error {
  constructor(message: string) { super(message); this.name = "ErroCertificado"; }
}

/** O que a tela pode ver. Nada além disto sai do cofre por rota. */
export type InfoCertificado = {
  titular: string;
  cnpj: string | null;
  autoridade: string | null;
  validoDe: Date;
  validoAte: Date;
  impressaoDigital: string;
  cadeiaIcp: boolean;
  /** Certificado de AC (não serve para transmitir — E1200–E1209). */
  ehAc: boolean;
  /** Usos estendidos (EKU); null = o certificado não restringe. */
  usosEstendidos: string[] | null;
};

/** EKU "Autenticação de Cliente" (TLS) exigido no certificado de transmissão [OFICIAL, PESQUISA §2]. */
export const OID_AUTENTICACAO_CLIENTE = "1.3.6.1.5.5.7.3.2";

/** Uso interno (mTLS e assinatura). Nunca serializar para rota, log ou histórico. */
export type CredencialA1 = { certPem: string; chavePem: string; cadeiaPem: string[]; info: InfoCertificado };

const pem = (der: Uint8Array | Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END CERTIFICATE-----\n`;

const RAIZES_ICP: X509Certificate[] = (raizes as { pem: string }[]).flatMap(r => {
  try { return [new X509Certificate(r.pem)]; } catch { return []; }
});

function atributo(dn: string, chave: string): string | null {
  const linha = dn.split("\n").find(l => l.startsWith(`${chave}=`));
  return linha ? linha.slice(chave.length + 1).trim() || null : null;
}

/** CNPJ do titular: primeiro o otherName ICP-Brasil (2.16.76.1.3.3), depois o sufixo ":CNPJ" do CN. Aceita alfanumérico. */
export function cnpjDoCertificado(x509: X509Certificate): string | null {
  try {
    const c = Certificate.fromBER(Uint8Array.from(x509.raw).buffer);
    const san = c.extensions?.find(e => e.extnID === "2.5.29.17");
    const nomes = (san?.parsedValue as { altNames?: { type: number; value: unknown }[] } | undefined)?.altNames ?? [];
    for (const g of nomes) {
      if (g.type !== 0) continue;
      const partes = (g.value as { valueBlock?: { value?: unknown[] } }).valueBlock?.value ?? [];
      const oid = (partes[0] as { valueBlock?: { toString(): string } } | undefined)?.valueBlock?.toString();
      if (oid !== OID_CNPJ_ICP) continue;
      const interno = (partes[1] as { valueBlock?: { value?: unknown[] } } | undefined)?.valueBlock?.value?.[0] as
        { valueBlock?: { value?: unknown; valueHexView?: Uint8Array } } | undefined;
      const bruto = typeof interno?.valueBlock?.value === "string" ? interno.valueBlock.value
        : interno?.valueBlock?.valueHexView ? Buffer.from(interno.valueBlock.valueHexView).toString("latin1") : "";
      const cnpj = bruto.toUpperCase().replace(/[^0-9A-Z]/g, "");
      if (/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return cnpj;
    }
  } catch { /* sem SAN legível: cai para o CN */ }
  const cn = atributo(x509.subject, "CN") ?? "";
  return /:\s*([0-9A-Z]{12}[0-9]{2})\s*$/i.exec(cn)?.[1]?.toUpperCase() ?? null;
}

/** A cadeia chega a uma raiz ICP-Brasil (com os intermediários que vieram no .pfx)? Ao guardar, só informa; para EMITIR, `credencialDoEmissor({ paraEmitir })` recusa sem ela. */
export function cadeiaChegaNaIcp(folha: X509Certificate, intermediarios: X509Certificate[], raizesIcp = RAIZES_ICP): boolean {
  let atual = folha;
  for (let passo = 0; passo < 8; passo++) {
    const raiz = raizesIcp.find(r => atual.checkIssued(r) && atual.verify(r.publicKey));
    if (raiz) return true;
    const proximo = intermediarios.find(i => i !== atual && atual.checkIssued(i) && atual.verify(i.publicKey));
    if (!proximo) return false;
    atual = proximo;
  }
  return false;
}

export function infoDe(x509: X509Certificate, intermediarios: X509Certificate[] = [], raizesIcp = RAIZES_ICP): InfoCertificado {
  return {
    titular: (atributo(x509.subject, "CN") ?? atributo(x509.subject, "O") ?? "Titular não informado").slice(0, 200),
    cnpj: cnpjDoCertificado(x509),
    autoridade: (atributo(x509.issuer, "CN") ?? atributo(x509.issuer, "O"))?.slice(0, 200) ?? null,
    validoDe: new Date(x509.validFrom),
    validoAte: new Date(x509.validTo),
    impressaoDigital: x509.fingerprint256.replace(/:/g, "").toLowerCase(),
    cadeiaIcp: cadeiaChegaNaIcp(x509, intermediarios, raizesIcp),
    ehAc: x509.ca,
    usosEstendidos: Array.isArray(x509.keyUsage) ? [...x509.keyUsage] : null,
  };
}

/**
 * Abre o .pfx (moderno ou legado) só em memória. Senha errada, arquivo inválido ou sem chave → ErroCertificado com
 * frase fixa (o texto da biblioteca nunca sobe: poderia conter trecho do arquivo).
 */
export async function abrirPfx(pfx: Uint8Array, senha: string, raizesIcp = RAIZES_ICP): Promise<CredencialA1> {
  if (!pfx.length || pfx.length > TAMANHO_MAXIMO_PFX) throw new ErroCertificado("Envie um certificado A1 .pfx ou .p12 de até 1 MiB.");
  if (!senha) throw new ErroCertificado("Informe a senha do certificado.");
  let signer: P12Signer;
  try { signer = await P12Signer.create(Uint8Array.from(pfx), senha, { buildChain: false }); }
  catch { throw new ErroCertificado("Não foi possível abrir o certificado. Confira o arquivo A1 e a senha."); }
  let chave: KeyObject;
  try {
    // O P12Signer importa a chave como extraível; exportamos em PKCS#8 só em memória (o campo é privado no tipo).
    const cripto = (signer as unknown as { privateKey?: CryptoKey }).privateKey;
    if (!cripto) throw new Error("sem chave");
    const der = Buffer.from(await globalThis.crypto.subtle.exportKey("pkcs8", cripto));
    chave = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    der.fill(0);
  } catch { throw new ErroCertificado("O certificado não traz a chave privada utilizável (é preciso o A1 completo, .pfx)."); }
  const todos = [signer.certificate, ...signer.certificateChain].map(d => new X509Certificate(Buffer.from(d)));
  const folha = todos.find(c => { try { return c.checkPrivateKey(chave); } catch { return false; } });
  if (!folha) throw new ErroCertificado("O certificado do arquivo não corresponde à chave privada.");
  const intermediarios = todos.filter(c => c !== folha);
  return {
    certPem: pem(folha.raw),
    chavePem: chave.export({ format: "pem", type: "pkcs8" }).toString(),
    cadeiaPem: intermediarios.map(c => pem(c.raw)),
    info: infoDe(folha, intermediarios, raizesIcp),
  };
}

/** Raiz do CNPJ (8 primeiros): a matriz e as filiais compartilham o e-CNPJ da raiz. */
const raizCnpj = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);

/**
 * Recusas do AC1: fora da validade e CNPJ do titular diferente do emissor (raiz); e, pelos requisitos oficiais do
 * certificado de transmissão (PESQUISA §2): certificado de AC, ou EKU que exclui "Autenticação de Cliente".
 */
export function conferirParaEmissor(info: InfoCertificado, cnpjEmissor: string, agora = new Date()): void {
  if (info.ehAc) throw new ErroCertificado("Este é um certificado de autoridade certificadora, não o A1 da empresa.");
  if (info.usosEstendidos && !info.usosEstendidos.includes(OID_AUTENTICACAO_CLIENTE)) {
    throw new ErroCertificado("Este certificado não permite \"Autenticação de Cliente\", exigida pelo Sistema Nacional NFS-e para a transmissão.");
  }
  if (agora < info.validoDe) throw new ErroCertificado("Este certificado ainda não está dentro da validade.");
  if (agora >= info.validoAte) throw new ErroCertificado("Este certificado está vencido. Envie o certificado renovado.");
  if (!info.cnpj) throw new ErroCertificado("O certificado não identifica um CNPJ (é preciso um e-CNPJ A1 da empresa emissora).");
  if (raizCnpj(info.cnpj) !== raizCnpj(cnpjEmissor)) {
    throw new ErroCertificado(`O CNPJ do certificado (${info.cnpj}) não é o da empresa emissora (${cnpjEmissor}).`);
  }
}

export function diasParaVencer(validoAte: Date, agora = new Date()): number {
  return Math.floor((validoAte.getTime() - agora.getTime()) / 86_400_000);
}

/** Resumo para a tela (sem nenhum segredo). */
export type ResumoCertificado = {
  emissorId: number; certificadoId: number; titular: string; cnpj: string; autoridade: string | null;
  validoDe: string; validoAte: string; impressaoDigital: string; cadeiaIcp: boolean; origem: OrigemCertificadoFiscal;
  enviadoEm: string; diasParaVencer: number; aviso: string | null;
};

function resumo(l: typeof fiscalEmissoresCertificado.$inferSelect, agora: Date): ResumoCertificado {
  const dias = diasParaVencer(l.validoAte, agora);
  return {
    emissorId: l.emissorId, certificadoId: l.id, titular: l.titular, cnpj: l.cnpj, autoridade: l.autoridade,
    validoDe: l.validoDe.toISOString(), validoAte: l.validoAte.toISOString(), impressaoDigital: l.impressaoDigital,
    cadeiaIcp: l.cadeiaIcp, origem: l.origem, enviadoEm: l.enviadoEm.toISOString(), diasParaVencer: dias,
    aviso: dias < 0 ? "Certificado vencido: envie o renovado antes de emitir."
      : dias <= DIAS_AVISO_VENCIMENTO ? `O certificado vence em ${dias} dia(s): providencie a renovação.` : null,
  };
}

/** Auditoria sem segredo: o detalhe é sempre uma frase montada aqui (nunca texto vindo do arquivo ou da senha). */
export async function auditarCertificado(db: DrizzleDb, a: { emissorId: number | null; certificadoId?: number | null; acao: typeof fiscalCertificadosHistorico.$inferInsert["acao"]; detalhe?: string | null; usuarioId: number | null }) {
  try {
    await db.insert(fiscalCertificadosHistorico).values({
      emissorId: a.emissorId, certificadoId: a.certificadoId ?? null, acao: a.acao, detalhe: a.detalhe?.slice(0, 300) ?? null, usuarioId: a.usuarioId,
    });
  } catch { /* a auditoria não derruba a operação */ }
}

export const FRASE_EMISSOR_NAO_ENCONTRADO = "Empresa emissora não encontrada.";
export const FRASE_EMISSOR_INATIVO = "Esta empresa emissora está inativa: reative-a antes de guardar o certificado.";
export const FRASE_VARIOS_EMISSORES = "Há mais de uma empresa emissora com a raiz do CNPJ deste certificado (matriz e filial). Escolha a empresa emissora no cartão \"Certificado A1 — emissão de NFS-e\" em Configurações › Integrações e envie de novo.";
export const FRASE_ENVIO_SIMULTANEO = "Outro envio de certificado para esta empresa terminou ao mesmo tempo. Atualize a tela e confira qual certificado ficou ativo.";

/**
 * Emissor pelo id ou, sem id, pelo CNPJ do certificado (o do Jurídico chega sem saber de qual emissor é).
 * Revisão da S-4: id explícito de emissor inativo é recusado; matriz e filial com a mesma raiz → pede para escolher.
 */
async function acharEmissor(db: DrizzleDb, emissorId: number | null, cnpjCert: string | null): Promise<{ id: number; cnpj: string }> {
  const emissores = await db.select({ id: fiscalEmissores.id, cnpj: fiscalEmissores.cnpj, ativo: fiscalEmissores.ativo }).from(fiscalEmissores);
  if (emissorId != null) {
    const e = emissores.find(x => x.id === emissorId);
    if (!e) throw new ErroCertificado(FRASE_EMISSOR_NAO_ENCONTRADO);
    if (!e.ativo) throw new ErroCertificado(FRASE_EMISSOR_INATIVO);
    return e;
  }
  const nenhum = "Nenhuma empresa emissora com o CNPJ deste certificado. Cadastre o emissor em BPO › Contabilidade › Notas fiscais (a partir do perfil tributário) e tente de novo.";
  if (!cnpjCert) throw new ErroCertificado(nenhum);
  const exato = emissores.filter(e => e.ativo && e.cnpj === cnpjCert);
  if (exato.length === 1) return exato[0]!;
  const mesmaRaiz = emissores.filter(e => e.ativo && raizCnpj(e.cnpj) === raizCnpj(cnpjCert));
  if (mesmaRaiz.length === 1) return mesmaRaiz[0]!;
  if (mesmaRaiz.length > 1) throw new ErroCertificado(FRASE_VARIOS_EMISSORES);
  throw new ErroCertificado(nenhum);
}

/** Violação de índice único do Postgres (o driver pode embrulhar o erro em `cause`). */
const ehUnicidade = (e: unknown): boolean => {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) if ((x as { code?: unknown }).code === "23505") return true;
  return false;
};

/**
 * Guarda o A1 do emissor: abre, confere validade e CNPJ, cifra .pfx e senha em campos separados, desativa o anterior e
 * registra no histórico. Devolve só o resumo.
 */
export async function guardarCertificado(db: DrizzleDb, entrada: {
  pfx: Uint8Array; senha: string; emissorId?: number | null; origem: OrigemCertificadoFiscal; usuarioId: number; agora?: Date; raizesIcp?: X509Certificate[];
}): Promise<ResumoCertificado> {
  const agora = entrada.agora ?? new Date();
  let aberto: CredencialA1;
  try { aberto = await abrirPfx(entrada.pfx, entrada.senha, entrada.raizesIcp); }
  catch (e) {
    await auditarCertificado(db, { emissorId: entrada.emissorId ?? null, acao: "recusado", detalhe: "arquivo ou senha não conferem", usuarioId: entrada.usuarioId });
    throw e;
  }
  const emissor = await acharEmissor(db, entrada.emissorId ?? null, aberto.info.cnpj);
  try { conferirParaEmissor(aberto.info, emissor.cnpj, agora); }
  catch (e) {
    await auditarCertificado(db, { emissorId: emissor.id, acao: "recusado", detalhe: e instanceof ErroCertificado ? e.message : "recusado", usuarioId: entrada.usuarioId });
    throw e;
  }
  const i = aberto.info;
  const pfxCifrado = encryptSecret(Buffer.from(entrada.pfx).toString("base64"));
  const senhaCifrada = encryptSecret(entrada.senha);
  let salvo: typeof fiscalEmissoresCertificado.$inferSelect;
  try { salvo = await db.transaction(async tx => {
    await tx.update(fiscalEmissoresCertificado).set({ ativo: false, desativadoPor: entrada.usuarioId, desativadoEm: agora })
      .where(and(eq(fiscalEmissoresCertificado.emissorId, emissor.id), eq(fiscalEmissoresCertificado.ativo, true)));
    const [linha] = await tx.insert(fiscalEmissoresCertificado).values({
      emissorId: emissor.id, pfxCifrado, senhaCifrada, titular: i.titular, cnpj: i.cnpj!.slice(0, 14), autoridade: i.autoridade,
      validoDe: i.validoDe, validoAte: i.validoAte, impressaoDigital: i.impressaoDigital, cadeiaIcp: i.cadeiaIcp,
      origem: entrada.origem, ativo: true, enviadoPor: entrada.usuarioId, enviadoEm: agora,
    }).returning();
    return linha!;
  }); } catch (e) {
    // Revisão da S-4: dois envios ao mesmo tempo esbarram no índice único do certificado ativo → frase clara, não erro 500.
    if (ehUnicidade(e)) throw new ErroCertificado(FRASE_ENVIO_SIMULTANEO);
    throw e;
  }
  await auditarCertificado(db, {
    emissorId: emissor.id, certificadoId: salvo.id, acao: "enviado", usuarioId: entrada.usuarioId,
    detalhe: `origem=${entrada.origem}; impressão digital ${i.impressaoDigital.slice(0, 16)}…; válido até ${i.validoAte.toISOString().slice(0, 10)}`,
  });
  return resumo(salvo, agora);
}

/** Certificados ATIVOS de cada emissor, só com o que a tela pode ver. */
export async function resumosAtivos(db: DrizzleDb, agora = new Date()): Promise<ResumoCertificado[]> {
  const linhas = await db.select().from(fiscalEmissoresCertificado).where(eq(fiscalEmissoresCertificado.ativo, true)).orderBy(fiscalEmissoresCertificado.emissorId);
  return linhas.map(l => resumo(l, agora));
}

export async function historicoCertificados(db: DrizzleDb, limite = 50) {
  return db.select().from(fiscalCertificadosHistorico).orderBy(desc(fiscalCertificadosHistorico.id)).limit(limite);
}

/** Remover = desativar. Nada é apagado; o banco também recusa apagar. */
export async function desativarCertificado(db: DrizzleDb, emissorId: number, usuarioId: number): Promise<{ desativado: boolean }> {
  const linhas = await db.update(fiscalEmissoresCertificado).set({ ativo: false, desativadoPor: usuarioId, desativadoEm: new Date() })
    .where(and(eq(fiscalEmissoresCertificado.emissorId, emissorId), eq(fiscalEmissoresCertificado.ativo, true))).returning({ id: fiscalEmissoresCertificado.id });
  for (const l of linhas) await auditarCertificado(db, { emissorId, certificadoId: l.id, acao: "desativado", usuarioId });
  return { desativado: linhas.length > 0 };
}

/**
 * Uso INTERNO do cliente mTLS e da assinatura (nenhuma rota devolve isto). Decifra o .pfx e a senha do certificado
 * ativo do emissor e abre em memória. Sem certificado ativo, vencido ou ilegível (ex.: JWT_SECRET trocado) → erro claro.
 */
export const FRASE_SEM_CADEIA_ICP = "A cadeia do certificado guardado não fecha numa raiz ICP-Brasil, nem completando pelos intermediários conhecidos e pelo endereço da certificadora (AIA). Nada foi enviado. Tente de novo mais tarde ou envie o .pfx com a cadeia completa.";

/**
 * Intermediários ICP-Brasil EMBARCADOS (outra frente do EPIC-029 os coloca em server/certificados/icp-intermediarios.json, no
 * mesmo formato das raízes: [{ pem }]). Enquanto o arquivo não existe, a lista é vazia e a cadeia é completada pelo AIA.
 */
function intermediariosEmbarcados(): X509Certificate[] {
  try {
    const arquivo = new URL("../certificados/icp-intermediarios.json", import.meta.url);
    if (!existsSync(arquivo)) return [];
    const lista = JSON.parse(readFileSync(arquivo, "utf8")) as ({ pem?: string } | string)[];
    return lista.flatMap(i => { try { return [new X509Certificate(typeof i === "string" ? i : i.pem ?? "")]; } catch { return []; } });
  } catch { return []; }
}

export type OpcoesCadeia = {
  /** Só para teste: raízes no lugar das ICP-Brasil oficiais. */
  raizesIcp?: X509Certificate[];
  /** Só para teste: intermediários no lugar dos embarcados. */
  intermediarios?: X509Certificate[];
  /** Só para teste: baixador do AIA (padrão: o do Jurídico, com os limites de lá). */
  sessaoAia?: import("../juridico-pki.js").Baixador | null;
};

/**
 * Pedido do coordenador (22/11, sobre a revisão da S-4): certificado que veio SEM os intermediários (ex.: o A1 da Prospecta,
 * AC SAFEWEB RFB v5) não é recusado — a cadeia é COMPLETADA no servidor com a mesma rotina do Jurídico (server/juridico-pki.ts
 * `montarCadeia`: intermediários conhecidos + AIA da certificadora) e só então conferida até uma raiz ICP-Brasil. Fechou →
 * a credencial passa a levar os intermediários (o mTLS manda cert + intermediários). Não fechou → recusa para emitir.
 */
export async function completarCadeia(c: CredencialA1, o: OpcoesCadeia = {}): Promise<CredencialA1> {
  if (c.info.cadeiaIcp) return c;
  const folha = new X509Certificate(c.certPem);
  const raizesX = o.raizesIcp ?? RAIZES_ICP;
  const conhecidos = [...c.cadeiaPem.map(p => new X509Certificate(p)), ...(o.intermediarios ?? intermediariosEmbarcados())];
  let achados: X509Certificate[] = [];
  if (o.sessaoAia !== null) {
    try {
      const pki = await import("../juridico-pki.js");
      const paraPki = (x: X509Certificate) => Certificate.fromBER(Uint8Array.from(x.raw).buffer);
      const r = await pki.montarCadeia(paraPki(folha), conhecidos.map(paraPki), raizesX.map(paraPki), o.sessaoAia ?? undefined);
      achados = r.intermediarios.map(i => new X509Certificate(pki.derCertificado(i)));
    } catch { /* AIA fora do ar etc.: confere só com o que já há */ }
  }
  const pool = new Map<string, X509Certificate>();
  for (const x of [...conhecidos, ...achados]) if (x.fingerprint256 !== folha.fingerprint256 && !raizesX.some(r => r.fingerprint256 === x.fingerprint256)) pool.set(x.fingerprint256, x);
  // Só os intermediários do CAMINHO até a raiz (nada de certificado solto do pool no mTLS).
  const caminho: X509Certificate[] = [];
  let atual = folha;
  for (let passo = 0; passo < 8; passo++) {
    if (raizesX.some(r => atual.checkIssued(r) && atual.verify(r.publicKey))) {
      return { ...c, cadeiaPem: caminho.map(x => pem(x.raw)), info: { ...c.info, cadeiaIcp: true } };
    }
    const prox = Array.from(pool.values()).find(i => i !== atual && atual.checkIssued(i) && atual.verify(i.publicKey));
    if (!prox) break;
    caminho.push(prox); atual = prox;
  }
  throw new ErroCertificado(FRASE_SEM_CADEIA_ICP);
}

export async function credencialDoEmissor(db: DrizzleDb, emissorId: number, agora = new Date(), o: { paraEmitir?: boolean } & OpcoesCadeia = {}): Promise<CredencialA1> {
  const [linha] = await db.select().from(fiscalEmissoresCertificado)
    .where(and(eq(fiscalEmissoresCertificado.emissorId, emissorId), eq(fiscalEmissoresCertificado.ativo, true))).limit(1);
  if (!linha) throw new ErroCertificado("Esta empresa emissora não tem certificado A1 ativo.");
  let pfx: Buffer; let senha: string;
  try { pfx = Buffer.from(decryptSecret(linha.pfxCifrado), "base64"); senha = decryptSecret(linha.senhaCifrada); }
  catch { throw new ErroCertificado("Não foi possível ler o certificado guardado (a chave do servidor mudou?). Envie o certificado de novo."); }
  try {
    const credencial = await abrirPfx(pfx, senha, o.raizesIcp);
    if (agora >= credencial.info.validoAte) throw new ErroCertificado("O certificado guardado está vencido. Envie o renovado.");
    // Revisão da S-4: também o início da validade (certificado ainda não válido) e, para EMITIR, a cadeia ICP-Brasil.
    if (agora < credencial.info.validoDe) throw new ErroCertificado("O certificado guardado ainda não está dentro da validade.");
    // Para emitir: a cadeia tem de fechar numa raiz ICP-Brasil — completada no servidor quando o .pfx veio sem intermediários.
    if (o.paraEmitir) return await completarCadeia(credencial, o);
    return credencial;
  } finally { pfx.fill(0); }
}
