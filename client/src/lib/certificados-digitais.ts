import { P12Signer, PDF, rgb } from "@libpdf/core";
import { Certificate } from "pkijs";

export type CertificadoInfo = {
  id: string; titular: string; documento: string; emissor: string;
  inicio: string; vencimento: string; serial: string; fingerprint: string;
};
export type CertificadoSalvo = CertificadoInfo & {
  owner: number; nomeArquivo: string; padrao: boolean;
  salt: Uint8Array; iv: Uint8Array; protegido: ArrayBuffer;
  senhaSalva?: { iv: Uint8Array; data: ArrayBuffer };
};
const MAX_CERT = 1024 * 1024;
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");

export function conferirValidade(info: Pick<CertificadoInfo, "inicio" | "vencimento">, agora = new Date()) {
  if (agora < new Date(info.inicio)) throw new Error("Este certificado ainda não está válido.");
  if (agora >= new Date(info.vencimento)) throw new Error("Este certificado está vencido. Importe o certificado renovado.");
}

export async function abrirCertificado(bytes: Uint8Array, senha: string) {
  if (!bytes.length || bytes.length > MAX_CERT) throw new Error("Envie um certificado A1 .pfx ou .p12 de até 1 MiB.");
  let signer: P12Signer;
  try { signer = await P12Signer.create(bytes, senha, { buildChain: false }); }
  catch { throw new Error("Não foi possível abrir o certificado. Confira o arquivo A1 e a senha."); }
  const cert = Certificate.fromBER(Uint8Array.from(signer.certificate).buffer);
  const atributo = (oid: string, issuer = false) => (issuer ? cert.issuer : cert.subject).typesAndValues
    .filter(x => x.type === oid).map(x => String(x.value.valueBlock.value)).join(", ");
  const titular = atributo("2.5.4.3") || atributo("2.5.4.10") || "Titular não informado";
  // e-CNPJ / e-CPF normalmente identificam o titular no sufixo do CN.
  const documento = /(?:^|:)\s*(\d{14}|\d{11})\s*$/.exec(titular)?.[1] || "";
  const fingerprint = hex(await crypto.subtle.digest("SHA-256", Uint8Array.from(signer.certificate)));
  const info: CertificadoInfo = {
    id: fingerprint, fingerprint, titular, documento,
    emissor: atributo("2.5.4.3", true) || atributo("2.5.4.10", true),
    inicio: cert.notBefore.value.toISOString(), vencimento: cert.notAfter.value.toISOString(),
    serial: hex(cert.serialNumber.valueBlock.valueHexView.slice().buffer),
  };
  return { signer, info };
}

async function chave(senha: string, salt: Uint8Array) {
  if (!senha) throw new Error("Informe a senha do certificado.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 210_000, hash: "SHA-256" }, key,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function banco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("prospecta-certificados-a1", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("certificados")) request.result.createObjectStore("certificados", { keyPath: "key" });
      if (!request.result.objectStoreNames.contains("chaves")) request.result.createObjectStore("chaves");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Não foi possível acessar os certificados neste navegador."));
  });
}
async function operar<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await banco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("certificados", mode); const request = fn(tx.objectStore("certificados"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Não foi possível guardar o certificado neste navegador.")); };
  });
}
export async function listarCertificados(owner: number): Promise<CertificadoSalvo[]> {
  const all = await operar<CertificadoSalvo[]>("readonly", s => s.getAll());
  return all.filter(x => x.owner === owner).sort((a, b) => Number(b.padrao) - Number(a.padrao) || a.titular.localeCompare(b.titular));
}
export async function importarCertificado(owner: number, file: File, senha: string) {
  if (!/\.(pfx|p12)$/i.test(file.name) || file.size > MAX_CERT) throw new Error("Selecione um certificado A1 .pfx ou .p12 de até 1 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const { info } = await abrirCertificado(bytes, senha); conferirValidade(info);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const protegido = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(senha, salt), bytes);
    const atuais = await listarCertificados(owner);
    const salvo: CertificadoSalvo = { ...info, owner, nomeArquivo: file.name,
      padrao: atuais.find(x => x.id === info.id)?.padrao ?? atuais.length === 0, salt, iv, protegido };
    await operar("readwrite", s => s.put({ ...salvo, key: `${owner}:${info.id}` }));
    await guardarSenha(salvo, senha);
    return salvo;
  } finally { bytes.fill(0); }
}
export async function removerCertificado(owner: number, id: string) {
  await operar("readwrite", s => s.delete(`${owner}:${id}`));
}
export async function definirCertificadoPadrao(owner: number, id: string) {
  const db = await banco();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("certificados", "readwrite"), store = tx.objectStore("certificados");
    const request = store.getAll();
    request.onsuccess = () => {
      const atuais = (request.result as (CertificadoSalvo & { key: string })[]).filter(x => x.owner === owner);
      if (!atuais.some(x => x.id === id)) { tx.abort(); return; }
      for (const item of atuais) store.put({ ...item, padrao: item.id === id });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Não foi possível definir o certificado padrão.")); };
  });
}

export type PosicaoAssinatura = { pagina: number; x: number; y: number; largura: number; altura: number };

/** Chave não exportável, persistida por conta/aparelho; não há senha em texto puro no armazenamento. */
async function chaveDoAparelho(owner: number): Promise<CryptoKey> {
  const db = await banco();
  try {
    const candidata = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("chaves", "readwrite"), store = tx.objectStore("chaves"), request = store.get(owner);
      let key: CryptoKey;
      request.onsuccess = () => { key = request.result ?? candidata; if (!request.result) store.put(key, owner); };
      tx.oncomplete = () => resolve(key); tx.onabort = tx.onerror = () => reject(new Error("Não foi possível proteger a senha neste aparelho."));
    });
  } finally { db.close(); }
}
export async function guardarSenha(cert: CertificadoSalvo, senha: string) {
  const { info } = await abrirCertificado(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(cert.iv) }, await chave(senha, cert.salt), cert.protegido)), senha).catch(() => { throw new Error("Senha do certificado incorreta."); });
  if (info.id !== cert.id) throw new Error("Certificado diferente do selecionado.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData:new TextEncoder().encode(`${cert.owner}:${cert.id}`) }, await chaveDoAparelho(cert.owner), new TextEncoder().encode(senha));
  const saved = { ...cert, senhaSalva: { iv, data } };
  await operar("readwrite", s => s.put({ ...saved, key:`${cert.owner}:${cert.id}` }));
  return saved;
}
export async function recuperarSenha(cert: CertificadoSalvo): Promise<string | null> {
  if (!cert.senhaSalva) return null;
  try { const data = await crypto.subtle.decrypt({ name:"AES-GCM", iv:Uint8Array.from(cert.senhaSalva.iv), additionalData:new TextEncoder().encode(`${cert.owner}:${cert.id}`) }, await chaveDoAparelho(cert.owner), cert.senhaSalva.data); return new TextDecoder().decode(data); }
  catch { return null; }
}
export async function esquecerSenha(cert: CertificadoSalvo) {
  const { senhaSalva, ...resto } = cert;
  await operar("readwrite", s => s.put({ ...resto, key:`${cert.owner}:${cert.id}` }));
}

export async function assinarPdf(bytes: Uint8Array, salvo: CertificadoSalvo, senha: string, posicao?: PosicaoAssinatura) {
  let aberto: ArrayBuffer;
  try { aberto = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(salvo.iv) }, await chave(senha, salvo.salt), salvo.protegido); }
  catch { throw new Error("Senha do certificado incorreta."); }
  const pfx = new Uint8Array(aberto);
  try {
    const { signer, info } = await abrirCertificado(pfx, senha);
    if (info.id !== salvo.id) throw new Error("O certificado selecionado não corresponde ao arquivo guardado.");
    conferirValidade(info);
    const pdf = await PDF.load(bytes);
    if (posicao) {
      const { pagina, x, y, largura, altura } = posicao;
      if (!Number.isInteger(pagina) || pagina < 0 || pagina >= pdf.getPages().length || ![x,y,largura,altura].every(Number.isFinite) || largura < 50 || altura < 25) throw new Error("Escolha uma posição válida para a assinatura.");
      const page = pdf.getPage(pagina)!;
      const limite=page.getCropBox();
      if (x < limite.x || y < limite.y || x + largura > limite.x+limite.width + 1 || y + altura > limite.y+limite.height + 1) throw new Error("A assinatura deve ficar dentro da página.");
      const nome = info.titular.replace(/[^\u0020-\u00ff]/g, "") || "Consulte o certificado";
      const linhas = ["ASSINADO DIGITALMENTE", ...nome.match(/.{1,48}(?:\s|$)|.{1,48}/g)!.map(x => x.trim()), `CPF/CNPJ: ${info.documento || "Ver certificado"}`, new Date().toLocaleString("pt-BR", { timeZone:"America/Fortaleza" })];
      const size = Math.min(9, (altura - 8) / (linhas.length * 1.2), (largura - 8) / 30);
      page.drawRectangle({ x,y,width:largura,height:altura,borderColor:rgb(0.15,0.25,0.4),borderWidth:0.6 });
      linhas.forEach((linha, i) => page.drawText(linha, { x:x+4,y:y+altura-6-size-i*size*1.2,size,color:rgb(0.1,0.18,0.3),maxWidth:largura-8 }));
    }
    const result = await pdf.sign({ signer, level: "B-B", digestAlgorithm: "SHA-256", reason: "Assinatura digital de documento no Jurídico Prospecta" });
    if (result.warnings.length) throw new Error("O PDF exige tratamento adicional para preservar suas assinaturas. Use o arquivo original ou um assinador compatível.");
    return { bytes: result.bytes, info };
  } finally { pfx.fill(0); }
}
