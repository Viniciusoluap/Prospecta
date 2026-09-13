import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  COMMISSION_STATUS,
  commissionInput,
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
const blank = () => ({
  beneficiary: "corretor",
  businessType: "venda_imovel",
  brokerId: "",
  property: "",
  amount: "0",
  percent: "6",
  status: "pendente",
  dueDate: localDate(new Date()),
  notes: "",
});
export default function AdminComissoes() {
  const list = trpc.comissoes.list.useQuery();
  const brokers = trpc.comissoes.options.useQuery();
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
          "Imóvel",
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
              {c.businessType}
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
                      ...c,
                      brokerId: String(c.brokerId ?? ""),
                      dueDate: localDate(c.dueDate),
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
        <Choice
          label="Corretor"
          value={form.brokerId}
          onChange={v => set("brokerId", v)}
          optional
          options={ids(brokers.data)}
        />
        <Choice
          label="Tipo de negócio"
          value={form.businessType}
          onChange={v => set("businessType", v)}
          options={choices([
            "venda_imovel",
            "locacao",
            "construcao",
            "financiamento",
            "outro",
          ])}
        />
        <Choice
          label="Status (paga registra data atual)"
          value={form.status}
          onChange={v => set("status", v)}
          options={choices(COMMISSION_STATUS)}
        />
        {(
          [
            ["property", "Imóvel / negócio", "text"],
            ["amount", "Valor da comissão (R$)", "number"],
            ["percent", "Percentual de referência (%)", "number"],
            ["dueDate", "Vencimento", "datetime-local"],
            ["notes", "Observações", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              type={type}
              step={type === "number" ? "0.01" : undefined}
              min={type === "number" ? "0" : undefined}
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
