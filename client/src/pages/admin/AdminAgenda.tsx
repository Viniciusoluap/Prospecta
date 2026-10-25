import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
import { rotulo } from "@shared/rotulos";
import {
  agendaDay,
  selectAgendaEntries,
  type AgendaView,
} from "@shared/agenda-unificada";

const blank = () => ({
  leadId: "",
  propertyId: "",
  brokerId: "",
  clientName: "",
  clientPhone: "",
  scheduledAt: localDate(new Date()),
  status: "agendada",
  visitType: "imovel",
  responsibleId: "",
  notes: "",
});
export default function AdminAgenda({
  embedded = false,
}: { embedded?: boolean } = {}) {
  // Portal do corretor (15/10): o vínculo de corretor/responsável vem da sessão
  // no servidor, então esses dois campos não aparecem para o corretor.
  const { user } = useAuth();
  const ehCorretor = user?.role === "corretor";
  const showOperationalRecords = Boolean(user) && !ehCorretor;
  const list = trpc.agenda.list.useQuery();
  const taskList = trpc.tasks.list.useQuery(undefined, {
    enabled: showOperationalRecords,
  });
  const cardDeadlines = trpc.agenda.cardDeadlines.useQuery(undefined, {
    enabled: showOperationalRecords,
  });
  const options = trpc.agenda.options.useQuery();
  const create = trpc.agenda.create.useMutation();
  const update = trpc.agenda.update.useMutation();
  const remove = trpc.agenda.delete.useMutation();
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [day, setDay] = useState(() => agendaDay(new Date()));
  const [view, setView] = useState<AgendaView>("data_selecionada");
  const [broker, setBroker] = useState("");
  const [month, setMonth] = useState(localDate(new Date()).slice(0, 7));
  const set = (key: keyof ReturnType<typeof blank>, value: string) =>
    setForm(f => ({ ...f, [key]: value }));
  const rows = (list.data || []).filter(
    ({ visit: v }) =>
      (!status || v.status === status) &&
      (!broker || v.brokerId === Number(broker))
  );
  const today = agendaDay(new Date());
  const entries = [
    ...rows.map(row => ({
      kind: "appointment" as const,
      day: agendaDay(row.visit.scheduledAt),
      sortAt: localDate(row.visit.scheduledAt),
      row,
    })),
    ...(showOperationalRecords ? cardDeadlines.data || [] : []).map(lead => ({
      kind: "lead" as const,
      day: agendaDay(lead.cardDueDate),
      sortAt: agendaDay(lead.cardDueDate),
      lead,
    })),
    ...(showOperationalRecords ? taskList.data || [] : []).map(task => ({
      kind: "task" as const,
      day: agendaDay(task.dueAt),
      sortAt: task.dueAt ? localDate(task.dueAt) : "",
      active: task.status !== "done" && task.status !== "cancelled",
      task,
    })),
  ];
  const visibleEntries = selectAgendaEntries(entries, view, day, today);
  const queryError =
    list.error ||
    (showOperationalRecords && (taskList.error || cardDeadlines.error)) ||
    undefined;
  return (
    <OperationalPage
      title="Agenda operacional"
      description="Vencimentos de leads, tarefas, visitas e compromissos em um só calendário. Horários no fuso do seu dispositivo."
      loading={
        list.isLoading ||
        (showOperationalRecords &&
          (taskList.isLoading || cardDeadlines.isLoading))
      }
      error={queryError}
      retry={() => {
        void list.refetch();
        if (showOperationalRecords) {
          void taskList.refetch();
          void cardDeadlines.refetch();
        }
      }}
      embedded={embedded}
      onNew={() => {
        setForm(blank());
        setEditing(null);
        setOpen(true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Choice
          label="Exibir"
          value={view}
          onChange={value => setView(value as AgendaView)}
          options={[
            { value: "data_selecionada", label: "Data selecionada" },
            ...(showOperationalRecords
              ? [
                  { value: "leads_vencidos", label: "Leads vencidos" },
                  { value: "leads_do_dia", label: "Leads do dia" },
                  { value: "leads_a_vencer", label: "Leads a vencer" },
                  { value: "todas_tarefas", label: "Todas as tarefas" },
                ]
              : []),
          ]}
        />
        <Choice
          label="Status dos agendamentos"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "Todos os status" },
            ...choices(VISIT_STATUS),
          ]}
        />
        <Choice
          label="Corretor dos agendamentos"
          value={broker}
          onChange={setBroker}
          options={[
            { value: "", label: "Todos os corretores" },
            ...ids(options.data?.brokers),
          ]}
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
              if (e.target.value) {
                setMonth(e.target.value);
                setDay(`${e.target.value}-01`);
                setView("data_selecionada");
              }
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
              const dateEntries = selectAgendaEntries(
                entries,
                "data_selecionada",
                date,
                today
              );
              const count = dateEntries.filter(
                entry => entry.kind === "appointment"
              ).length;
              const cardCount = dateEntries.filter(
                entry => entry.kind === "lead"
              ).length;
              const taskCount = dateEntries.filter(
                entry => entry.kind === "task"
              ).length;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => {
                    setDay(date);
                    setView("data_selecionada");
                  }}
                  aria-pressed={view === "data_selecionada" && day === date}
                  className={`min-h-14 rounded border p-1 text-xs ${view === "data_selecionada" && day === date ? "bg-amber-100" : "bg-white"}`}
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
                  {cardCount > 0 && (
                    <span className="block text-red-700">
                      {cardCount} lead{cardCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {taskCount > 0 && (
                    <span className="block text-blue-700">
                      {taskCount} tarefa{taskCount === 1 ? "" : "s"}
                    </span>
                  )}
                </button>
              );
            }
          )}
        </div>
      </section>
      <p className="text-sm font-medium" aria-live="polite">
        {view === "data_selecionada"
          ? `Registros de ${day.split("-").reverse().join("/")}`
          : {
              leads_vencidos: "Leads vencidos",
              leads_do_dia: "Leads do dia",
              leads_a_vencer: "Leads a vencer",
              todas_tarefas: "Todas as tarefas",
            }[view]}{" "}
        · {visibleEntries.length} registro(s)
      </p>
      <Rows
        headers={[
          "Quando",
          "Cliente / tarefa / imóvel",
          "Responsável",
          "Status",
          "Ações",
        ]}
        empty={!visibleEntries.length}
      >
        {visibleEntries.map(entry => {
          if (entry.kind === "lead")
            return (
              <tr key={`lead-${entry.lead.id}`}>
                <td>
                  {entry.day.split("-").reverse().join("/")}
                  <br />
                  Lead
                </td>
                <td>{entry.lead.name}</td>
                <td>{entry.lead.responsibleName || "Não atribuído"}</td>
                <td>
                  {entry.day < today
                    ? "Vencido"
                    : entry.day === today
                      ? "Vence hoje"
                      : "A vencer"}
                </td>
                <td>
                  <Link
                    href={`/admin/crm/${entry.lead.id}`}
                    className="underline"
                  >
                    Abrir lead
                  </Link>
                </td>
              </tr>
            );
          if (entry.kind === "task")
            return (
              <tr key={`task-${entry.task.id}`}>
                <td>
                  {entry.task.dueAt ? dateTime(entry.task.dueAt) : "Sem prazo"}
                  <br />
                  Tarefa
                </td>
                <td>{entry.task.title}</td>
                <td>{entry.task.assignedTo || "Não atribuído"}</td>
                <td>{rotulo(entry.task.status)}</td>
                <td>
                  <Link
                    href={`/admin/tarefas#tarefa-${entry.task.id}`}
                    className="underline"
                  >
                    Abrir tarefa
                  </Link>
                </td>
              </tr>
            );
          const { visit: v, leadName, brokerName, leadResponsibleName, propertyTitle } = entry.row;
          return (
            <tr key={v.id}>
              <td>
                {dateTime(v.scheduledAt)}
                <br />
                {rotulo(v.visitType)}
              </td>
              <td>
                {leadName || v.clientName}
                <br />
                {propertyTitle || "Sem imóvel"}
              </td>
              <td>{leadResponsibleName || brokerName || v.responsibleName || "Não atribuído"}</td>
              <td>{rotulo(v.status)}</td>
              <td>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(v.id);
                      // responsibleName é o nome persistido; localizamos o responsável
                      // ativo correspondente para pré-selecionar o combo (fica em
                      // branco se não houver mais um admin/colaborador ativo com esse
                      // nome — a UI então pede uma nova seleção real).
                      const currentResponsible =
                        options.data?.responsibles.find(
                          r => r.name === v.responsibleName
                        );
                      setForm({
                        leadId: String(v.leadId ?? ""),
                        propertyId: String(v.propertyId ?? ""),
                        brokerId: String(v.brokerId ?? ""),
                        clientName: leadName || v.clientName,
                        clientPhone: v.clientPhone,
                        scheduledAt: localDate(v.scheduledAt),
                        status: v.status,
                        visitType: v.visitType,
                        responsibleId: currentResponsible
                          ? String(currentResponsible.id)
                          : "",
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
          );
        })}
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
            responsibleId: optionalId(form.responsibleId),
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
        {!ehCorretor && (
          <>
            <Choice
              label="Corretor (opcional)"
              value={form.brokerId}
              onChange={v => set("brokerId", v)}
              optional
              options={ids(options.data?.brokers)}
            />
            <Choice
              label="Colaborador responsável (opcional)"
              value={form.responsibleId}
              onChange={v => set("responsibleId", v)}
              optional
              options={ids(options.data?.responsibles)}
            />
          </>
        )}
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
            ["clientName", "Nome do cliente sem lead"],
            ["clientPhone", "Telefone"],
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
