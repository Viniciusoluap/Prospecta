// Portão de QA (segurança) da C7.3 — EPIC-027. Só funções puras: sem banco, sem API real.
import { describe, expect, it } from "vitest";
import { problemaDoTextoFixoDaEquipe as filtro } from "../../shared/whatsapp/ycloud";
import { textoEhDaCampanha, TOLERANCIA_ECO_CAMPANHA } from "./campanhas";

describe("QA C7.3 — filtro do texto fixo do colaborador", () => {
  it("texto comum de obra/imóvel passa (horas, valores, datas, nº, abreviações com espaço, CEP, apto)", () => {
    for (const t of [
      "14h30", "das 08:00 às 18:00", "R$ 1.500,00", "R$ 1.500.000,00", "25/11/2026", "25/11/2026 às 14h", "05/12 e 06/12",
      "nº 120", "n.º 120", "1º andar", "Sr. João", "Av. Brasil", "Jd. Europa", "Vila Sta. Maria", "Eng.ª Maria", "Ltda.", "S.A.",
      "CEP 12345-678", "Rua das Flores, 120 - Centro", "Torre 2, apto 1203", "Bloco A - 101/102", "Lote 12 Quadra 34",
      "Entrada: 10% + 60x", "3 dorm. c/ suíte", "Piscina • Academia",
    ]) expect(filtro(t), t).toBeNull();
  });

  it("ofuscações de link e telefone continuam recusadas", () => {
    for (const t of [
      "exemplo . com", "exemplo·com", "exemplo​.com", "exemplo。com", "wa.me/5511", "t.me x", "ponto com", "lojaxyz dot com",
      "instagram @loja", "(11) 98765-4321", "11 9 8765 4321", "11-98765-4321", "1 1 9 8 7 6 5 4 3 2 1", "1198765432１",
    ]) expect(filtro(t), t).not.toBeNull();
  });

  // Achado INFORMATIVO do portão: "1-" repetido era quadrático (lookbehind de DATA/CEP). Corrigido: a parte de telefone é uma
  // varredura linear e o filtro recusa acima de 2.000 caracteres (o router já limita a 1024).
  it("sem ReDoS: entradas adversariais no limite do campo (1024) e no dobro terminam rápido", () => {
    const entradas = ["1" + "/".repeat(1023), "1/".repeat(512), "a.".repeat(512), "1 ".repeat(512) + "x", "ponto ".repeat(170),
      "(".repeat(1023) + "1", "1-".repeat(512), "1-".repeat(1024), "1/1 ".repeat(512), "1" + "/".repeat(100_000) + "x"];
    const t0 = Date.now();
    for (const e of entradas) filtro(e);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  // Falsos positivos do portão C7.3 (achado BAIXO), corrigidos: texto comum que era recusado como "telefone"/"link".
  it("intervalo de datas, data com hora, unidades, valores, abreviação colada e medidas passam", () => {
    for (const t of [
      "Plantão 25/11 - 30/11", "25/11/2026 - 30/11/2026", "dia 25/11/2026 14h", "aptos 101 102 103", "R$ 250.000 - 300.000",
      "R$ 15.000.000,00", "Av.Brasil", "Sr.João", "de 8h às 18h", "Qd 18 Lt 4", "3 quartos 2 vagas 68 m²",
    ]) expect(filtro(t), t).toBeNull();
  });

  it("as exceções não abrem brecha: link, @perfil e telefone continuam recusados", () => {
    for (const t of [
      "http://x.y", "https://x.y", "www.exemplo", "exemplo.com", "exemplo . com", "wa.me/5511", "t.me/x", "bit.ly/abc",
      "exemplo ponto com", "lojaxyz dot com", "exemplo·com", "exemplo\u200b.com", "Av.Com", "Sr.Br", "Av.brasil.com", "@perfil",
      "(99) 98139-2210", "99 9 8139 2210", "99981392210", "+55 99 98139-2210", "11/9999/8888", "\uFF19\uFF19\uFF19\uFF18\uFF11\uFF13\uFF19\uFF12\uFF12\uFF11\uFF10",
      "25/11/2026 99999 8888", "25/11 - 30/11 98139-2210", "R$ 99.981.392.210", "99.981.392.210", "99.981 392.210",
      "101 102 103 104 98139", "981 392 210", "25/11/2026 14 98139", "12345-678 9813-9221",
    ]) expect(filtro(t), t).not.toBeNull();
  });

  it("acima de 2.000 caracteres é recusado sem análise", () => {
    expect(filtro("a ".repeat(1001))).toMatch(/passa de 2000/);
    expect(filtro("a ".repeat(1000))).toBeNull();
  });
});

describe("QA C7.3 — eco: mensagem manual da equipe nunca vira eco", () => {
  const corpo = "Olá Maria, a vistoria do seu apartamento foi agendada.";
  const novo = { texto: corpo, parametros: { textoCompleto: `Prospecta\n${corpo}`, rodape: null } };
  const novoComRodape = { texto: corpo, parametros: { textoCompleto: `Prospecta\n${corpo}`, rodape: "Responda SAIR para não receber" } };

  it("envio novo: só o texto exato (com ou sem cabeçalho/rodapé guardado)", () => {
    expect(textoEhDaCampanha(corpo, novo)).toBe(true);
    expect(textoEhDaCampanha(`Prospecta\n${corpo}`, novo)).toBe(true);
    expect(textoEhDaCampanha(`Prospecta ${corpo} Responda SAIR para não receber`, novoComRodape)).toBe(true);
  });

  it("envio novo: qualquer acréscimo da equipe, antes ou depois, é da equipe", () => {
    expect(textoEhDaCampanha(`${corpo} ok`, novo)).toBe(false);
    expect(textoEhDaCampanha(`Oi! ${corpo}`, novo)).toBe(false);
    expect(textoEhDaCampanha(`${corpo} Pode me ligar?`, novoComRodape)).toBe(false);
    expect(textoEhDaCampanha(`Prospecta\n${corpo}\nResponda SAIR para não receber. Me chama aqui`, novoComRodape)).toBe(false);
    expect(textoEhDaCampanha(`${corpo} ${corpo}`, novo)).toBe(false);
  });

  it("falha fechada: sem texto, corpo curto ou parâmetros estranhos → não é eco", () => {
    expect(textoEhDaCampanha("", novo)).toBe(false);
    expect(textoEhDaCampanha(null, novo)).toBe(false);
    expect(textoEhDaCampanha("ok", { texto: "ok", parametros: null })).toBe(false);
    expect(textoEhDaCampanha(corpo, { texto: null, parametros: null })).toBe(false);
    expect(textoEhDaCampanha("outro texto qualquer da equipe", { texto: corpo, parametros: "lixo" })).toBe(false);
  });

  it("envio antigo (sem rodapé guardado): a tolerância é limitada a um rodapé/cabeçalho", () => {
    const antigo = { texto: corpo, parametros: { textoCompleto: corpo } };
    expect(textoEhDaCampanha(`${corpo} ${"x".repeat(TOLERANCIA_ECO_CAMPANHA + 1)}`, antigo)).toBe(false);
  });
});
