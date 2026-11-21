// EPIC-027 C8 (21/11) — limpeza do SVG do logotipo (vale para o enviado e para o desenhado pela IA): cada vetor conhecido.
import { describe, expect, it } from "vitest";
import { LIMITE_SVG_IA_BYTES, SvgRecusado, sanitizarSvg } from "./incorporacao-logo-svg";
import { tipoDoLogo } from "../shared/incorporacao/logotipo";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const limpar = (s: string) => sanitizarSvg(s, LIMITE_SVG_IA_BYTES).toString("utf8");
const recusa = (s: string, motivo: RegExp | typeof SvgRecusado) => expect(() => sanitizarSvg(s, LIMITE_SVG_IA_BYTES)).toThrow(motivo);

describe("sanitizarSvg", () => {
  it("mantém o desenho (formas, texto, gradiente com url(#id), use interno) e continua SVG", () => {
    const svg = `<svg ${NS} ${XL} viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#C9A961"/></linearGradient><path id="p" d="M0 0L5 5"/></defs>`
      + `<rect width="10" height="10" fill="url(#g)" style="stroke:url('#g')"/><use xlink:href="#p"/><use href="#p"/><text x="1" y="9" font-family="serif">Nome &amp; Cia</text></svg>`;
    const r = limpar(svg);
    expect(r).toContain('fill="url(#g)"');
    expect(r).toContain('xlink:href="#p"');
    expect(r).toContain('href="#p"');
    expect(r).toContain("Nome &amp; Cia");
    expect(tipoDoLogo(Buffer.from(r))).toBe("image/svg+xml");
  });

  it("acrescenta o xmlns do SVG quando falta (sem ele o navegador não desenha)", () => {
    expect(limpar('<svg viewBox="0 0 1 1"><circle r="1"/></svg>')).toContain(NS);
  });

  it("remove <script> (inclusive com CDATA) e <foreignObject>", () => {
    const r = limpar(`<svg ${NS}><script>alert(1)</script><script type="text/ecmascript"><![CDATA[alert(2)]]></script>`
      + `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(3)"/></div></foreignObject><circle r="1"/></svg>`);
    expect(r).not.toMatch(/script|alert|foreignObject|onerror|<div|<img/i);
    expect(r).toContain("<circle");
  });

  it("remove atributos on* em qualquer caixa", () => {
    const r = limpar(`<svg ${NS} onload="a()"><circle r="1" OnClick="b()" onmouseover="c()"/></svg>`);
    expect(r).not.toMatch(/on(load|click|mouseover)|a\(\)|b\(\)|c\(\)/i);
  });

  it("href/xlink:href externos, javascript: e data: que não é imagem saem; <use>/<image> sem href válido saem", () => {
    const r = limpar(`<svg ${NS} ${XL}><use href="https://mal.example/x.svg#a"/><use xlink:href="javascript:alert(1)"/>`
      + `<image href="https://mal.example/rastreio.png"/><image xlink:href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>`
      + `<image xlink:href="data:text/html;base64,PGgxPg=="/><a href="javascript:alert(2)"><circle r="1"/></a><rect width="1" height="1"/></svg>`);
    expect(r).not.toMatch(/mal\.example|javascript|data:text|svg\+xml|<use|<image|<a[\s>]/i);
    expect(r).toContain("<rect");
  });

  it("<image> com imagem embutida PNG/JPG fica", () => {
    const r = limpar(`<svg ${NS}><image width="1" height="1" href="data:image/png;base64,iVBORw0KGgo="/></svg>`);
    expect(r).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("javascript: escondido com espaços/entidades em qualquer atributo sai", () => {
    const r = limpar(`<svg ${NS}><circle r="1" fill="java&#x09;script:alert(1)" filter="url(javascript:x)"/></svg>`);
    expect(r).not.toMatch(/javascript|alert/i);
  });

  it("@import, url(http…), expression() em <style> ou style= saem", () => {
    const r = limpar(`<svg ${NS}><style>@import url(https://mal.example/a.css);</style><style>circle{fill:url(http://mal.example/x)}</style>`
      + `<style>.a{fill:#000}</style><circle r="1" style="fill:url(https://mal.example/y)"/><rect style="width:expression(alert(1))"/></svg>`);
    expect(r).not.toMatch(/mal\.example|@import|expression/i);
    expect(r).toContain(".a{fill:#000}");
  });

  it("animações (<set>/<animate> podem trocar o href) e elementos desconhecidos/de editores saem", () => {
    const r = limpar(`<svg ${NS} xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" sodipodi:docname="x">`
      + `<set attributeName="href" to="javascript:alert(1)"/><animate attributeName="x" values="0;1"/><sodipodi:namedview/><metadata>m</metadata><iframe/><circle r="1"/></svg>`);
    expect(r).not.toMatch(/<set|<animate|sodipodi|metadata|iframe|javascript/i);
  });

  it("comentários e instruções de processamento (xml-stylesheet externo) saem", () => {
    const r = limpar(`<?xml version="1.0"?><?xml-stylesheet href="https://mal.example/a.css"?><!-- c --><svg ${NS}><!-- d --><circle r="1"/></svg>`);
    expect(r).not.toMatch(/mal\.example|xml-stylesheet|<!--/);
  });

  it("recusa entidades e DOCTYPE com declarações internas; DOCTYPE simples é só removido", () => {
    recusa(`<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg ${NS}>&a;</svg>`, /entidades/);
    recusa(`<!DOCTYPE svg [<!ELEMENT svg ANY>]><svg ${NS}/>`, /DOCTYPE/);
    recusa(`<!DOCTYPE svg SYSTEM "file:///etc/passwd" [ ]><svg ${NS}/>`, /DOCTYPE/);
    const r = limpar(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg ${NS}><circle r="1"/></svg>`);
    expect(r).not.toMatch(/DOCTYPE|w3\.org\/Graphics/);
  });

  it("aceita só um <svg> raiz; XML malformado, HTML e raiz diferente são recusados", () => {
    recusa(`<html><svg ${NS}/></html>`, /único elemento <svg>/);
    recusa(`<svg ${NS}/><svg ${NS}/>`, SvgRecusado);
    recusa(`<svg ${NS}><circle></svg>`, /XML válido/);
    recusa("texto qualquer", SvgRecusado);
  });

  it("tamanho máximo", () => {
    const grande = `<svg ${NS}>${'<circle r="1"/>'.repeat(20_000)}</svg>`;
    expect(grande.length).toBeGreaterThan(LIMITE_SVG_IA_BYTES);
    recusa(grande, /limite de 200 KB/);
  });
});
