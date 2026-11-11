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
