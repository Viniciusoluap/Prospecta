// Maquete 3D (EPIC-024 S-03, QA rodada 2, N6) — rótulo do botão que continua a leitura, conforme o motivo da espera.
// Função pura (testada no servidor): "depois de cadastrar a chave" só quando o que falta é a chave da IA.

export type MotivoEspera = "chave" | "teto" | "confirmacao" | null | undefined;

export function rotuloContinuarLeitura(estadoDoProximo: string | null | undefined, motivo: MotivoEspera): string {
  if (estadoDoProximo === "erro") return "Tentar de novo este passo";
  if (estadoDoProximo === "aguardando" && motivo === "chave") return "Continuar leitura (depois de cadastrar a chave)";
  return "Continuar leitura";
}

/**
 * QA S-11 r2, achado 2: o botão de confirmar o custo diz com que modelo a IA vai ler (o mesmo que a tela devolve ao
 * confirmar). Sem o modelo (passo parado antes desta versão), o botão fica como era e o servidor pede para recarregar.
 */
export function rotuloConfirmarIA(modelo: string | null | undefined, rotulo: string): string {
  return modelo ? `${rotulo} — modelo ${modelo}` : rotulo;
}

/** Pergunta de "Autorizar além do teto", com o modelo que será usado. */
export function perguntaAlemDoTeto(pendentes: number, teto: number | null | undefined, modelo: string | null | undefined): string {
  return `Autorizar a leitura paga de mais ${pendentes} prancha(s) pela IA${modelo ? `, com o modelo ${modelo}` : ""}, além do teto de ${teto ?? "—"} desta maquete?`;
}

// ── EPIC-027 C1: andamento da leitura em segundo plano (funções puras, testadas no servidor) ──

/** O mínimo de um passo para mostrar o andamento (o que o servidor manda em `passos`). */
export type PassoDoAndamento = {
  chave: string; rotulo: string; tipo: string; estado: string;
  /** O envio não confirmou o lote e o servidor o procura na Anthropic (QA C1, achados 1 e 2). */
  procurandoLote?: boolean;
  lote: { situacao: "em_andamento" | "cancelando"; enviadoEm: string } | null;
  enviandoDesde?: string | null;
};

/**
 * Situação da prancha na IA em linguagem simples. A Anthropic não informa se a requisição ainda está na fila ou já
 * está sendo lida (os dois são "em andamento"): a tela diz os dois, sem inventar.
 */
export function rotuloDoLote(p: Pick<PassoDoAndamento, "estado" | "lote" | "enviandoDesde" | "procurandoLote">): string | null {
  if (p.estado === "feito") return "Lida";
  if (p.estado !== "executando") return null;
  if (!p.lote) return p.procurandoLote ? "Conferindo na IA se a prancha chegou…" : "Enviando à IA…";
  return p.lote.situacao === "cancelando" ? "Cancelando a leitura na IA…" : "Enviada à IA — na fila ou sendo lida";
}

/** Tempo decorrido curto: "8 s", "3 min 05 s", "1 h 02 min". */
export function tempoDecorrido(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60), h = Math.floor(min / 60);
  if (h < 1) return `${min} min ${String(s % 60).padStart(2, "0")} s`;
  return `${h} h ${String(min % 60).padStart(2, "0")} min`;
}

/**
 * Onde a leitura está: o passo atual (o primeiro que não terminou), "passo X de Y" e, quando o atual é uma prancha
 * pela IA, "prancha X de Y" entre as pranchas que vão para a IA. `desde`: quando a IA recebeu (ou começou a receber)
 * a prancha atual, para o tempo decorrido. Nada de porcentagem: a API não informa quanto da prancha já foi lido.
 */
export function andamentoDaLeitura(passos: PassoDoAndamento[]): {
  atual: PassoDoAndamento | null; passo: { x: number; y: number }; pranchaIA: { x: number; y: number } | null; situacao: string | null; desde: string | null;
} {
  const i = passos.findIndex(p => p.estado !== "feito");
  const atual = i < 0 ? null : passos[i];
  const ia = passos.filter(p => p.tipo === "prancha_ia");
  const pranchaIA = atual?.tipo === "prancha_ia" ? { x: ia.indexOf(atual) + 1, y: ia.length } : null;
  return {
    atual, passo: { x: i < 0 ? passos.length : i + 1, y: passos.length }, pranchaIA,
    situacao: atual ? rotuloDoLote(atual) : null,
    desde: atual?.lote?.enviadoEm ?? atual?.enviandoDesde ?? null,
  };
}

/** Motivos de "aguardando" em que a tela não para: consulta de novo daqui a alguns segundos. */
export const ESPERA_COM_CONSULTA = ["lote", "executando"] as const;
export const INTERVALO_CONSULTA_MS = 6_000;
export const consultaDeNovo = (motivo: string | null | undefined) => (ESPERA_COM_CONSULTA as readonly string[]).includes(motivo ?? "");
