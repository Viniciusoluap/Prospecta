import { afterEach, describe, expect, it, vi } from "vitest";
import { anexarPdfDoFormulario } from "../client/src/lib/juridico-arquivos";
afterEach(() => vi.unstubAllGlobals());
function preparar() {
  const form = { reset:vi.fn() } as unknown as HTMLFormElement;
  const file = new File(["%PDF-1.7 teste"],"teste.pdf", { type:"application/pdf" });
  const data = new Map<string,unknown>([["file",file],["type","anexo"]]);
  vi.stubGlobal("FormData", class { get(name:string) { return data.get(name); } });
  let ler: (() => void) | undefined;
  vi.stubGlobal("FileReader", class {
    result="data:application/pdf;base64,JVBERi0xLjc="; onload?:() => void;
    readAsDataURL() { ler=() => this.onload?.(); }
  });
  return { form, data, ler:() => ler!() };
}
describe("anexo após leitura e envio assíncronos", () => {
  it("mantém o formulário capturado quando o evento React já perdeu currentTarget", async () => {
    const t=preparar(), salvar=vi.fn(async () => {});
    const evento={ currentTarget:t.form as HTMLFormElement|null };
    const envio=anexarPdfDoFormulario(evento.currentTarget!,salvar); evento.currentTarget=null;
    expect(t.form.reset).not.toHaveBeenCalled();t.ler();await envio;
    expect(salvar).toHaveBeenCalledWith({ name:"teste.pdf",type:"anexo",base64:"JVBERi0xLjc=" });
    expect(t.form.reset).toHaveBeenCalledTimes(1);
  });
  it("preserva a seleção se o envio falhar para permitir tentar novamente", async () => {
    const t=preparar();const envio=anexarPdfDoFormulario(t.form,async () => { throw new Error("Falha de rede"); });
    const resultado=expect(envio).rejects.toThrow("Falha de rede");t.ler();await resultado;
    expect(t.form.reset).not.toHaveBeenCalled();
  });
  it("recusa seleção vazia antes de iniciar o envio", async () => {
    const t=preparar();t.data.set("file",new File([],"vazio.pdf"));const salvar=vi.fn();
    await expect(anexarPdfDoFormulario(t.form,salvar)).rejects.toThrow("Selecione");expect(salvar).not.toHaveBeenCalled();
  });
});
