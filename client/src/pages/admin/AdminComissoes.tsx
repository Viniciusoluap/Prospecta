import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { LinkedServiceQueue } from "./LinkedServiceQueue";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";
import {
  COMMISSION_BUSINESS_TYPE_LABELS,
  COMMISSION_BUSINESS_TYPES,
  COMMISSION_STATUS,
  commissionBusinessTypeLabel,
  commissionInput,
  suggestedCommissionAmount,
} from "../../../../shared/operacional";
import {
  Choice,
  choices,
  dateTime,
  DeleteButton,
  Editor,
  Field,
  ids,
  inputClass,
  localDate,
  money,
  OperationalPage,
  optionalId,
  Rows,
} from "./OperationalUI";
import { rotulo } from "@shared/rotulos";
// EPIC-018 (stories 2.2–2.5): corretor, imóvel e obra vêm dos cadastros reais;
// o valor é sugerido pelo percentual de referência e continua editável.
const blank = () => ({
  beneficiary: "corretor",
  businessType: "venda_imovel",
  brokerId: "",
  propertyId: "",
  constructionProjectId: "",
  amount: "0",
  percent: "5", // sugestão editável (D-02)
  status: "pendente",
  dueDate: localDate(new Date()),
  notes: "",
});
export default function AdminComissoes() {
  const list = trpc.comissoes.list.useQuery();
  const brokers = trpc.comissoes.options.useQuery();
  const formOptions = trpc.comissoes.formOptions.useQuery();
  const obras = trpc.comissoes.obras.useQuery();
  const create = trpc.comissoes.create.useMutation();
  const update = trpc.comissoes.update.useMutation();
  const remove = trpc.comissoes.delete.useMutation();
  const [form, setForm] = useState(blank);
  const [id, setId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [broker, setBroker] = useState("");
  const set = (key: keyof ReturnType<typeof blank>, value: string) =>
    setForm(f => ({ ...f, [key]: value }));
  const isObra = form.businessType === "obra";
  const targets = isObra
    ? formOptions.data?.obras ?? []
    : formOptions.data?.properties ?? [];
  const targetId = isObra ? form.constructionProjectId : form.propertyId;
  const selectedTarget = targets.find(t => String(t.id) === targetId);
  /** Recalcula o valor sugerido quando muda o imóvel/obra ou o percentual. */
  const updateAndSuggest = (patch: Partial<ReturnType<typeof blank>>) =>
    setForm(f => {
      const next = { ...f, ...patch };
      const list =
        next.businessType === "obra"
          ? formOptions.data?.obras ?? []
          : formOptions.data?.properties ?? [];
      const id =
        next.businessType === "obra"
          ? next.constructionProjectId
          : next.propertyId;
      const base = list.find(t => String(t.id) === id)?.value;
      const suggested = suggestedCommissionAmount(base, next.percent);
      return suggested === null ? next : { ...next, amount: suggested.toFixed(2) };
    });
  const rows = (list.data || []).filter(
    ({ commission: c }) =>
      (!status || c.status === status) &&
      (!broker || c.brokerId === Number(broker))
  );
  return (
    <OperationalPage
      title="Comissões"
      description="Beneficiários, negócios, vencimentos e pagamentos. Valores informados explicitamente em reais."
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
      onNew={() => {
        setId(null);
        setForm(blank());
        setOpen(true);
      }}
    >
      <LinkedServiceQueue module="comissoes" title="Comissões" />
      <ComissoesDeObras dados={obras.data} carregando={obras.isLoading} erro={obras.error?.message}
        status={status} broker={broker} setStatus={setStatus} setBroker={setBroker}
        corretores={(brokers.data ?? []).map(b => ({ value: String(b.id), label: b.name || `#${b.id}` }))}
        avulsas={rows.filter(r => !(obras.data ?? []).some(o => o.registrosManuais.some(m => m.id === r.commission.id)))} />
      <Rows
        headers={[
          "Beneficiário / negócio",
          "Imóvel / obra",
          "Valor",
          "Vencimento / pagamento",
          "Status",
          "Ações",
        ]}
        empty={!rows.length}
      >
        {rows.map(({ commission: c, brokerName }) => (
          <tr key={c.id}>
            <td>
              {c.beneficiary === "empresa"
                ? "Empresa"
                : brokerName || "Corretor excluído"}
              <br />
              {commissionBusinessTypeLabel(c.businessType)}
            </td>
            <td>{c.property}</td>
            <td>
              {money(c.amount)}
              <br />
              {c.percent}%
            </td>
            <td>
              {dateTime(c.dueDate)}
              <br />
              {c.paidAt ? `Pago: ${dateTime(c.paidAt)}` : "Não pago"}
            </td>
            <td>{rotulo(c.status)}</td>
            <td>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setId(c.id);
                    setForm({
                      beneficiary: c.beneficiary,
                      businessType:
                        c.businessType === "construcao" ? "obra" : c.businessType,
                      brokerId: String(c.brokerId ?? ""),
                      propertyId: String(c.propertyId ?? ""),
                      constructionProjectId: String(c.constructionProjectId ?? ""),
                      amount: String(c.amount),
                      percent: String(c.percent),
                      status: c.status,
                      dueDate: localDate(c.dueDate),
                      notes: c.notes,
                    });
                    setOpen(true);
                  }}
                >
                  Editar / pagar
                </Button>
                <DeleteButton
                  onDelete={async () => {
                    await remove.mutateAsync({ id: c.id });
                    await Promise.all([list.refetch(), obras.refetch()]);
                  }}
                />
              </div>
            </td>
          </tr>
        ))}
      </Rows>
      <Editor
        title={id ? "Editar comissão" : "Nova comissão"}
        open={open}
        onClose={() => setOpen(false)}
        onSave={async () => {
          const data = commissionInput.parse({
            ...form,
            brokerId:
              form.beneficiary === "empresa" ? null : optionalId(form.brokerId),
            propertyId: isObra ? null : optionalId(form.propertyId),
            constructionProjectId: isObra
              ? optionalId(form.constructionProjectId)
              : null,
            amount: Number(form.amount),
            percent: Number(form.percent),
            dueDate: new Date(form.dueDate),
          });
          if (id) await update.mutateAsync({ id, data });
          else await create.mutateAsync(data);
          await Promise.all([list.refetch(), obras.refetch()]);
        }}
      >
        <Choice
          label="Beneficiário"
          value={form.beneficiary}
          onChange={v => set("beneficiary", v)}
          options={choices(["corretor", "empresa"])}
        />
        {form.beneficiary === "corretor" && (
          <Field label="Corretor *">
            <select
              className={inputClass}
              required
              value={form.brokerId}
              onChange={e => set("brokerId", e.target.value)}
            >
              <option value="">
                {formOptions.isLoading
                  ? "Carregando corretores…"
                  : formOptions.data?.brokers.length
                    ? "Selecione o corretor"
                    : "Nenhum corretor cadastrado em Corretores"}
              </option>
              {formOptions.data?.brokers.map(b => (
                <option key={b.id} value={String(b.id)}>
                  {(b.name || `#${b.id}`) + (b.active ? "" : " (inativo)")}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Choice
          label="Tipo de negócio"
          value={form.businessType}
          onChange={v => updateAndSuggest({ businessType: v })}
          options={COMMISSION_BUSINESS_TYPES.map(value => ({
            value,
            label: COMMISSION_BUSINESS_TYPE_LABELS[value],
          }))}
        />
        <Choice
          label="Status (paga registra data atual)"
          value={form.status}
          onChange={v => set("status", v)}
          options={choices(COMMISSION_STATUS)}
        />
        <Field label={isObra ? "Obra *" : "Imóvel / negócio *"}>
          <select
            className={inputClass}
            required
            value={targetId}
            onChange={e =>
              updateAndSuggest(
                isObra
                  ? { constructionProjectId: e.target.value }
                  : { propertyId: e.target.value }
              )
            }
          >
            <option value="">
              {formOptions.isLoading
                ? "Carregando…"
                : targets.length
                  ? isObra
                    ? "Selecione a obra cadastrada"
                    : "Selecione o imóvel cadastrado"
                  : isObra
                    ? "Nenhuma obra cadastrada"
                    : "Nenhum imóvel cadastrado"}
            </option>
            {targets.map(t => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
                {t.value ? ` — ${money(t.value)}` : ""}
              </option>
            ))}
          </select>
          {selectedTarget && !selectedTarget.value && (
            <span className="block text-xs font-normal text-amber-700">
              {isObra
                ? "Obra sem valor de contrato/VGV cadastrado: informe o valor manualmente."
                : "Imóvel sem preço cadastrado: informe o valor manualmente."}
            </span>
          )}
        </Field>
        <Field label="Percentual de referência (%)">
          <PercentInput
            className={inputClass}
            required
            value={Number(form.percent) || 0}
            onChange={v => updateAndSuggest({ percent: String(v) })}
          />
        </Field>
        <Field label="Valor da comissão (R$)">
          <CurrencyInput
            className={inputClass}
            required
            value={Number(form.amount) || 0}
            onChange={v => set("amount", String(v))}
          />
          <span className="block text-xs font-normal text-slate-600">
            Calculado pelo percentual sobre o valor do {isObra ? "contrato da obra" : "imóvel"}; pode ser ajustado.
          </span>
        </Field>
        {(
          [
            ["dueDate", "Vencimento", "datetime-local"],
            ["notes", "Observações", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              type={type}
              required={key !== "notes"}
              value={form[key]}
              onChange={e => set(key, e.target.value)}
            />
          </Field>
        ))}
      </Editor>
    </OperationalPage>
  );
}

// EPIC-020 Lote 3 (item 32): comissões nascidas das obras com corretor no CRM.
// Comissão = VGV × % / 100; pagamentos vêm do financeiro da obra (BPO).
const STATUS_OBRA: Record<string, { label: string; cls: string }> = {
  dados_incompletos: { label: "Dados incompletos", cls: "bg-amber-100 text-amber-900" },
  pendente: { label: "Pendente", cls: "bg-slate-100 text-slate-800" },
  parcial: { label: "Paga parcialmente", cls: "bg-blue-100 text-blue-900" },
  paga: { label: "Paga", cls: "bg-green-100 text-green-900" },
};
type LinhaObra = inferRouterOutputs<AppRouter>["comissoes"]["obras"][number];
function ComissoesDeObras({ dados, carregando, erro, status, broker, setStatus, setBroker, corretores, avulsas }: {
  dados?: LinhaObra[]; carregando: boolean; erro?: string;
  status: string; broker: string; setStatus: (v: string) => void; setBroker: (v: string) => void;
  corretores: { value: string; label: string }[];
  avulsas: inferRouterOutputs<AppRouter>["comissoes"]["list"];
}) {
  const linhas = (dados ?? []).filter(l => (!status || l.calculo.status === status) && (!broker || String(l.corretorId) === broker));
  const pendente = linhas.reduce((total, l) => total + (l.calculo.saldoCentavos ?? 0), 0) / 100
    + avulsas.filter(r => ["pendente", "aprovada"].includes(r.commission.status)).reduce((total, r) => total + Number(r.commission.amount), 0);
  const pago = linhas.reduce((total, l) => total + l.calculo.pagoCentavos, 0) / 100
    + avulsas.filter(r => r.commission.status === "paga").reduce((total, r) => total + Number(r.commission.amount), 0);
  const incompletas = (dados ?? []).filter(l => l.calculo.status === "dados_incompletos").length;
  const reais = (c: number | null) => (c === null ? "—" : money(c / 100));
  return (
    <section className="space-y-3 rounded border bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Comissões de obras (automáticas pelo CRM)</h2>
          <p className="text-sm text-slate-600">
            Toda obra cujo lead tem corretor aparece aqui. Comissão = VGV × % / 100, com o percentual da obra ou o
            padrão do corretor. Pagamentos: lançamentos de categoria “Comissão” no financeiro da obra.
            {incompletas > 0 && ` ${incompletas} obra(s) com dados incompletos.`}
          </p>
        </div>

      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status"><select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries({ ...Object.fromEntries(COMMISSION_STATUS.map(value => [value, { label: rotulo(value) }])), ...STATUS_OBRA }).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
        </select></Field>
        <Field label="Corretor"><select className={inputClass} value={broker} onChange={e => setBroker(e.target.value)}>
          <option value="">Todos os corretores</option>{corretores.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></Field>
      </div>
      <p className="rounded border bg-slate-50 p-4 text-slate-900">Pendente: {money(pendente)} · Pago: {money(pago)}</p>
      <p className="text-xs text-slate-600">Totais dos resultados filtrados, sem duplicar os registros manuais vinculados às obras.</p>
      {erro && <p role="alert">{erro}</p>}
      {carregando ? <p className="text-sm">Carregando…</p> : (
        <Rows headers={["Corretor / cliente", "Obra", "VGV · %", "Comissão", "Pago · saldo", "Situação"]} empty={!linhas.length}>
          {linhas.map(l => (
            <tr key={l.obraId}>
              <td>{l.corretor}<br /><span className="text-xs text-slate-500">{l.cliente}</span></td>
              <td><a className="underline" href={`/admin/obras/editar/${l.obraId}`}>{l.obra}</a></td>
              <td>
                {l.vgv ? money(Number(l.vgv)) : "VGV não informado"}<br />
                <span className="text-xs">{l.calculo.percentual ? `${Number(l.calculo.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}% (${l.calculo.fontePercentual === "obra" ? "da obra" : "padrão do corretor"})` : "sem percentual"}</span>
              </td>
              <td>{reais(l.calculo.valorCentavos)}</td>
              <td>{reais(l.calculo.pagoCentavos)}<br /><span className="text-xs">saldo {reais(l.calculo.saldoCentavos)}</span></td>
              <td>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_OBRA[l.calculo.status].cls}`}>{STATUS_OBRA[l.calculo.status].label}</span>
                {[...l.calculo.pendencias, ...l.alertas].map(t => <p key={t} className="mt-1 text-xs text-amber-800">{t}</p>)}
                {l.registrosManuais.map(m => (
                  <p key={m.id} className="mt-1 text-xs text-slate-600">
                    Comissão manual #{m.id}: {money(m.amount)} · {Number(m.percent).toLocaleString("pt-BR")}% · {rotulo(m.status)}
                  </p>
                ))}
              </td>
            </tr>
          ))}
        </Rows>
      )}
    </section>
  );
}
