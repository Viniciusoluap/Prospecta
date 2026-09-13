import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { PROJECT_STATUS, projectInput } from "../../../../shared/operacional";
import {
  Choice,
  choices,
  DeleteButton,
  Editor,
  Field,
  ids,
  inputClass,
  localDate,
  money,
  OperationalPage,
  optionalId,
  parseArray,
  Rows,
} from "./OperationalUI";
type Check = { text: string; done: boolean };
type FileLink = { name: string; url: string };
const blank = () => ({
  name: "",
  types: "projeto_arquitetonico",
  status: "orcamento",
  clientName: "",
  clientPhone: "",
  engineer: "",
  value: "0",
  paidValue: "0",
  deadline: "",
  leadId: "",
  description: "",
  checklist: [] as Check[],
  files: [] as FileLink[],
});
export default function AdminProjetos() {
  const list = trpc.projetos.list.useQuery();
  const leads = trpc.projetos.options.useQuery();
  const create = trpc.projetos.create.useMutation();
  const update = trpc.projetos.update.useMutation();
  const remove = trpc.projetos.delete.useMutation();
  const [form, setForm] = useState(blank);
  const [id, setId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const rows = (list.data || []).filter(
    r =>
      `${r.name} ${r.clientName} ${r.engineer}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || r.status === status)
  );
  return (
    <OperationalPage
      title="Projetos"
      description="Ciclo de engenharia: orçamento, execução, revisão, aprovação e conclusão, com checklist e documentos."
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
      onNew={() => {
        setId(null);
        setForm(blank());
        setOpen(true);
      }}
    >
      <nav className="flex flex-wrap gap-4 text-sm underline">
        <Link href="/admin/orcamentos">Solicitações de orçamento</Link>
        <Link href="/admin/incorporacao">Estudos de incorporação</Link>
        <Link href="/admin/obras">Obras</Link>
      </nav>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buscar projeto, cliente ou engenheiro">
          <input
            className={inputClass}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </Field>
        <Choice
          label="Status"
          optional
          value={status}
          onChange={setStatus}
          options={choices(PROJECT_STATUS)}
        />
      </div>
      <Rows
        headers={[
          "Projeto / cliente",
          "Engenheiro",
          "Status / prazo",
          "Valores",
          "Checklist",
          "Ações",
        ]}
        empty={!rows.length}
      >
        {rows.map(r => {
          const checks = parseArray<Check>(r.checklist);
          return (
            <tr key={r.id}>
              <td>
                {r.name}
                <br />
                {r.clientName}
              </td>
              <td>{r.engineer}</td>
              <td>
                {r.status}
                <br />
                {r.deadline
                  ? new Date(r.deadline).toLocaleDateString("pt-BR")
                  : "Sem prazo"}
              </td>
              <td>
                {money(r.value)}
                <br />
                Pago: {money(r.paidValue)}
              </td>
              <td>
                {checks.filter(c => c.done).length}/{checks.length}
              </td>
              <td>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setId(r.id);
                      setForm({
                        ...r,
                        types: parseArray<string>(r.types).join(", "),
                        deadline: localDate(r.deadline),
                        leadId: String(r.leadId ?? ""),
                        checklist: checks,
                        files: parseArray<FileLink>(r.files),
                      });
                      setOpen(true);
                    }}
                  >
                    Detalhes / editar
                  </Button>
                  <DeleteButton
                    onDelete={async () => {
                      await remove.mutateAsync({ id: r.id });
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
        title={id ? "Detalhes do projeto" : "Novo projeto"}
        open={open}
        onClose={() => setOpen(false)}
        onSave={async () => {
          const data = projectInput.parse({
            ...form,
            types: form.types
              .split(",")
              .map(s => s.trim())
              .filter(Boolean),
            leadId: optionalId(form.leadId),
            value: Number(form.value),
            paidValue: Number(form.paidValue),
            deadline: form.deadline ? new Date(form.deadline) : null,
          });
          if (id) await update.mutateAsync({ id, data });
          else await create.mutateAsync(data);
          await list.refetch();
        }}
      >
        {(
          [
            ["name", "Nome", "text"],
            ["types", "Tipos separados por vírgula", "text"],
            ["clientName", "Cliente", "text"],
            ["clientPhone", "Telefone", "tel"],
            ["engineer", "Engenheiro responsável", "text"],
            ["value", "Valor do projeto (R$)", "number"],
            ["paidValue", "Valor pago (R$)", "number"],
            ["deadline", "Prazo de entrega", "datetime-local"],
          ] as const
        ).map(([key, label, type]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              type={type}
              step={type === "number" ? "0.01" : undefined}
              min={type === "number" ? "0" : undefined}
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <Choice
          label="Status"
          value={form.status}
          onChange={v => setForm(f => ({ ...f, status: v }))}
          options={choices(PROJECT_STATUS)}
        />
        <Choice
          label="Lead vinculado"
          optional
          value={form.leadId}
          onChange={v => setForm(f => ({ ...f, leadId: v }))}
          options={ids(leads.data)}
        />
        <Field label="Descrição">
          <textarea
            className={inputClass}
            value={form.description}
            onChange={e =>
              setForm(f => ({ ...f, description: e.target.value }))
            }
          />
        </Field>
        <section className="space-y-3 sm:col-span-2">
          <h2 className="font-semibold">Checklist</h2>
          {form.checklist.map((c, i) => (
            <div className="flex items-center gap-2" key={i}>
              <input
                type="checkbox"
                aria-label={`Concluído: ${c.text}`}
                checked={c.done}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    checklist: f.checklist.map((v, n) =>
                      n === i ? { ...v, done: e.target.checked } : v
                    ),
                  }))
                }
              />
              <input
                aria-label={`Item ${i + 1}`}
                className={inputClass}
                value={c.text}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    checklist: f.checklist.map((v, n) =>
                      n === i ? { ...v, text: e.target.value } : v
                    ),
                  }))
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm(f => ({
                    ...f,
                    checklist: f.checklist.filter((_, n) => n !== i),
                  }))
                }
              >
                Remover
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setForm(f => ({
                ...f,
                checklist: [...f.checklist, { text: "", done: false }],
              }))
            }
          >
            Adicionar item
          </Button>
        </section>
        <section className="space-y-3 sm:col-span-2">
          <h2 className="font-semibold">Documentos — links HTTPS</h2>
          <p className="text-sm text-slate-600">
            Use links com acesso restrito aos responsáveis. Os documentos não
            são publicados no site.
          </p>
          {form.files.map((file, i) => (
            <div className="grid gap-2 rounded border p-3" key={i}>
              <Field label="Nome do documento">
                <input
                  className={inputClass}
                  value={file.name}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      files: f.files.map((v, n) =>
                        n === i ? { ...v, name: e.target.value } : v
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Link HTTPS">
                <input
                  className={inputClass}
                  type="url"
                  value={file.url}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      files: f.files.map((v, n) =>
                        n === i ? { ...v, url: e.target.value } : v
                      ),
                    }))
                  }
                />
              </Field>
              {file.url.startsWith("https://") && (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Abrir documento
                </a>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm(f => ({
                    ...f,
                    files: f.files.filter((_, n) => n !== i),
                  }))
                }
              >
                Remover link
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setForm(f => ({
                ...f,
                files: [...f.files, { name: "", url: "" }],
              }))
            }
          >
            Adicionar documento
          </Button>
        </section>
      </Editor>
    </OperationalPage>
  );
}
