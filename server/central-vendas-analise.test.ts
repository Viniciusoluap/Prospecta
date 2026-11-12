// Central de Vendas — etapa 7: retorno da análise. Decisão só por humano; cada decisão dispara a mensagem certa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { montarCenario, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { registrarDecisao } from "./central-vendas/analise.js";
import { agendarLembretes } from "./central-vendas/documentos.js";
import { processarFila } from "./central-vendas/envio.js";

let c: Cenario;
beforeEach(async () => {
  c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never));
  await c.pg.exec(`INSERT INTO central_vendas_checklists (slug, nome, documentos) VALUES ('mcmv', 'MCMV', '[{"chave":"rg","nome":"RG","tipo":"rg","obrigatorio":true}]');
    INSERT INTO leads (name, phone, stage) VALUES ('Ana Souza', '99988887777', 'attending');
    INSERT INTO central_vendas_leads (lead_id, status_atendimento, status_documental, status_analise, operador_id, checklist_id, enviado_analise_em)
      VALUES (1, 'aguardando_cliente', 'completo', 'em_analise', 2, 1, now());`);
});
afterEach(async () => { definirDependencias(); await c.pg.close(); });
const cv = async () => (await c.linhas<Record<string, unknown>>("SELECT status_atendimento, status_documental, status_analise, decisao_por FROM central_vendas_leads"))[0];

describe("decisão da análise", () => {
  it("pendente: mensagem com as pendências, volta a aguardar documentos e os lembretes recomeçam", async () => {
    await registrarDecisao({ leadId: 1, decisao: "pendente", pendencias: "extrato do FGTS atualizado", userId: 4 });
    expect(await cv()).toMatchObject({ status_documental: "aguardando_documentos", status_analise: "pendente", decisao_por: 4 });
    expect(c.envios.map(e => e.texto)).toEqual(["Ana, a análise apontou estas pendências: extrato do FGTS atualizado. Envie por aqui assim que puder para continuarmos."]);
    // Checklist do lead está completo, mas a pendência reabre o ciclo: o lembrete D+1 volta a contar da decisão.
    await c.pg.exec("INSERT INTO central_vendas_checklists (slug, nome, documentos) VALUES ('extra', 'Extra', '[{\"chave\":\"fgts\",\"nome\":\"Extrato do FGTS\",\"tipo\":\"fgts\",\"obrigatorio\":true}]'); UPDATE central_vendas_leads SET checklist_id = 2");
    c.avancar(24 * 60);
    expect(await agendarLembretes()).toBe(1);
  });

  it("aprovado: entra no follow-up, avisa o operador e manda o template sem valores", async () => {
    await registrarDecisao({ leadId: 1, decisao: "aprovado", userId: 1 });
    expect(await cv()).toMatchObject({ status_analise: "aprovado", decisao_por: 1 });
    expect(await c.linhas("SELECT stage, temperature FROM leads")).toEqual([{ stage: "approved_projects", temperature: "hot" }]);
    expect(c.envios).toHaveLength(1);
    expect(c.envios[0].texto).toBe("Ana, sua análise foi concluída com resultado positivo! Olga, da nossa equipe, vai falar com você sobre os próximos passos.");
    expect(c.envios[0].texto).not.toMatch(/R\$|\d/);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%follow-up%'")).toEqual([{ user_id: 2 }]);
  });

  it("reprovado: mensagem neutra (sem o motivo) e transferência para humano", async () => {
    await registrarDecisao({ leadId: 1, decisao: "reprovado", motivoInterno: "Restrição no CPF", userId: 4 });
    expect(await cv()).toMatchObject({ status_analise: "reprovado", status_atendimento: "em_atendimento_humano" });
    expect(c.envios).toHaveLength(1);
    expect(c.envios[0].texto).not.toMatch(/CPF|restri|reprovad|negad/i);
    expect(await c.linhas("SELECT rejection_reason FROM leads")).toEqual([{ rejection_reason: "Restrição no CPF" }]);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%reprovada%'")).toEqual([{ user_id: 2 }]);
  });

  it("fora da janela 8h–20h a mensagem da decisão espera a abertura seguinte", async () => {
    c.relogio.agora = new Date("2026-11-13T01:30:00Z"); // 22h30 em Fortaleza
    await registrarDecisao({ leadId: 1, decisao: "aprovado", userId: 1 });
    expect(c.envios).toHaveLength(0);
    c.relogio.agora = new Date("2026-11-13T11:45:00Z"); // 8h45
    await processarFila();
    expect(c.envios).toHaveLength(1);
  });
});

describe("nenhuma automação consegue marcar aprovado", () => {
  it("exige admin ou analista ativo; operador, inativo ou id inexistente são recusados", async () => {
    for (const userId of [2, 5, 999, Number.NaN]) {
      await expect(registrarDecisao({ leadId: 1, decisao: "aprovado", userId })).rejects.toThrow(/administrador ou um analista/);
    }
    expect(await cv()).toMatchObject({ status_analise: "em_analise", decisao_por: null });
  });
  it("o banco recusa decisão sem o humano que decidiu", async () => {
    await expect(c.pg.exec("UPDATE central_vendas_leads SET status_analise = 'aprovado'")).rejects.toThrow(/decisao_humana/);
  });
  it("só decide quem está em análise; pendente exige a descrição", async () => {
    await expect(registrarDecisao({ leadId: 1, decisao: "pendente", pendencias: "", userId: 1 })).rejects.toThrow(/pendências/);
    await registrarDecisao({ leadId: 1, decisao: "aprovado", userId: 1 });
    await expect(registrarDecisao({ leadId: 1, decisao: "reprovado", userId: 1 })).rejects.toThrow(/não está em análise/);
  });
});
