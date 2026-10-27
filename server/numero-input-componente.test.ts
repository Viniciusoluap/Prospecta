import { describe, it, expect } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NumeroInput } from "../client/src/components/ui/numero-input";
import { CurrencyInput } from "../client/src/components/ui/currency-input";
import { PercentInput } from "../client/src/components/ui/percent-input";
import { NumeroBRField } from "../client/src/components/incorporacao/estudo/compat/numero-br-field";
import { PercentInput as PercentCompat } from "../client/src/components/incorporacao/estudo/compat/percent-input";

// O vitest deste repo compila .tsx com o JSX clássico (React.createElement).
(globalThis as { React?: typeof React }).React = React;

// Correção 21: renderização inicial dos campos (sem DOM; a digitação é coberta
// pela lógica pura em numero-mascara.test.ts).
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noop = () => {};

describe("NumeroInput e wrappers — exibição inicial", () => {
  it("NumeroInput formata pt-BR com prefixo/sufixo e inputMode decimal", () => {
    const h = html(createElement(NumeroInput, { value: 1000000, onChange: noop, prefixo: "R$" }));
    expect(h).toContain('value="1.000.000,00"');
    expect(h).toContain('inputMode="decimal"');
    expect(h).toContain("R$");
    expect(html(createElement(NumeroInput, { value: 0, onChange: noop }))).toContain('value="0,00"');
    expect(html(createElement(NumeroInput, { value: null, onChange: noop }))).toContain('value=""');
    expect(html(createElement(NumeroInput, { value: 0.0575, onChange: noop, casas: 4, sufixo: "%" }))).toContain('value="0,0575"');
  });
  it("input oculto guarda o número cru, sem arredondar", () => {
    const h = html(createElement(NumeroInput, { defaultValue: 1234.5678, name: "valor" }));
    expect(h).toContain('value="1.234,57"');
    expect(h).toContain('name="valor" value="1234.5678"');
  });
  it("CurrencyInput mantém a unidade e o hidden '0' quando vazio", () => {
    expect(html(createElement(CurrencyInput, { value: 180000, onChange: noop }))).toContain('value="180.000,00"');
    const vazio = html(createElement(CurrencyInput, { name: "valor", defaultValue: null }));
    expect(vazio).toContain('name="valor" value="0"');
    expect(vazio).toContain('placeholder="0,00"');
  });
  it("PercentInput respeita maximumFractionDigits", () => {
    expect(html(createElement(PercentInput, { value: 6, onChange: noop }))).toContain('value="6,00"');
    expect(html(createElement(PercentInput, { value: 0.0575, onChange: noop, maximumFractionDigits: 4 }))).toContain('value="0,0575"');
  });
  it("NumeroBRField e PercentInput (compat) da incorporação", () => {
    expect(html(createElement(NumeroBRField, { value: 2500.5, onValueChange: noop }))).toContain('value="2.500,50"');
    expect(html(createElement(NumeroBRField, { value: 1.2345, onValueChange: noop, decimals: 4 }))).toContain('value="1,2345"');
    expect(html(createElement(NumeroBRField, { value: 0, onValueChange: noop }))).toContain('value=""');
    expect(html(createElement(PercentCompat, { value: 2.345, onValueChange: noop }))).toContain('value="2,345"');
  });
});
