// EPIC-027 C1 — Message Batches API da Anthropic SIMULADA para os testes da Maquete 3D: nada sai para a rede.
// Cada lote guarda o pedido; a resposta é gerada quando o lote "termina" (depois de N consultas), com o mesmo formato
// do resultado real (mensagem com stop_reason, texto e tokens; ou sem resultado: errored, canceled, expired).
import { LoteDeOutroPedido, type ClienteLote, type CredencialIA, type MensagemIA, type PedidoIA, type RespostaIA } from "../../maquete-3d/base.js";

/** O que o lote devolve ao terminar. Um Error vira resultado "errored" (a API recusou a requisição dentro do lote). */
export type RespostaDoLote =
  | RespostaIA
  | { semResultado: "errored" | "canceled" | "expired"; erro?: string }
  | { mensagem: Partial<MensagemIA> }
  | Error;

type PedidoNoLote = PedidoIA & { credencial: CredencialIA; idPedido: string };
type Lote = { id: string; pedido: PedidoNoLote; criadoEm: string; restantes: number; cancelado: boolean; resultado?: Awaited<ReturnType<ClienteLote["consultar"]>> };

export function loteSimulado(o: {
  /** Chamado em cada envio (registra o pedido; pode esperar, para simular a demora, ou lançar: erro ao criar o lote). */
  aoEnviar?: (p: PedidoNoLote) => void | Promise<void>;
  /** A resposta da requisição, gerada quando o lote termina. */
  responder: (p: PedidoNoLote) => RespostaDoLote | Promise<RespostaDoLote>;
  /** Quantas consultas o lote fica "em andamento" antes de terminar (padrão 0: termina na primeira consulta). */
  consultasAteTerminar?: () => number;
  /** Erro em uma consulta (rede, chave revogada): devolva o erro para lançar, ou null. */
  falhaNaConsulta?: () => Error | null;
  /** Relógio da criação dos lotes (a procura por janela usa ele). Padrão: o relógio do sistema. */
  agora?: () => Date;
  /** Erro ao pedir o cancelamento (ex.: chave revogada). */
  falhaNoCancelamento?: () => Error | null;
}) {
  const lotes = new Map<string, Lote>();
  const cancelamentos: string[] = [];
  const consultas: string[] = [];
  const procuras: { desde: string; ate: string }[] = [];
  let n = 0;
  const cliente: ClienteLote = {
    async enviar(p) {
      await o.aoEnviar?.(p);
      const id = `msgbatch_simulado_${++n}`;
      lotes.set(id, { id, pedido: p, criadoEm: (o.agora?.() ?? new Date()).toISOString(), restantes: o.consultasAteTerminar?.() ?? 0, cancelado: false });
      return { id };
    },
    async consultar(id, idPedido) {
      consultas.push(id);
      const falha = o.falhaNaConsulta?.();
      if (falha) throw falha;
      const l = lotes.get(id);
      if (!l) throw Object.assign(new Error("lote não encontrado"), { status: 404 });
      if (l.resultado) return l.resultado;
      if (l.cancelado) return (l.resultado = { andamento: "terminado", resultado: { tipo: "nao_entregue", motivo: "canceled" } });
      if (l.restantes-- > 0) return { andamento: "em_andamento" };
      // Como na API real: o resultado é procurado pelo custom_id; sem ele, o lote é de outro pedido.
      if (idPedido !== l.pedido.idPedido) throw new LoteDeOutroPedido("O lote terminou, mas o resultado desta prancha não veio na resposta da IA (o lote é de outro pedido).");
      const r = await o.responder(l.pedido);
      const modelo = l.pedido.credencial.modelo ?? l.pedido.config.modeloIA;
      l.resultado = r instanceof Error ? { andamento: "terminado", resultado: { tipo: "nao_entregue", motivo: "errored", erro: r.message } }
        : "semResultado" in r ? { andamento: "terminado", resultado: { tipo: "nao_entregue", motivo: r.semResultado, ...(r.erro ? { erro: r.erro } : {}) } }
          : "mensagem" in r ? { andamento: "terminado", resultado: { tipo: "respondido", mensagem: { stopReason: "end_turn", texto: "", entrada: 0, saida: 0, modelo, ...r.mensagem } } }
            : { andamento: "terminado", resultado: { tipo: "respondido", mensagem: { stopReason: "end_turn", texto: JSON.stringify(r.json), entrada: r.entrada, saida: r.saida, modelo: r.modelo ?? modelo } } };
      return l.resultado;
    },
    async procurar(desde, ate) {
      procuras.push({ desde, ate });
      const ini = Date.parse(desde), fim = Date.parse(ate);
      return Array.from(lotes.values()).reverse()
        .filter(l => Date.parse(l.criadoEm) >= ini && Date.parse(l.criadoEm) <= fim)
        .map(l => ({ id: l.id, criadoEm: l.criadoEm }));
    },
    async cancelar(id) {
      cancelamentos.push(id);
      const falha = o.falhaNoCancelamento?.();
      if (falha) throw falha;
      const l = lotes.get(id);
      if (l && !l.resultado) l.cancelado = true;
    },
  };
  return { cliente, lotes, cancelamentos, consultas, procuras };
}
