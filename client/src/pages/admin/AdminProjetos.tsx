import { AcoesExcluirCancelar } from "@/components/AcoesExcluirCancelar";
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { LinkedServiceQueue } from "./LinkedServiceQueue";
import { Button } from "@/components/ui/button";
import { PROJECT_STATUS, PROJECT_TYPE_LABELS, projectInput } from "../../../../shared/operacional";
import { mensagemValidacao } from "../../../../shared/erro-validacao";
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
  types: [] as string[],
  status: "orcamento",
  clientName: "",
  clientPhone: "",
  engineer: "",
  engineerUserId: "",
  engineerRegistration: "",
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
  const cancel = trpc.projetos.cancel.useMutation();
  const engenheiros = trpc.projetos.engenheiros.useQuery();
  const [buscaEngenheiro, setBuscaEngenheiro] = useState("");
  const [form, setForm] = useState(blank);
  const [id, setId] = useState<number | null>(null);
  // EPIC-017: registro nasce do lead; cliente/telefone vêm do CRM.
  const [linkedLeadId, setLinkedLeadId] = useState<number | null>(null);
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
    >
      <LinkedServiceQueue
        module="projetos"
        title="Projetos"
        onRecordsCreated={() => void list.refetch()}
      />
      <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
        Novos projetos nascem do CRM: no cadastro do lead, vincule o serviço
        “Projeto técnico”. O registro aparece aqui com os dados do cliente;
        complete engenheiro, tipos, valores e prazo em “Detalhes / editar”.
      </p>
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
          const pendingTechnicalData =
            !r.engineer.trim() || !parseArray<string>(r.types).length;
          return (
            <tr key={r.id}>
              <td>
                {r.name}
                {pendingTechnicalData && (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    Aguardando dados técnicos
                  </span>
                )}
                <br />
                {r.clientName}
                {r.leadId && <><br /><Link href={`/admin/crm/${r.leadId}`} className="text-sm text-[#8B631D] underline">Abrir cadastro CRM</Link></>}
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
                      setLinkedLeadId(r.leadId ?? null);
                      setForm({
                        ...r,
                        types: parseArray<string>(r.types),
                        engineerUserId: String(r.engineerUserId ?? ""),
                        engineerRegistration: r.engineerRegistration ?? "",
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
                  <AcoesExcluirCancelar
                    rotulo={r.name}
                    cancelado={r.status === "cancelado"}
                    onCancelar={async () => { await cancel.mutateAsync({ id: r.id }); await list.refetch(); }}
                    onExcluir={async () => { await remove.mutateAsync({ id: r.id }); await list.refetch(); }}
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
          // Item 07: valida antes de enviar e explica em português (nunca JSON técnico).
          if (!form.types.length) throw new Error("Selecione ao menos um tipo de projeto.");
          if (!form.engineerUserId && !form.engineer.trim()) throw new Error("Escolha o engenheiro responsável entre os colaboradores.");
          const parsed = projectInput.safeParse({
            ...form,
            leadId: optionalId(form.leadId),
            engineerUserId: optionalId(form.engineerUserId),
            engineerRegistration: form.engineerRegistration.trim() || null,
            value: Number(form.value),
            paidValue: Number(form.paidValue),
            deadline: form.deadline ? new Date(form.deadline) : null,
          });
          if (!parsed.success) throw new Error(mensagemValidacao(parsed.error.issues as never));
          const data = parsed.data;
          if (id) await update.mutateAsync({ id, data });
          else await create.mutateAsync(data);
          await list.refetch();
        }}
      >
        {(
          [
            ["name", "Nome", "text"],
            ["clientName", linkedLeadId ? "Cliente (do CRM)" : "Cliente", "text"],
            ["clientPhone", linkedLeadId ? "Telefone (do CRM)" : "Telefone", "tel"],
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
              disabled={
                linkedLeadId !== null &&
                (key === "clientName" || key === "clientPhone")
              }
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <Field label="Engenheiro responsável (colaborador)">
          <input
            className={inputClass}
            placeholder="Pesquisar colaborador"
            aria-label="Pesquisar engenheiro"
            value={buscaEngenheiro}
            onChange={e => setBuscaEngenheiro(e.target.value)}
          />
          <select
            className={`${inputClass} mt-1`}
            aria-label="Engenheiro responsável"
            value={form.engineerUserId}
            onChange={e => {
              const escolhido = engenheiros.data?.find(u => String(u.id) === e.target.value);
              setForm(f => ({ ...f, engineerUserId: e.target.value, engineer: escolhido?.name ?? f.engineer }));
            }}
          >
            <option value="">{form.engineer && !form.engineerUserId ? `Registro anterior: ${form.engineer}` : "Selecione"}</option>
            {(engenheiros.data ?? [])
              .filter(u => !buscaEngenheiro.trim() || (u.name ?? "").toLowerCase().includes(buscaEngenheiro.trim().toLowerCase()) || String(u.id) === form.engineerUserId)
              .map(u => <option key={u.id} value={u.id}>{u.name}{u.role === "admin" ? " (admin)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Habilitação técnica (CREA/CAU), se necessária">
          <input
            className={inputClass}
            value={form.engineerRegistration}
            onChange={e => setForm(f => ({ ...f, engineerRegistration: e.target.value }))}
          />
        </Field>
        <fieldset className="space-y-1 sm:col-span-2">
          <legend className="font-semibold">Tipos de projeto *</legend>
          <div className="flex flex-wrap gap-3">
            {[...Object.keys(PROJECT_TYPE_LABELS), ...form.types.filter(t => !PROJECT_TYPE_LABELS[t])].map(tipo => (
              <label key={tipo} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={form.types.includes(tipo)}
                  onChange={e => setForm(f => ({ ...f, types: e.target.checked ? [...f.types, tipo] : f.types.filter(t => t !== tipo) }))}
                />
                {PROJECT_TYPE_LABELS[tipo] ?? tipo}
              </label>
            ))}
          </div>
          {!form.types.length && <p className="text-xs text-amber-700">Obrigatório: selecione ao menos um tipo.</p>}
        </fieldset>
        <Choice
          label="Status"
          value={form.status}
          onChange={v => setForm(f => ({ ...f, status: v }))}
          options={choices(PROJECT_STATUS)}
        />
        {linkedLeadId ? (
          <Field label="Lead vinculado">
            <Link
              href={`/admin/crm/${linkedLeadId}`}
              className="block p-2 text-[#8B631D] underline"
            >
              {leads.data?.find(l => l.id === linkedLeadId)?.name ??
                `Lead #${linkedLeadId}`}
            </Link>
          </Field>
        ) : (
          <Choice
            label="Lead vinculado (registro antigo sem vínculo)"
            optional
            value={form.leadId}
            onChange={v => setForm(f => ({ ...f, leadId: v }))}
            options={ids(leads.data)}
          />
        )}
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
