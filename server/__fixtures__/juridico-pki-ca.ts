// Só para testes: uma "ICP sintética" gerada com OpenSSL (raiz → intermediária → folhas, LCRs), sem nenhum valor
// jurídico e sem rede. Os endereços AIA/LCR usam o domínio reservado .example e são servidos por um transporte simulado.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Certificate } from "pkijs";

export const URLS = {
  raizCrl: "http://lcr.teste.example/raiz.crl",
  interCert: "http://ac.teste.example/intermediaria.der",
  interCrl: "http://lcr.teste.example/intermediaria.crl",
  outraCrl: "http://lcr.teste.example/outra.crl",
};

export type Pki = {
  dir: string;
  raiz: Certificate; outraRaiz: Certificate; intermediaria: Certificate;
  der: Record<string, Buffer>;
  crl: { raiz: Buffer; intermediaria: Buffer; outra: Buffer };
  pfx: (nome: string, comCadeia?: boolean) => Uint8Array;
  cert: (nome: string) => Certificate;
  limpar: () => void;
};

const run = (args: string[], cwd: string) => execFileSync("openssl", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
const pemParaDer = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64");
const certDe = (der: Buffer) => Certificate.fromBER(Uint8Array.from(der).buffer);

function configCa(dir: string, nome: string) {
  mkdirSync(join(dir, `novos-${nome}`), { recursive: true });
  writeFileSync(join(dir, `index-${nome}.txt`), "");
  writeFileSync(join(dir, `serial-${nome}`), nome === "raiz" ? "1000\n" : nome === "outra" ? "5000\n" : "2000\n");
  writeFileSync(join(dir, `crlnumber-${nome}`), "01\n");
  writeFileSync(join(dir, `${nome}.cnf`), `
[ ca ]
default_ca = padrao
[ padrao ]
dir = ${dir}
database = ${dir}/index-${nome}.txt
new_certs_dir = ${dir}/novos-${nome}
serial = ${dir}/serial-${nome}
crlnumber = ${dir}/crlnumber-${nome}
certificate = ${dir}/${nome}.pem
private_key = ${dir}/${nome}-chave.pem
default_md = sha256
default_crl_days = 7
policy = qualquer
unique_subject = no
copy_extensions = none
[ qualquer ]
commonName = supplied
organizationName = optional
countryName = optional
[ v3_inter ]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:${URLS.raizCrl}
[ v3_folha ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
authorityInfoAccess = caIssuers;URI:${URLS.interCert}
crlDistributionPoints = URI:${URLS.interCrl}
[ v3_folha_sem_lcr ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, nonRepudiation
authorityInfoAccess = caIssuers;URI:${URLS.interCert}
[ v3_folha_critica ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, nonRepudiation
authorityInfoAccess = caIssuers;URI:${URLS.interCert}
crlDistributionPoints = URI:${URLS.interCrl}
1.2.3.4.5.6.7 = critical, ASN1:UTF8String:extensao-desconhecida
[ v3_folha_cifra ]
basicConstraints = critical, CA:false
keyUsage = critical, keyEncipherment
authorityInfoAccess = caIssuers;URI:${URLS.interCert}
crlDistributionPoints = URI:${URLS.interCrl}
[ v3_outra_folha ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, nonRepudiation
crlDistributionPoints = URI:${URLS.outraCrl}
`);
}

/** Gera tudo em um diretório temporário. `agora` só serve para escolher as datas de validade das folhas. */
export function criarPki(): Pki {
  const dir = mkdtempSync(join(tmpdir(), "prospecta-icp-sintetica-"));
  for (const ca of ["raiz", "inter", "outra"]) configCa(dir, ca);
  const raizExt = ["-addext", "basicConstraints=critical,CA:true", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-addext", "subjectKeyIdentifier=hash"];
  run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "raiz-chave.pem", "-out", "raiz.pem", "-days", "60", "-subj", "/C=BR/O=TESTE SEM VALIDADE/CN=RAIZ SINTETICA DE TESTE", ...raizExt], dir);
  run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "outra-chave.pem", "-out", "outra.pem", "-days", "60", "-subj", "/C=BR/O=TESTE SEM VALIDADE/CN=OUTRA RAIZ DE TESTE", ...raizExt], dir);
  run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "inter-chave.pem", "-out", "inter.csr", "-subj", "/C=BR/O=TESTE SEM VALIDADE/CN=AC INTERMEDIARIA DE TESTE"], dir);
  run(["ca", "-batch", "-config", "raiz.cnf", "-extensions", "v3_inter", "-days", "45", "-in", "inter.csr", "-out", "inter.pem", "-notext"], dir);
  const folha = (nome: string, cn: string, ext = "v3_folha", ca = "inter", datas: string[] = ["-days", "30"]) => {
    run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", `${nome}-chave.pem`, "-out", `${nome}.csr`, "-subj", `/C=BR/O=TESTE SEM VALIDADE/CN=${cn}`], dir);
    run(["ca", "-batch", "-config", `${ca}.cnf`, "-extensions", ext, ...datas, "-in", `${nome}.csr`, "-out", `${nome}.pem`, "-notext"], dir);
  };
  folha("empresa", "EMPRESA TESTE:12345678000190");
  folha("cliente", "CLIENTE TESTE:12345678901");
  folha("testemunha", "TESTEMUNHA TESTE:98765432100");
  folha("revogado", "REVOGADO TESTE:11122233344");
  folha("vencido", "VENCIDO TESTE:55566677788", "v3_folha", "inter", ["-startdate", "20200101000000Z", "-enddate", "20210101000000Z"]);
  folha("semlcr", "SEM LCR TESTE:22233344455", "v3_folha_sem_lcr");
  folha("critica", "CRITICA TESTE:33344455566", "v3_folha_critica");
  folha("cifra", "SO CIFRA TESTE:44455566677", "v3_folha_cifra");
  folha("estranho", "OUTRO EMISSOR TESTE:66677788899", "v3_outra_folha", "outra");
  run(["ca", "-batch", "-config", "inter.cnf", "-revoke", "revogado.pem", "-crl_reason", "keyCompromise"], dir);
  const crl = (ca: string) => { run(["ca", "-batch", "-config", `${ca}.cnf`, "-gencrl", "-out", `${ca}.crl.pem`], dir); return pemParaDer(readFileSync(join(dir, `${ca}.crl.pem`), "latin1")); };
  const crls = { raiz: crl("raiz"), intermediaria: crl("inter"), outra: crl("outra") };
  const der: Record<string, Buffer> = {};
  for (const nome of ["raiz", "outra", "inter", "empresa", "cliente", "testemunha", "revogado", "vencido", "semlcr", "critica", "cifra", "estranho"]) der[nome] = pemParaDer(readFileSync(join(dir, `${nome}.pem`), "latin1"));
  return {
    dir, der, crl: crls,
    raiz: certDe(der.raiz), outraRaiz: certDe(der.outra), intermediaria: certDe(der.inter),
    cert: nome => certDe(der[nome]),
    pfx: (nome, comCadeia = false) => {
      const saida = `${nome}${comCadeia ? "-cadeia" : ""}.pfx`;
      run(["pkcs12", "-export", "-inkey", `${nome}-chave.pem`, "-in", `${nome}.pem`, ...(comCadeia ? ["-certfile", "inter.pem"] : []), "-out", saida, "-passout", "pass:teste-somente"], dir);
      return new Uint8Array(readFileSync(join(dir, saida)));
    },
    limpar: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Servidor simulado: URL → corpo. Conta as chamadas. Falha para URLs listadas em `fora`. */
export function rede(pki: Pki, opcoes: { fora?: string[]; trocar?: Record<string, Buffer> } = {}) {
  const chamadas: string[] = [];
  const mapa: Record<string, Buffer> = {
    [URLS.interCert]: pki.der.inter, [URLS.raizCrl]: pki.crl.raiz, [URLS.interCrl]: pki.crl.intermediaria, [URLS.outraCrl]: pki.crl.outra,
    ...opcoes.trocar,
  };
  return {
    chamadas,
    resolver: async () => ["93.184.216.34"],
    transporte: async ({ url }: { url: URL }) => {
      chamadas.push(url.href);
      if (opcoes.fora?.includes(url.href)) throw new Error("ECONNREFUSED simulado");
      const corpo = mapa[url.href];
      return corpo ? { status: 200, corpo } : { status: 404 };
    },
  };
}
