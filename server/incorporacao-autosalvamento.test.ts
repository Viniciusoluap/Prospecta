import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { salvarFila, type FilaSalvamento } from "../client/src/components/incorporacao/estudo/compat/fila-salvamento";

function preparar(gravar: FilaSalvamento<string>["gravar"]) {
  const fila: FilaSalvamento<string> = { atual: '"original"', gravado: '"original"', gravar, envio: null };
  const confirmar = vi.fn();
  const falhar = vi.fn();
  const salvar = () => salvarFila(fila, confirmar, falhar, vi.fn(), vi.fn());
  return { fila, confirmar, falhar, salvar };
}

describe("fila de salvamento da Incorporação", () => {
  it("não grava sem mudança no conteúdo", async () => {
    const gravar = vi.fn();
    const { salvar, confirmar } = preparar(gravar);
    expect(await salvar()).toBe(true);
    expect(gravar).not.toHaveBeenCalled();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("serializa as edições recebidas durante uma gravação e confirma cada resposta", async () => {
    let liberar!: () => void;
    const gravar = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { liberar = resolve; })).mockResolvedValue(undefined);
    const { fila, confirmar, salvar } = preparar(gravar);
    fila.atual = '"primeiro"';
    const primeiro = salvar();
    await Promise.resolve();
    fila.atual = '"mais recente"';
    expect(salvar()).toBe(primeiro);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(fila.gravado).toBe('"original"');
    liberar();
    expect(await primeiro).toBe(true);
    expect(gravar.mock.calls).toEqual([["primeiro", "original"], ["mais recente", "primeiro"]]);
    expect(confirmar.mock.calls).toEqual([['"primeiro"'], ['"mais recente"']]);
    expect(fila.envio).toBeNull();
  });

  it("mantém o rascunho após falha e confirma somente a nova tentativa bem-sucedida", async () => {
    const erro = new Error("Falha na rede");
    const gravar = vi.fn().mockRejectedValueOnce(erro).mockResolvedValue(undefined);
    const { fila, confirmar, falhar, salvar } = preparar(gravar);
    fila.atual = '"rascunho"';
    expect(await salvar()).toBe(false);
    expect(falhar).toHaveBeenCalledWith('"rascunho"', erro);
    expect(fila.gravado).toBe('"original"');
    expect(confirmar).not.toHaveBeenCalled();
    expect(await salvar()).toBe(true);
    expect(confirmar).toHaveBeenCalledWith('"rascunho"');
    expect(fila.gravado).toBe('"rascunho"');
  });
});

// Revisão do PR #263 do Santa Fé (mesma regra nos dois sistemas): Viabilidade sem premissas gravadas abre com os padrões; esse conteúdo não conta como gravado.
describe("fila de salvamento — formulário sem registro gravado", () => {
  function semRegistro(gravar: FilaSalvamento<{ v: number }>["gravar"]) {
    const fila: FilaSalvamento<{ v: number }> = { atual: '{"v":1}', gravado: '{"v":1}', gravar, envio: null, registrado: false };
    const confirmar = vi.fn();
    const falhar = vi.fn();
    const salvar = (forcar: boolean) => salvarFila(fila, confirmar, falhar, vi.fn(), vi.fn(), forcar);
    return { fila, confirmar, falhar, salvar };
  }

  it("o salvamento automático (sem forçar) não grava só por abrir a aba", async () => {
    const gravar = vi.fn();
    const { salvar, fila } = semRegistro(gravar);
    expect(await salvar(false)).toBe(true);
    expect(gravar).not.toHaveBeenCalled();
    expect(fila.registrado).toBe(false);
  });

  it("o botão força a primeira gravação mesmo sem alteração, com o JSON inicial válido como anterior", async () => {
    const gravar = vi.fn().mockResolvedValue(undefined);
    const { salvar, fila, confirmar } = semRegistro(gravar);
    expect(await salvar(true)).toBe(true);
    expect(gravar.mock.calls).toEqual([[{ v: 1 }, { v: 1 }]]);
    expect(confirmar).toHaveBeenCalledWith('{"v":1}');
    expect(fila.registrado).toBe(true);
    // depois de gravado, forçar de novo sem alteração não grava outra vez
    expect(await salvar(true)).toBe(true);
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  it("depois de uma alteração o salvamento automático grava e marca como registrado", async () => {
    const gravar = vi.fn().mockResolvedValue(undefined);
    const { salvar, fila } = semRegistro(gravar);
    fila.atual = '{"v":2}';
    expect(await salvar(false)).toBe(true);
    expect(gravar.mock.calls).toEqual([[{ v: 2 }, { v: 1 }]]);
    expect(fila.registrado).toBe(true);
    expect(fila.gravado).toBe('{"v":2}');
  });

  it("falha na primeira gravação forçada: continua sem registro e informa o erro", async () => {
    const erro = new Error("Falha na rede");
    const gravar = vi.fn().mockRejectedValueOnce(erro).mockResolvedValue(undefined);
    const { salvar, fila, falhar, confirmar } = semRegistro(gravar);
    expect(await salvar(true)).toBe(false);
    expect(falhar).toHaveBeenCalledWith('{"v":1}', erro);
    expect(fila.registrado).toBe(false);
    expect(confirmar).not.toHaveBeenCalled();
    expect(await salvar(true)).toBe(true);
    expect(fila.registrado).toBe(true);
  });

  it("formulários com registro (padrão) não mudam: forçar sem alteração não grava", async () => {
    const gravar = vi.fn();
    const { fila } = preparar(gravar);
    expect(await salvarFila(fila, vi.fn(), vi.fn(), vi.fn(), vi.fn(), true)).toBe(true);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("a Viabilidade passa semRegistro quando o estudo não tem premissas e o gancho não chama salvo antes da gravação", () => {
    const aba = readFileSync(resolve(__dirname, "../client/src/components/incorporacao/estudo/viabilidade-tab.tsx"), "utf8");
    expect(aba).toMatch(/\{ semRegistro: !salvo \}/);
    const gancho = readFileSync(resolve(__dirname, "../client/src/components/incorporacao/estudo/compat/salvamento.tsx"), "utf8");
    expect(gancho).toMatch(/salvo: registrado && !alterado && !pending/);
    // o salvamento automático usa a versão que não força
    expect(gancho).toMatch(/setTimeout\(\(\) => \{ void salvarAlteracao\(\); \}/);
    // a falha da primeira gravação aparece no aviso do estudo (com "Tentar novamente")
    expect(gancho).toContain("alterado || pending || erro ? { erro, salvar } : null");
  });
});
