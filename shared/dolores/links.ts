// EPIC-025 (Dolores, etapa 2) — QA r7 A2: links na resposta ao dono. Um texto de cliente (conversas do WhatsApp,
// anotações) pode tentar fazer o modelo montar um link com dados dentro ("http://site/?d=<CPF>"); o clique do dono, ou a
// prévia do link buscada por quem envia, entregaria os dados a terceiros. Por isso, na resposta ao dono:
//   - toda URL (http/https/outro esquema, "www.", markdown "[texto](url)") e todo trecho com FORMA DE HOST (ver abaixo)
//     fora da LISTA PERMITIDA vira "[link removido]" — só o trecho do link é trocado;
//   - na lista permitida (o domínio do próprio sistema e trello.com), a URL sai em https, sem porta, sem usuário/senha,
//     sem a consulta (?…) e sem o fragmento (#…) — QA r8 achado 5;
//   - URL que não se consegue ler também sai.
// QA r8 achado 1: forma de host = rótulos separados por ponto terminando em TLD plausível (lista de TLDs comuns, qualquer
// TLD de 2 letras, "xn--…", TLD em escrita não latina como "рф", ou, com caminho/porta/esquema, qualquer [a-z]{2,}), ou
// IPv4/IPv6 com caminho ou porta; com ou sem esquema (inclusive quebrado: "https:/", "//"), porta e caminho. Vale sem
// caminho ("52998224725.evil.com": o WhatsApp torna clicável e o toque entrega o dado ao DNS do atacante).
// QA r8 achado 2 — ficam (não são link): nome de arquivo com extensão conhecida ("contrato.pdf/docx"), abreviação de
// endereço/empresa ("Av.Brasil/120", "R.Sete", "Ltda.ME/SP", "Res.Sol/3", "Dr.Carlos"), valores, datas, versões, números
// com ponto, e-mails (seguem a regra de dado pessoal) e o sufixo público sozinho ("gov.br"). Na dúvida, o link sai.
// Os dados que vão ao MODELO não passam por aqui (o dono pode querer saber que existe um link); só a saída ao dono.
export const LINK_REMOVIDO = "[link removido]";

/** Hosts permitidos: o host do sistema (com e sem "www.") e trello.com. Sem a URL do sistema, só o Trello. */
export function hostsPermitidos(urlDoSistema: string | null | undefined): Set<string> {
  const hosts = new Set(["trello.com", "www.trello.com"]);
  const bruto = String(urlDoSistema ?? "").trim();
  if (bruto) {
    try {
      const h = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) ? bruto : `https://${bruto}`).hostname.toLowerCase().replace(/^www\./, "");
      if (h) { hosts.add(h); hosts.add(`www.${h}`); }
    } catch { /* URL do sistema inválida: só o Trello */ }
  }
  return hosts;
}

/** A URL tratada: permitida → https, sem porta, usuário, consulta e fragmento; senão, o marcador. */
function tratarUrl(bruta: string, permitidos: Set<string>): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(bruta) ? bruta : `https://${bruta.replace(/^[/\\]+/, "")}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !permitidos.has(u.hostname.toLowerCase())) return LINK_REMOVIDO;
    return `https://${u.hostname.toLowerCase()}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return LINK_REMOVIDO;
  }
}

// "[texto](destino)" — o destino é link, seja qual for a forma
const MARKDOWN = /\[([^\]\n]{0,200})\]\(\s*([^)\s]{1,2000})\s*\)/g;
// Esquema (http, https, ftp…, javascript:) ou "www.", até espaço ou aspas
const COM_ESQUEMA = /\b(?:[a-z][a-z0-9+.-]{1,15}:\/\/|www\.)[^\s<>"'`]+|\bjavascript:[^\s<>"'`]+/gi;

// ── Forma de host (QA r8 achado 1) ──
const ROTULO = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`;
const TLD = String.raw`(?:xn--[a-z0-9-]{1,59}|[a-z]{2,24}|(?:(?!\p{Script=Latin})\p{L}){2,24})`;
const IPV4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
const IPV6 = String.raw`\[[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[0-9a-z]{1,15})?\]`;
// Esquema quebrado ("https:/", "https:", "hxxp:") ou barras antes do host ("//evil.com", "href=//evil.com")
const PREFIXO = String.raw`(?:(?:h[tx]{2}ps?|ftp|wss?|file):[/\\]{0,3}|[/\\]{1,3})`;
// Não começa no meio de palavra, de e-mail ("@") nem de outro host; o host não termina antes de letra, "@" ou "-".
// "_" conta como separador: no WhatsApp "_www.evil.com_" é itálico e o link dentro é clicável.
const HOST = new RegExp(
  String.raw`(?<![\p{L}\p{N}@.+%-])(${PREFIXO})?(?:(${IPV4}|${IPV6})|((?:${ROTULO}\.)+${TLD}))(?![\p{L}\p{N}@-])`
  + String.raw`(:\d{1,5}(?!\d))?((?:[/?#\\][^\s<>"'\x60]*)?)`,
  "giu",
);
/** TLDs comuns em link (além de qualquer TLD de 2 letras). Sem caminho/porta/esquema, só estes contam. */
const TLDS_CONHECIDOS = new Set((
  "com net org edu gov mil int info biz name pro mobi app dev xyz top site online store shop club live tech fun space "
  + "website icu vip work life world today email cloud digital blog news page one lat rio bet link click win bid loan "
  + "men date download stream racing review party trade science cricket faith accountant host press services agency "
  + "network solutions support center company group global city zone media social chat games art design studio tools "
  + "codes run sbs cfd bond help ink wiki ninja rocks guru money finance capital bank pay cash monster quest beauty "
  + "hair makeup skin boutique fashion buzz cyou rest bar casa house land plus best fit love sex porn xxx adult tube "
  + "video photo pics gallery travel taxi tours events ltd llc inc gmbh foundation exchange market markets trading "
  + "crypto coin wallet bio eco green energy solar ventures holdings investments fund cards gift tickets mom kim"
).split(" "));
/** Extensões de arquivo comuns: "contrato.pdf", "fotos.zip/rar" não são link. */
const EXTENSOES = new Set("pdf doc docx xls xlsx csv txt jpg jpeg png zip rar dwg dxf kml kmz ppt pptx mp4 mp3 json xml".split(" "));
/** Abreviações com ponto comuns em endereço, empresa e tratamento ("Av.Brasil", "R.Sete", "Ltda.ME", "Dr.Carlos"). */
const ABREVIACOES = new Set((
  "av avda r rua al alam trav tv tr est estr rod rodov pc pç pca pça pq prq jd jard vl res resid cond conj cj qd qda "
  + "lt ap apto apt bl blc ed edif sl lj km n nº no nr num cep ltda me epp eireli cia s sa dr dra sr sra srta prof profa "
  + "eng arq adv obs ref tel cel fl pg pag ex etc vol cap art inc dep depto sec"
).split(" "));
/** Sufixos públicos sozinhos (não são de ninguém): "gov.br", "com.br". */
const SUFIXOS_PUBLICOS = /^(?:gov|com|org|net|edu|jus|mp|leg|mil|art|eng|adv|arq|med|ind|inf|tv|blog)\.br$/i;
const PERIGOSOS_NA_ABREVIACAO = new Set("com net org io ly app dev xyz info biz site online link click top".split(" "));

function deixarComoEsta(host: string, temPrefixo: boolean, porta: string, resto: string): boolean {
  if (temPrefixo || porta) return false;
  const rotulos = host.split(".");
  const tld = rotulos[rotulos.length - 1].toLowerCase();
  const nu = !resto;
  // nome de arquivo: "contrato.pdf", "contrato.pdf/docx", "fotos.zip/rar"
  if (EXTENSOES.has(tld) && /^(?:\/[a-z0-9]{2,5})*$/i.test(resto) && [...resto.matchAll(/[a-z0-9]+/gi)].every(m => EXTENSOES.has(m[0].toLowerCase()))) return true;
  if (rotulos.length === 2 && ABREVIACOES.has(rotulos[0].toLowerCase())) {
    // "Av.Brasil/120", "Res.Sol/3": a segunda parte não é TLD de link
    if (!TLDS_CONHECIDOS.has(tld) && tld.length > 2) return true;
    // "Ltda.ME/SP", "R.Sete": TLD de 2 letras ou palavra, sem cara de link (resto curto, só letras)
    if (!PERIGOSOS_NA_ABREVIACAO.has(tld) && /^(?:\/[A-Za-z]{1,3})?$/.test(resto)) return true;
  }
  // "3.Etapa", "12.Fase": números e uma palavra que não é TLD
  if (rotulos.slice(0, -1).every(r => /^\d+$/.test(r)) && !TLDS_CONHECIDOS.has(tld) && tld.length > 2) return true;
  if (nu && SUFIXOS_PUBLICOS.test(host)) return true;
  // sem caminho, porta ou esquema: só TLD conhecido, de 2 letras, punycode ou não latino
  if (nu && !(TLDS_CONHECIDOS.has(tld) || tld.length === 2 || tld.startsWith("xn--") || !/^[a-z]+$/.test(tld))) return true;
  return false;
}

// Pontuação final que é da frase, não da URL
const PONTUACAO_FINAL = /[.,;:!?)\]}*_~]+$/;

function trocar(m: string, permitidos: Set<string>): string {
  const fim = PONTUACAO_FINAL.exec(m)?.[0] ?? "";
  const url = m.slice(0, m.length - fim.length);
  // parêntese que abre dentro da URL fecha nela ("…/wiki/A_(b)")
  if (fim.startsWith(")") && url.includes("(")) return tratarUrl(url + ")", permitidos) + fim.slice(1);
  return tratarUrl(url, permitidos) + fim;
}

// Os trechos já tratados ficam guardados (marcador de uso privado) para a busca de host não os ler de novo.
const GUARDA = /\uE000(\d+)\uE001/g;
// Caractere invisível colado no ponto de um host ("evil\u200B.com/x") sai: o filtro de saída tira os invisíveis depois, e
// o link voltaria a ser clicável.
const INVISIVEL_NO_PONTO = /(?<=[\p{L}\p{N}])[\u00AD\u200B-\u200D\u2060\uFEFF]+(?=\.)|(?<=[\p{L}\p{N}]\.)[\u00AD\u200B-\u200D\u2060\uFEFF]+(?=[\p{L}\p{N}])/gu;

/** Resposta ao dono com os links tratados (ver o cabeçalho). Texto sem link volta idêntico. */
export function tratarLinksDaResposta(texto: string, urlDoSistema: string | null | undefined): string {
  if (!texto || !/[./:\\]|\]\(/.test(texto)) return texto;
  const permitidos = hostsPermitidos(urlDoSistema);
  const guardados: string[] = [];
  const guardar = (s: string) => `\uE000${guardados.push(s) - 1}\uE001`;
  const saida = texto
    .replace(/[\uE000\uE001]/g, "")
    .replace(INVISIVEL_NO_PONTO, "")
    .replace(MARKDOWN, (_m, rotulo: string, destino: string) => `${rotulo} (${guardar(tratarUrl(destino, permitidos))})`)
    .replace(COM_ESQUEMA, m => guardar(trocar(m, permitidos)))
    .replace(HOST, (m: string, prefixo: string | undefined, ip: string | undefined, host: string | undefined, porta: string | undefined, resto: string) => {
      if (ip) {
        // IP sem esquema só é link com caminho, porta ou barras antes ("192.168.0.1/x", "[2001:db8::1]/x")
        if (!prefixo && !porta && !resto) return m;
        if (ip[0] !== "[" && ip.split(".").some(o => Number(o) > 255)) return m;
        return trocar(m, permitidos);
      }
      // nome de host tem no máximo 253 caracteres: maior que isso não é host lido pelo DNS, mas sai sem ler a URL (tempo)
      if (host && host.length > 253) return LINK_REMOVIDO;
      if (host && deixarComoEsta(host, !!prefixo, porta ?? "", resto)) return m;
      // host permitido sem nada em volta ("trello.com") fica como escrito
      if (host && !prefixo && !porta && !resto) {
        const u = tratarUrl(host, permitidos);
        return u === LINK_REMOVIDO ? u : m;
      }
      return trocar(m, permitidos);
    });
  return guardados.length ? saida.replace(GUARDA, (_m, i: string) => guardados[Number(i)] ?? "") : saida;
}
