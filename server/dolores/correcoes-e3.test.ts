// EPIC-025 (Dolores, etapa 3) — regressões das correções do portão de QA (Quinn, 16/11): cada teste é a versão
// INVERTIDA de um ataque do QA (A1–A9) — passa só com o defeito corrigido. Porta da ponte e motor da fila (PGlite).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../pci-gerador.js", () => ({
  modeloAtualPci: vi.fn(async () => ({ id: 1, versao: 3 })),
  gerarPciDaObra: vi.fn(async () => ({ id: 77, avisos: [], pendencias: [] })),
}));
vi.mock("../../shared/pci-gerador.js", async orig => ({ ...(await orig<typeof import("../../shared/pci-gerador.js")>()), errosPci: vi.fn(() => []) }));

import { errosPci } from "../../shared/pci-gerador.js";
import { getDb } from "../db.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const q = async <T = any>(s: string) => (await banco.pg.query<T>(s)).rows;
const fila = () => q<any>("SELECT * FROM dolores_aprovacoes ORDER BY id");
const doDono = (funcao: string, argumentos: Record<string, unknown>, mensagemId = 10) =>
  executarFuncao({ funcao, argumentos, pedidoId: `wa:${mensagemId}:1:0` }, { canal: "whatsapp", mensagemId });

let seq = 0;
beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`CREATE TABLE IF NOT EXISTS pci_generator_drafts (project_id integer PRIMARY KEY, form_data jsonb NOT NULL, updated_by integer, updated_at timestamp NOT NULL DEFAULT now());`);
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  seq = 0;
  definirSorteioCodigo(() => ((seq++ * 7) % 22) / 22 + 0.001);
  vi.mocked(errosPci).mockReturnValue([]);
});
afterEach(() => { definirDependenciasPonte(); definirSorteioCodigo(); vi.clearAllMocks(); });

describe("A1 (achado 5) — gatilho de dolores_aprovacoes protege o que o dono lê e a ordem da execução", () => {
  it("UPDATE direto não prorroga a validade, não troca resumo/pedido/autor, não pula para 'executada' e não reescreve o resultado", async () => {
    await doDono("preparar_cobranca", { leadIds: [1, 2] });
    const [i1, i2] = await fila();
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET vence_em = now() + interval '10 years' WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET resumo = 'Tarefa inofensiva' WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET pedido_id = 'outro' WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET autor_user_id = NULL WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET situacao = 'executada', resultado = '{"feitos":["inventado"]}' WHERE id = ${i2.id}`)).rejects.toThrow(/EXECUCAO_UNICA/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET resultado = '{"feitos":["inventado"]}' WHERE id = ${i2.id}`)).rejects.toThrow(/RESULTADO/);
    // em execução: o resultado não é reescrito sem encerrar; a decisão não muda
    await banco.pg.exec(`UPDATE dolores_aprovacoes SET situacao = 'executando', decidido_em = now(), decidido_via = 'tela' WHERE id = ${i2.id}`);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET resultado = '{"feitos":["inventado"]}' WHERE id = ${i2.id}`)).rejects.toThrow(/RESULTADO/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET decidido_via = 'whatsapp' WHERE id = ${i2.id}`)).rejects.toThrow(/IMUTAVEL/);
    // a transição legítima continua valendo: executando → executada com o resultado
    await banco.pg.exec(`UPDATE dolores_aprovacoes SET situacao = 'executada', executado_em = now(), resultado = '{"feitos":["ok"]}' WHERE id = ${i2.id}`);
    const [a, b] = await fila();
    expect(a.resumo).toBe(i1.resumo);
    expect(new Date(a.vence_em).getTime()).toBe(new Date(i1.vence_em).getTime());
    expect(b).toMatchObject({ situacao: "executada", resultado: { feitos: ["ok"] } });
  });
});
