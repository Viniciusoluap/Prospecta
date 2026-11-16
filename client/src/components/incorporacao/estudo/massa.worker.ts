// Web Worker do motor de parcelamento: o cálculo roda fora da thread da interface
// (a tela não trava em glebas grandes) e informa o progresso real de cada etapa.
import { gerarEstudoMassa, type EntradaGleba, type ParametrosMassa, type ViaEntorno } from "@shared/incorporacao/massa";

interface Pedido { id: number; entrada: EntradaGleba; centro: [number, number]; params: ParametrosMassa; viasEntorno: ViaEntorno[] | null }

self.onmessage = (e: MessageEvent<Pedido>) => {
  const { id, entrada, centro, params, viasEntorno } = e.data;
  let ultimo = 0;
  try {
    const r = gerarEstudoMassa(entrada, centro, params, {
      viasEntorno,
      onProgress: (fracao, etapa) => {
        const agora = Date.now();
        if (agora - ultimo < 80 && fracao < 1) return; // limita mensagens
        ultimo = agora;
        (self as unknown as Worker).postMessage({ id, tipo: "progresso", fracao, etapa });
      },
    });
    (self as unknown as Worker).postMessage({ id, tipo: "ok", resultado: r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, tipo: "erro", mensagem: err instanceof Error ? err.message : String(err) });
  }
};
