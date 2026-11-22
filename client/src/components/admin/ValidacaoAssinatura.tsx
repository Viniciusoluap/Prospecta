// Jurídico — resultado da conferência técnica automática de um documento assinado (22/11/2026).
// Fica ao lado da fase do documento ("Assinado pela empresa", "Assinado por todos"), sem substituí-la. Nunca diz que é
// validação oficial do ITI: é a conferência do próprio sistema.
type Estado = "valida" | "pendente" | "invalida";
export type ResumoValidacaoTela = {
  documentId: number; estado: Estado; motivo: string; verificadoEm: string; transitoria: boolean; proximaTentativa: string | null;
  titulares: { titular: string; documento: string; estado: Estado }[];
};

const ROTULO: Record<Estado, { texto: string; classe: string }> = {
  valida: { texto: "Assinatura válida (conferida pelo sistema)", classe: "border-green-500/60 bg-green-900/30 text-green-200" },
  pendente: { texto: "Conferência pendente", classe: "border-amber-400/60 bg-amber-900/30 text-amber-100" },
  invalida: { texto: "Assinatura inválida", classe: "border-red-500/60 bg-red-900/30 text-red-200" },
};
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });

export default function ValidacaoAssinatura({ v }: { v: ResumoValidacaoTela }) {
  const r = ROTULO[v.estado];
  return <div className={`w-full space-y-1 rounded border p-2 text-xs ${r.classe}`} data-estado={v.estado}>
    <p className="font-semibold">{r.texto}</p>
    {v.titulares.map((t, i) => <p key={i} className="break-words">Titular: {t.titular || "não identificado"}{t.documento ? ` · CPF/CNPJ ${t.documento}` : ""} · {ROTULO[t.estado].texto.replace(" (conferida pelo sistema)", "")}</p>)}
    {v.estado !== "valida" && <p>{v.motivo}</p>}
    <p className="opacity-80">Conferido em {quando(v.verificadoEm)}{v.estado === "pendente" && v.transitoria && v.proximaTentativa ? ` · nova tentativa automática a partir de ${quando(v.proximaTentativa)}` : ""}</p>
    <p className="opacity-70">Conferência técnica do próprio sistema (integridade, cadeia ICP-Brasil e LCR). Não é o relatório oficial do VALIDAR/ITI.</p>
  </div>;
}
