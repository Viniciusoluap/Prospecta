import { useState } from "react";
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
// EPIC-018 (stories 2.2–2.5): corretor, imóvel e obra vêm dos cadastros reais;
// o valor é sugerido pelo percentual de referência e continua editável.
const blank = () => ({
  beneficiary: "corretor",
  businessType: "venda_imovel",
  brokerId: "",
  propertyId: "",
  constructionProjectId: "",
  amount: "0",
  percent: "6",
  status: "pendente",
  dueDate: localDate(new Date()),
  notes: "",
});
export default function AdminComissoes() {
  const list = trpc.comissoes.list.useQuery();
  const brokers = trpc.comissoes.options.useQuery();
  const formOptions = trpc.comissoes.formOptions.useQuery();
  const legacy = trpc.comissoes.legacy.useQuery();
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          label="Status"
          value={status}
          onChange={setStatus}
          optional
          options={choices(COMMISSION_STATUS)}
        />
        <Choice
          label="Corretor"
          value={broker}
          onChange={setBroker}
          optional
          options={ids(brokers.data)}
        />
      </div>
      <p className="rounded border bg-white p-4">
        Pendente:{" "}
        {money(
          rows
            .filter(r => r.commission.status === "pendente")
            .reduce((sum, r) => sum + Number(r.commission.amount), 0)
        )}{" "}
        · Pago:{" "}
        {money(
          rows
            .filter(r => r.commission.status === "paga")
            .reduce((sum, r) => sum + Number(r.commission.amount), 0)
        )}
      </p>
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
            <td>{c.status}</td>
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
                    await list.refetch();
                  }}
                />
              </div>
            </td>
          </tr>
        ))}
      </Rows>
      <details className="rounded border bg-white p-4">
        <summary className="cursor-pointer font-semibold">
          Comissões legadas em quatro parcelas ({legacy.data?.length ?? "…"})
        </summary>
        <p className="my-3 text-sm">
          Histórico preservado, somente leitura. Os campos antigos guardam
          valores pagos, não datas. Não estão incluídos nos totais acima; não
          recadastre sem conciliação.
        </p>
        {legacy.error && <p role="alert">{legacy.error.message}</p>}
        <Rows
          headers={["Corretor", "Cliente", "Comissão", "Pago (parcelas)"]}
          empty={!legacy.data?.length}
        >
          {legacy.data?.map(c => (
            <tr key={c.id}>
              <td>{c.brokerName}</td>
              <td>{c.clientName}</td>
              <td>{money(c.totalCommission)}</td>
              <td>
                {money(
                  [
                    c.installment1Paid,
                    c.installment2Paid,
                    c.installment3Paid,
                    c.installment4Paid,
                  ].reduce<number>((sum, v) => sum + Number(v || 0), 0)
                )}
              </td>
            </tr>
          ))}
        </Rows>
      </details>
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
          await list.refetch();
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
