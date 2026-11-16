// EPIC-025 (Dolores, etapa 2) — QA r7 A2: links na resposta ao dono. Um texto de cliente (conversas do WhatsApp,
// anotações) pode tentar fazer o modelo montar um link com dados dentro ("http://site/?d=<CPF>"); o clique do dono, ou a
// prévia do link buscada por quem envia, entregaria os dados a terceiros. Por isso, na resposta ao dono:
//   - toda URL (http/https/outro esquema, "www.", markdown "[texto](url)" e domínio nu com caminho ou consulta) fora da
//     LISTA PERMITIDA vira "[link removido]";
//   - na lista permitida (o domínio do próprio sistema e trello.com), a URL fica sem a consulta (?…) e sem o fragmento
//     (#…), e sem usuário/senha;
//   - URL que não se consegue ler também sai.
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

/** A URL tratada: permitida → sem consulta, fragmento e usuário; senão, o marcador. */
function tratarUrl(bruta: string, permitidos: Set<string>): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(bruta) ? bruta : `https://${bruta}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !permitidos.has(u.hostname.toLowerCase())) return LINK_REMOVIDO;
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return LINK_REMOVIDO;
  }
}

// "[texto](destino)" — o destino é link, seja qual for a forma
const MARKDOWN = /\[([^\]\n]{0,200})\]\(\s*([^)\s]{1,2000})\s*\)/g;
// Esquema (http, https, ftp…, javascript:) ou "www.", até espaço ou aspas
const COM_ESQUEMA = /\b(?:[a-z][a-z0-9+.-]{1,15}:\/\/|www\.)[^\s<>"'`]+|\bjavascript:[^\s<>"'`]+/gi;
// Domínio nu com caminho, consulta ou fragmento ("evil.example/x", "site.com?d=…"). Não começa no meio de palavra, de
// e-mail ("@") nem de outro domínio; o TLD tem letras (valores "1.500/mês" e datas ficam).
const DOMINIO_NU = /(?<![\w.@/-])[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}(?=[/?#])[^\s<>"'`]*/gi;
// Pontuação final que é da frase, não da URL
const PONTUACAO_FINAL = /[.,;:!?)\]}*_~]+$/;

function trocar(m: string, permitidos: Set<string>): string {
  const fim = PONTUACAO_FINAL.exec(m)?.[0] ?? "";
  const url = m.slice(0, m.length - fim.length);
  // parêntese que abre dentro da URL fecha nela ("…/wiki/A_(b)")
  if (fim.startsWith(")") && url.includes("(")) return tratarUrl(url + ")", permitidos) + fim.slice(1);
  return tratarUrl(url, permitidos) + fim;
}

/** Resposta ao dono com os links tratados (ver o cabeçalho). Texto sem link volta idêntico. */
export function tratarLinksDaResposta(texto: string, urlDoSistema: string | null | undefined): string {
  if (!texto || !/[./:]|\]\(/.test(texto)) return texto;
  const permitidos = hostsPermitidos(urlDoSistema);
  return texto
    .replace(MARKDOWN, (_m, rotulo: string, destino: string) => `${rotulo} (${tratarUrl(destino, permitidos)})`)
    .replace(COM_ESQUEMA, m => trocar(m, permitidos))
    .replace(DOMINIO_NU, m => trocar(m, permitidos));
}
