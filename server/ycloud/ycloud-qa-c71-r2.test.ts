// EPIC-027 C7.1 — portão de QA de SEGURANÇA, rodada 2 (Quinn, 21/11/2026), sobre o commit de correção 11bc917.
// C7.3 (21/11/2026): trazido do worktree do QA; as asserções que fixavam os contornos residuais (texto fixo e "6+ dígitos" → aviso da
// integração) passam a fixar o comportamento corrigido. Os testes completos da C7.3 estão em ycloud-c73.test.ts.
// Só funções puras (sem banco): documenta o que a correção fecha e os contornos residuais conhecidos (classificados como BAIXOS:
// o texto fixo continua dentro de um modelo aprovado pela Meta; resta engenharia social).
import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { AVISO_AJUSTE_ADMIN, AVISO_NAO_CONCLUIDO, MOTIVO_PAUSA_ADMIN, MOTIVO_PAUSA_EQUIPE, motivoParaEquipe, podeContinuarPausa } from "./campanhas.js";
import { detalheComPapel, separarPapel } from "./config.js";
import { problemaDoTextoFixoDaEquipe } from "../../shared/whatsapp/ycloud.js";

describe("R2 — F3: quem continua a pausa", () => {
  it("colaborador só continua a própria pausa ou o limite do dia; nunca admin, trava, motivo nulo ou vazio", () => {
    expect(podeContinuarPausa(MOTIVO_PAUSA_EQUIPE, "colaborador")).toBe(true);
    expect(podeContinuarPausa("Limite de 250 destinatários em 24 h atingido. Clique em \"Continuar\"…", "colaborador")).toBe(true);
    for (const m of [MOTIVO_PAUSA_ADMIN, null, undefined, "", "Cinco falhas seguidas: campanha pausada para conferir o modelo e a conta.",
      "A qualidade do número está BAIXA (vermelha) na Meta: disparos suspensos para proteger o número.",
      "Os disparos pela API oficial estão DESLIGADOS pelo administrador (Configurações › Integrações › API oficial do WhatsApp).",
      "A YCloud respondeu HTTP 403 (FORBIDDEN): x.", " Pausada pela equipe (colaborador).", "pausada pela equipe (colaborador).",
      "limite de 250"]) {
      expect(podeContinuarPausa(m, "colaborador")).toBe(false);
      expect(podeContinuarPausa(m, "admin")).toBe(true);
    }
    // papel desconhecido / corretor (não alcança a rota, mas a função falha fechada)
    expect(podeContinuarPausa(MOTIVO_PAUSA_ADMIN, "user")).toBe(false);
    expect(podeContinuarPausa(MOTIVO_PAUSA_ADMIN, "Admin")).toBe(false);
  });
});

describe("R2 — F1/F2: motivo para a equipe", () => {
  it("número da integração (todas as frases de conta.ts e da situação) vira o aviso genérico; limite e janela sem valores", () => {
    for (const m of [
      "A conta da YCloud não tem nenhum número de WhatsApp conectado.",
      "O número da empresa ainda não está cadastrado em Integrações › WhatsApp da empresa: sem ele, não dá para conferir se a API é o mesmo número. Disparos bloqueados.",
      "ATENÇÃO: o número da API (+55 •••• 1111) NÃO é o número da empresa (+55 •••• 2222). Disparos bloqueados até os dois serem o mesmo número.",
      "O número da API não é o da empresa.",
    ]) expect(motivoParaEquipe(m)).toBe(AVISO_AJUSTE_ADMIN);
    // C7.3: número que não é da integração → frase neutra (não diz que é a integração), ainda sem o número
    expect(motivoParaEquipe("erro 5599988881111")).toBe(AVISO_NAO_CONCLUIDO);
    expect(motivoParaEquipe("Limite de 1000 destinatários em 24 h atingido. Clique em \"Continuar\" depois.")).toBe("Limite de destinatários em 24 h atingido. Clique em \"Continuar\" depois.");
    expect(motivoParaEquipe("Não enviada: já recebeu este modelo nos últimos 30 dia(s).")).toBe("Não enviada: já recebeu este modelo recentemente.");
    expect(motivoParaEquipe(null)).toBeNull();
  });
});

describe("R2 — texto fixo do colaborador: o que o filtro pega e os contornos residuais (BAIXO)", () => {
  it("pega as formas óbvias", () => {
    for (const v of ["https://x.y", "www.exemplo", "exemplo.com", "EXEMPLO.COM.BR", "bit.ly/abc", "wa.me/5511", "t.me/x",
      "(11) 99999-8888", "+55 11 9 9999 8888", "1 1 9 9 9 9 8 8 8 8", "11.99999.8888"]) {
      expect(problemaDoTextoFixoDaEquipe(v), v).not.toBeNull();
    }
  });
  it("C7.3: as ofuscações da rodada 2 agora são recusadas — separadores, TLD fora da lista, unicode, por extenso, @perfil", () => {
    for (const v of ["exemplo ponto com", "exemplo . com", "exemplo․com" /* U+2024 */, "exemplo.dev", "exemplo.ai",
      "11/9999/8888", "１１９９９９９８８８８" /* dígitos largos */, "@perfil_no_instagram"]) {
      expect(problemaDoTextoFixoDaEquipe(v), v).not.toBeNull();
    }
  });
  it("RESIDUAL (baixo) que continua: número por extenso (engenharia social)", () => {
    expect(problemaDoTextoFixoDaEquipe("onze nove nove nove nove")).toBeNull();
  });
});

describe("R2 — auditoria: 'papel=' nunca vem de fora", () => {
  it("status da YCloud prefixado e detalhe começando com papel= escapado", () => {
    expect(separarPapel(detalheComPapel(null, "status_ycloud=APPROVED")).papel).toBeNull();
    expect(separarPapel(detalheComPapel(null, "papel=admin; x")).papel).toBeNull();
    expect(separarPapel(detalheComPapel(null, "  papel=admin")).papel).toBeNull();
    expect(separarPapel(detalheComPapel("colaborador", "papel=admin")).papel).toBe("colaborador");
    expect(separarPapel(detalheComPapel("colaborador", "papel=admin")).detalhe).toBe("texto: papel=admin");
  });
});
