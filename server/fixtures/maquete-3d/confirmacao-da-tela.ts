// Testes da Maquete 3D (QA S-11 r2, achado 2): a confirmação do custo da IA leva o modelo que a tela mostrou ao admin.
// Este invólucro faz o que a tela faz: lê o detalhe e manda o `modeloAConfirmar` do passo parado. Sem passo parado
// (testes de erros anteriores à confirmação), manda o modelo que vale agora. Quem passa `modeloVisto` usa o seu.
import type { appRouter } from "../../routers.js";
import { carregarConfig } from "../../maquete-3d/base.js";
import { modeloParaConfirmar } from "../../maquete-3d/execucao-ia.js";

type Maquete3dCaller = ReturnType<typeof appRouter.createCaller>["maquete3d"];
type Detalhe = Awaited<ReturnType<Maquete3dCaller["detalhe"]>>;

export async function modeloDaTela(c: Maquete3dCaller, id: number, importacao: boolean): Promise<string> {
  const d: Detalhe | null = await c.detalhe({ id }).catch(() => null);
  const passos = (importacao ? d?.importacao?.passos : d?.passos) ?? [];
  return passos.find(p => p.estado === "aguardando")?.modeloAConfirmar ?? modeloParaConfirmar(await carregarConfig());
}

export function comModeloDaTela(c: Maquete3dCaller): Maquete3dCaller {
  return new Proxy(c, {
    get(alvo, nome) {
      if (nome !== "confirmarIA" && nome !== "confirmarIAImportacao") return Reflect.get(alvo, nome);
      return async (input: { id: number; alemDoTeto?: boolean; modeloVisto?: string }) => {
        if ("modeloVisto" in input) return alvo[nome](input);
        return alvo[nome]({ ...input, modeloVisto: await modeloDaTela(alvo, input.id, nome === "confirmarIAImportacao") });
      };
    },
  });
}
