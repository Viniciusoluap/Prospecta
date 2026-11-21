// EPIC-026 C2 — registro do recebimento do WhatsApp da empresa, SEM CONTEÚDO (regra do dono de 20/11/2026: nenhuma mensagem é
// descartada sem registro visível). Cada aviso que chega ao webhook da empresa (depois do segredo e da instância conferidos) soma 1
// em "chegou" por item e, ao terminar, 1 no destino de cada item (Central, Dolores, grupo, ignorado e por quê…). Contador por hora
// (UTC) × evento × destino × motivo × forma do endereço: o tamanho não cresce com spam; 7 dias de retenção.
// Nunca guarda texto, número, nome nem o endereço em si — só a FORMA ("numero", "lid", "grupo"…).
// Se o processamento parar no meio (prazo da Vercel), "chegou" fica maior que a soma dos destinos: a tela mostra a diferença.
import { gte, lt, sql } from "drizzle-orm";
import { whatsappRecebimentoContagem } from "../drizzle/schema-whatsapp-atendimento.js";
import { getDb } from "./db.js";

export type DestinoDoItem =
  | "chegou" | "central" | "central_sem_numero" | "dolores" | "grupo" | "propria" | "ignorado" | "repetida" | "erro" | "evento"
  // EPIC-027 C4: o desfecho de cada marcação (ou possível marcação) da Dolores num grupo. NÃO é destino de item (o item do grupo já
  // contou em "grupo"): fica fora da conta de "sem desfecho" e aparece no quadro das marcações.
  | "marcacao";

/** Hora UTC "2026-11-20T14" (a chave do contador). */
export const horaDoRegistro = (d: Date) => d.toISOString().slice(0, 13);

const RETENCAO_MS = 7 * 24 * 60 * 60_000;
const LIMPEZA_A_CADA_MS = 60 * 60_000;
let ultimaLimpeza = 0;
/** Só para testes: a próxima gravação volta a limpar. */
export function esquecerLimpezaDoRecebimento() { ultimaLimpeza = 0; }

/** Motivo e forma: só letras, dígitos, hífen e sublinhado, curtos (nunca vem conteúdo daqui; isto só garante). */
const curto = (v: string, max: number) => v.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, max);

/** Os registros de UM aviso, juntados na memória e gravados de uma vez (uma instrução). */
export class RegistroDoAviso {
  private readonly contas = new Map<string, { destino: DestinoDoItem; motivo: string; endereco: string; total: number }>();
  constructor(private readonly evento: string, private readonly agora: Date) {}

  item(destino: DestinoDoItem, motivo = "", endereco = "") {
    const m = curto(motivo, 60), e = curto(endereco, 12);
    const k = `${destino}\u0000${m}\u0000${e}`;
    const c = this.contas.get(k);
    if (c) c.total++;
    else this.contas.set(k, { destino, motivo: m, endereco: e, total: 1 });
  }

  get vazio() { return this.contas.size === 0; }

  /** Grava (soma) e esquece o que foi gravado. Nunca lança: o diagnóstico não derruba o aviso. */
  async gravar(): Promise<void> {
    if (!this.contas.size) return;
    const hora = horaDoRegistro(this.agora);
    const linhas = Array.from(this.contas.values()).map(c => ({ hora, evento: curto(this.evento, 40) || "(sem evento)", ...c }));
    this.contas.clear();
    const db = getDb();
    try {
      await db.insert(whatsappRecebimentoContagem).values(linhas).onConflictDoUpdate({
        target: [whatsappRecebimentoContagem.hora, whatsappRecebimentoContagem.evento, whatsappRecebimentoContagem.destino, whatsappRecebimentoContagem.motivo, whatsappRecebimentoContagem.endereco],
        set: { total: sql`${whatsappRecebimentoContagem.total} + excluded.total`, ultimaEm: sql`now()` },
      });
    } catch (e) {
      console.error("[whatsapp/recebimento] falha ao gravar o registro do recebimento", e instanceof Error ? e.message.slice(0, 200) : "erro");
      return;
    }
    const agoraMs = this.agora.getTime();
    if (Math.abs(agoraMs - ultimaLimpeza) >= LIMPEZA_A_CADA_MS) {
      ultimaLimpeza = agoraMs;
      await db.delete(whatsappRecebimentoContagem).where(lt(whatsappRecebimentoContagem.hora, horaDoRegistro(new Date(agoraMs - RETENCAO_MS))))
        .catch(() => undefined);
    }
  }
}

export type ResumoRecebimento = {
  desde: string;
  /** Itens que chegaram ao webhook (mensagens, ligações, avisos de grupo e de conexão). */
  chegaram: number;
  /** Mensagens (itens de "messages.upsert") que chegaram, por forma do endereço. */
  mensagens: { total: number; porEndereco: Record<string, number> };
  central: number;
  centralSemNumero: number;
  dolores: number;
  grupos: number;
  enviadasPelaEmpresa: number;
  repetidas: number;
  erros: number;
  outrosEventos: number;
  /** "chegou" menos a soma dos destinos (processamento interrompido no meio). */
  semDesfecho: number;
  ignoradas: Array<{ motivo: string; endereco: string; evento: string; total: number }>;
};

/** O resumo das últimas `horas` (padrão 24) contadas a partir de `agora` (relógio de quem chama). Só leitura. */
export async function resumoDoRecebimento(agora: Date, horas = 24): Promise<ResumoRecebimento> {
  const desde = horaDoRegistro(new Date(agora.getTime() - (horas - 1) * 60 * 60_000));
  const linhas = await getDb().select().from(whatsappRecebimentoContagem).where(gte(whatsappRecebimentoContagem.hora, desde));
  const soma = (f: (l: (typeof linhas)[number]) => boolean) => linhas.filter(f).reduce((s, l) => s + l.total, 0);
  const porEndereco: Record<string, number> = {};
  for (const l of linhas) if (l.destino === "chegou" && l.evento === "messages.upsert") porEndereco[l.endereco || "?"] = (porEndereco[l.endereco || "?"] ?? 0) + l.total;
  const chegaram = soma(l => l.destino === "chegou");
  const desfechos = soma(l => l.destino !== "chegou" && l.destino !== "marcacao");
  const ignoradas = new Map<string, { motivo: string; endereco: string; evento: string; total: number }>();
  for (const l of linhas) {
    if (l.destino !== "ignorado") continue;
    const k = `${l.evento}\u0000${l.motivo}\u0000${l.endereco}`;
    const g = ignoradas.get(k) ?? { motivo: l.motivo, endereco: l.endereco, evento: l.evento, total: 0 };
    g.total += l.total;
    ignoradas.set(k, g);
  }
  return {
    desde, chegaram,
    mensagens: { total: soma(l => l.destino === "chegou" && l.evento === "messages.upsert"), porEndereco },
    central: soma(l => l.destino === "central"), centralSemNumero: soma(l => l.destino === "central_sem_numero"),
    dolores: soma(l => l.destino === "dolores"), grupos: soma(l => l.destino === "grupo"), enviadasPelaEmpresa: soma(l => l.destino === "propria"),
    repetidas: soma(l => l.destino === "repetida"), erros: soma(l => l.destino === "erro"), outrosEventos: soma(l => l.destino === "evento"),
    semDesfecho: Math.max(0, chegaram - desfechos),
    ignoradas: Array.from(ignoradas.values()).sort((a, b) => b.total - a.total).slice(0, 30),
  };
}

/**
 * EPIC-027 C4 — o que aconteceu com as marcações da Dolores nos grupos nas últimas `horas` (padrão 24): por desfecho (a chave de
 * `tratarMarcacao`, com o detalhe depois do ponto), sem texto, número nem grupo. Inclui o que não chega a virar linha em
 * dolores_marcacoes (menção por @lid desconhecido, conexão não confirmada, grupo fora da lista, atrasada, reentrega).
 */
export async function desfechosDasMarcacoes(agora: Date, horas = 24): Promise<Array<{ chave: string; total: number }>> {
  const desde = horaDoRegistro(new Date(agora.getTime() - (horas - 1) * 60 * 60_000));
  const linhas = await getDb().select().from(whatsappRecebimentoContagem).where(gte(whatsappRecebimentoContagem.hora, desde));
  const por = new Map<string, number>();
  for (const l of linhas) if (l.destino === "marcacao") por.set(l.motivo, (por.get(l.motivo) ?? 0) + l.total);
  return Array.from(por, ([chave, total]) => ({ chave, total })).sort((a, b) => b.total - a.total).slice(0, 30);
}
