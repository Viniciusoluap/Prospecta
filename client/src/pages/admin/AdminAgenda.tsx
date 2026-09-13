import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  VISIT_STATUS,
  VISIT_TYPES,
  visitInput,
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
  OperationalPage,
  optionalId,
  Rows,
} from "./OperationalUI";

const blank = () => ({
  leadId: "",
  propertyId: "",
  brokerId: "",
  clientName: "",
  clientPhone: "",
  scheduledAt: localDate(new Date()),
  status: "agendada",
  visitType: "imovel",
  responsibleName: "",
  notes: "",
});
export default function AdminAgenda() {
  const list = trpc.agenda.list.useQuery();
  const options = trpc.agenda.options.useQuery();
  const create = trpc.agenda.create.useMutation();
  const update = trpc.agenda.update.useMutation();
  const remove = trpc.agenda.delete.useMutation();
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [day, setDay] = useState("");
  const [broker, setBroker] = useState("");
  const [month, setMonth] = useState(localDate(new Date()).slice(0, 7));
  const set = (key: keyof ReturnType<typeof blank>, value: string) =>
    setForm(f => ({ ...f, [key]: value }));
  const rows = (list.data || []).filter(
    ({ visit: v }) =>
      (!status || v.status === status) &&
      (!day || localDate(v.scheduledAt).startsWith(day)) &&
      (!broker || v.brokerId === Number(broker))
  );
  return (
    <OperationalPage
      title="Agenda operacional"
      description="Visitas e compromissos compartilhados com o Portal do Cliente. Horários no fuso do seu dispositivo."
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
      onNew={() => {
        setForm(blank());
        setEditing(null);
        setOpen(true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dia">
          <input
            type="date"
            className={inputClass}
            value={day}
            onChange={e => setDay(e.target.value)}
          />
        </Field>
        <Choice
          label="Status"
          value={status}
          onChange={setStatus}
          optional
          options={choices(VISIT_STATUS)}
        />
        <Choice
          label="Corretor"
          value={broker}
          onChange={setBroker}
          optional
          options={ids(options.data?.brokers)}
        />
      </div>
      <section
        className="space-y-3 rounded border bg-white p-3"
        aria-label="Calendário mensal"
      >
        <Field label="Mês do calendário">
          <input
            type="month"
            className={inputClass}
            value={month}
            onChange={e => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </Field>
        <div className="grid grid-cols-7 gap-1">
          {Array.from(
            {
              length: new Date(
                Number(month.slice(0, 4)),
                Number(month.slice(5, 7)),
                0
              ).getDate(),
            },
            (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, "0")}`;
              const count = (list.data || []).filter(
                ({ visit: v }) =>
                  localDate(v.scheduledAt).startsWith(date) &&
                  (!status || v.status === status) &&
                  (!broker || v.brokerId === Number(broker))
              ).length;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setDay(date)}
                  aria-pressed={day === date}
                  className={`min-h-14 rounded border p-1 text-xs ${day === date ? "bg-amber-100" : "bg-white"}`}
                  style={
                    i === 0
                      ? {
                          gridColumnStart:
                            new Date(`${month}-01T12:00:00`).getDay() + 1,
                        }
                      : undefined
                  }
                >
                  {i + 1}
                  <span className="block text-[#906a25]">
                    {count ? `${count} ag.` : "—"}
                  </span>
                </button>
              );
            }
          )}
        </div>
        <Button variant="outline" onClick={() => setDay("")}>
          Mostrar todos os dias na lista
        </Button>
      </section>
      <Rows
        headers={[
          "Quando",
          "Cliente / imóvel",
          "Responsável",
          "Status",
          "Ações",
        ]}
        empty={!rows.length}
      >
        {rows.map(({ visit: v, leadName, brokerName, propertyTitle }) => (
          <tr key={v.id}>
            <td>
              {dateTime(v.scheduledAt)}
              <br />
              {v.visitType}
            </td>
            <td>
              {leadName || v.clientName}
              <br />
              {propertyTitle || "Sem imóvel"}
            </td>
            <td>{brokerName || v.responsibleName || "Não atribuído"}</td>
            <td>{v.status}</td>
            <td>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(v.id);
                    setForm({
                      leadId: String(v.leadId ?? ""),
                      propertyId: String(v.propertyId ?? ""),
                      brokerId: String(v.brokerId ?? ""),
                      clientName: leadName || v.clientName,
                      clientPhone: v.clientPhone,
                      scheduledAt: localDate(v.scheduledAt),
                      status: v.status,
                      visitType: v.visitType,
                      responsibleName: v.responsibleName || "",
                      notes: v.notes,
                    });
                    setOpen(true);
                  }}
                >
                  Detalhes / editar
                </Button>
                <DeleteButton
                  onDelete={async () => {
                    await remove.mutateAsync({ id: v.id });
                    await list.refetch();
                  }}
                />
              </div>
            </td>
          </tr>
        ))}
      </Rows>
      <Editor
        title={editing ? "Editar compromisso" : "Novo compromisso"}
        open={open}
        onClose={() => setOpen(false)}
        onSave={async () => {
          const data = visitInput.parse({
            ...form,
            leadId: optionalId(form.leadId),
            propertyId: optionalId(form.propertyId),
            brokerId: optionalId(form.brokerId),
            scheduledAt: new Date(form.scheduledAt),
          });
          if (editing) await update.mutateAsync({ id: editing, data });
          else await create.mutateAsync(data);
          await list.refetch();
        }}
      >
        {options.error && (
          <p role="alert">
            Não foi possível carregar vínculos: {options.error.message}
          </p>
        )}
        <Choice
          label="Lead (opcional)"
          value={form.leadId}
          onChange={v => set("leadId", v)}
          optional
          options={ids(options.data?.leads)}
        />
        <Choice
          label="Imóvel (opcional)"
          value={form.propertyId}
          onChange={v => set("propertyId", v)}
          optional
          options={ids(options.data?.properties)}
        />
        <Choice
          label="Corretor (opcional)"
          value={form.brokerId}
          onChange={v => set("brokerId", v)}
          optional
          options={ids(options.data?.brokers)}
        />
        <Choice
          label="Tipo"
          value={form.visitType}
          onChange={v => set("visitType", v)}
          options={choices(VISIT_TYPES)}
        />
        <Choice
          label="Status"
          value={form.status}
          onChange={v => set("status", v)}
          options={choices(VISIT_STATUS)}
        />
        <Field label="Data e hora">
          <input
            required
            type="datetime-local"
            className={inputClass}
            value={form.scheduledAt}
            onChange={e => set("scheduledAt", e.target.value)}
          />
        </Field>
        {(
          [
            ["clientName", "Cliente sem lead"],
            ["clientPhone", "Telefone"],
            ["responsibleName", "Colaborador responsável"],
            ["notes", "Observações"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              value={form[key]}
              onChange={e => set(key, e.target.value)}
            />
          </Field>
        ))}
      </Editor>
    </OperationalPage>
  );
}
