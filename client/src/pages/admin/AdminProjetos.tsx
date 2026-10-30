import { AcoesExcluir } from "@/components/AcoesExcluir";
import { uploadProjectDocument } from "@/lib/project-upload";
import { projectChecklist, reconcileProjectChecklist, type ProjectCheck } from "@shared/projeto-documentos";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { LinkedServiceQueue } from "./LinkedServiceQueue";
import { RevisoesProjeto, SolicitarRevisaoModal } from "./ProjetoRevisoes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  money,
  OperationalPage,
  optionalId,
  parseArray,
  Rows,
} from "./OperationalUI";
import { rotulo } from "@shared/rotulos";
import { diaPrazoProjeto, exibirDiaPrazoProjeto, ordenarProjetosPorPrazo, persistirDiaPrazoProjeto } from "@shared/projetos-prazo";
import { creaAoTrocarEngenheiro, formatarCrea } from "@shared/engenheiro";
import { ORGAOS_APROVACAO } from "@shared/incorporacao/aprovacao-projeto";
import { STATUS_APROVACAO_EXTERNA, rotuloStatusAprovacao } from "@shared/incorporacao/projeto-sincronizacao";
type Check = ProjectCheck;
type FileLink = { name: string; originalName?: string; version?: number; documentId?: number; url: string; itemId?: string; kind?: "editable" | "pdf"; driveFileId?: string };
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
  // Correção 07: situação de aprovação externa (só para projeto vindo da Incorporação).
  incorporationStudyId: null as number | null,
  approvalAuthority: "",
  approvalProtocol: "",
  approvalStatus: "",
  approvalNotes: "",
});
export default function AdminProjetos() {
  const list = trpc.projetos.list.useQuery();
  const leads = trpc.projetos.options.useQuery();
  const create = trpc.projetos.create.useMutation();
  const update = trpc.projetos.update.useMutation();
  const remove = trpc.projetos.delete.useMutation();
  const engenheiros = trpc.projetos.engenheiros.useQuery();
  const [buscaEngenheiro, setBuscaEngenheiro] = useState("");
  const [form, setForm] = useState(blank);
  const [id, setId] = useState<number | null>(null);
  // EPIC-017: registro nasce do lead; cliente/telefone vêm do CRM.
  const [linkedLeadId, setLinkedLeadId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<(NonNullable<typeof list.data>)[number] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [revisao, setRevisao] = useState<{ id: number; name: string; engineer: string } | null>(null);
  // Link da notificação/e-mail de revisão: /admin/projetos?projeto=<id> abre o card.
  useEffect(() => {
    const alvo = Number(new URLSearchParams(window.location.search).get("projeto"));
    if (!alvo || !list.data) return;
    const achado = list.data.find(p => p.id === alvo);
    if (achado) setDetail(achado);
  }, [list.data]);
  const rows = ordenarProjetosPorPrazo((list.data || []).filter(
    r =>
      `${r.name} ${r.clientName} ${r.engineer}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || r.status === status)
  ), r => r.deadline, r => r.pendingRevisionCount > 0 || r.status === "revisao");

  async function excluirDocumento(file: FileLink) {
    if (!id || !file.documentId) return;
    const response = await fetch(`/api/projetos/${id}/documentos`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", documentId: file.documentId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível remover o documento.");
    setForm(current => ({ ...current, files: result.files, checklist: result.checklist }));
    await list.refetch();
  }
  return (
    <OperationalPage
      title="Projetos"
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
    >
      <LinkedServiceQueue
        module="projetos"
        hideCRM
        title="Projetos"
        onRecordsCreated={() => void list.refetch()}
      />
      <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
        Novos projetos nascem do CRM: no cadastro do lead, vincule o serviço
        “Projeto técnico”. O registro aparece aqui com os dados do cliente;
        complete engenheiro, tipos e prazo em “Editar”. Processos de aprovação
        salvos em Incorporação › Projeto Aprovado também geram projetos aqui (sem lead).
      </p>
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
            <tr key={r.id} className={r.pendingRevisionCount > 0 || r.status === "revisao" ? "bg-amber-100 ring-2 ring-inset ring-amber-500" : undefined}>
              <td>
                <button type="button" className="text-left font-semibold underline" onClick={() => setDetail(r)}>{r.name}</button>
                {r.incorporationStudyId && (
                  <a className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900 underline" href={`/admin/incorporacao/${r.incorporationStudyId}`}>
                    Incorporação{r.approvalProcessId ? ` · ${rotuloStatusAprovacao(r.approvalStatus)}` : " · processo excluído"}
                  </a>
                )}
                {pendingTechnicalData && (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    Aguardando dados técnicos
                  </span>
                )}
                {(r.pendingRevisionCount > 0 || r.status === "revisao") && (
                  <span className="ml-2 rounded bg-amber-700 px-2 py-0.5 text-xs font-bold text-white">REVISÃO PRIORITÁRIA</span>
                )}
                <br />
                {r.clientName}

              </td>
              <td>{r.engineer}</td>
              <td>
                {rotulo(r.status)}
                <br />
                {exibirDiaPrazoProjeto(r.deadline)}
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
                        deadline: diaPrazoProjeto(r.deadline) ?? "",
                        leadId: String(r.leadId ?? ""),
                        checklist: projectChecklist(parseArray<string>(r.types), checks, PROJECT_TYPE_LABELS),
                        files: parseArray<FileLink>(r.files),
                        incorporationStudyId: r.approvalProcessId ? r.incorporationStudyId : null,
                        approvalAuthority: r.approvalAuthority ?? "",
                        approvalProtocol: r.approvalProtocol ?? "",
                        approvalStatus: r.approvalStatus ?? "",
                        approvalNotes: r.approvalNotes ?? "",
                      });
                      setOpen(true);
                    }}
                  >
                    Editar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRevisao({ id: r.id, name: r.name, engineer: r.engineer })}>
                    Solicitar revisão
                  </Button>
                  <AcoesExcluir
                    rotulo={r.name}
                    onExcluir={async () => { await remove.mutateAsync({ id: r.id }); await list.refetch(); }}
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </Rows>
      {detail && <Dialog open onOpenChange={aberto => { if (!aberto) setDetail(null); }}><DialogContent aria-describedby={undefined} showCloseButton={false} className="block space-y-4 bg-white text-slate-900 sm:max-w-3xl"><div className="flex justify-between gap-3"><DialogTitle className="text-xl font-bold">{detail.name}</DialogTitle><Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button></div><dl className="grid gap-3 sm:grid-cols-2">{[["Cliente",detail.clientName],["Telefone",detail.clientPhone],["Engenheiro",detail.engineer],["Habilitação técnica",detail.engineerRegistration],["Status",rotulo(detail.status)],["Prazo",exibirDiaPrazoProjeto(detail.deadline)],["Tipos",parseArray<string>(detail.types).map(v => PROJECT_TYPE_LABELS[v] ?? v).join(", ")],["Descrição",detail.description],...(detail.incorporationStudyId ? [["Órgão (aprovação externa)",detail.approvalAuthority],["Protocolo",detail.approvalProtocol],["Situação de aprovação externa",detail.approvalProcessId ? rotuloStatusAprovacao(detail.approvalStatus) : "Processo excluído na Incorporação"],["Observações do processo",detail.approvalNotes]] : [])].map(([label,value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value || "—"}</dd></div>)}</dl>{detail.incorporationStudyId && <a className="block text-sm font-semibold underline" href={`/admin/incorporacao/${detail.incorporationStudyId}`}>Abrir o estudo de Incorporação (Projeto Aprovado)</a>}<h3 className="font-semibold">Checklist</h3>{projectChecklist(parseArray<string>(detail.types),parseArray<Check>(detail.checklist),PROJECT_TYPE_LABELS).map((check,i) => <p key={check.id ?? i}>{check.done ? "✓" : "○"} {check.text}</p>)}<h3 className="font-semibold">Documentos</h3>{parseArray<FileLink>(detail.files).map(file => <a className="block underline" key={file.url} href={file.url} target="_blank" rel="noopener noreferrer">{file.kind === "pdf" ? "PDF — " : file.kind === "editable" ? "Editável — " : ""}{file.name}</a>)}<div className="flex justify-end"><Button variant="outline" onClick={() => setRevisao({ id: detail.id, name: detail.name, engineer: detail.engineer })}>Solicitar revisão</Button></div><RevisoesProjeto projectId={detail.id} /></DialogContent></Dialog>}
      {revisao && <SolicitarRevisaoModal projeto={revisao} onClose={() => setRevisao(null)} />}
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
            deadline: form.deadline ? persistirDiaPrazoProjeto(form.deadline) : null,
            // Correção 07: só projeto vinculado a processo envia a situação externa (volta ao estudo).
            ...(form.incorporationStudyId ? {
              approvalAuthority: form.approvalAuthority || null,
              approvalProtocol: form.approvalProtocol.trim() || null,
              approvalStatus: form.approvalStatus || null,
              approvalNotes: form.approvalNotes.trim() || null,
            } : { approvalAuthority: undefined, approvalProtocol: undefined, approvalStatus: undefined, approvalNotes: undefined }),
            incorporationStudyId: undefined,
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
            ["clientName", linkedLeadId ? "Cliente (do CRM)" : form.incorporationStudyId ? "Empreendimento (da Incorporação)" : "Cliente", "text"],
            ["clientPhone", linkedLeadId ? "Telefone (do CRM)" : "Telefone", "tel"],
            ["deadline", "Prazo de entrega", "date"],
          ] as const
        ).map(([key, label, type]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              type={type}
                            disabled={
                (linkedLeadId !== null || form.incorporationStudyId !== null) &&
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
              // Correção 04: o CREA do perfil Engenheiro preenche a habilitação (sem inventar quando não houver).
              setForm(f => {
                const anterior = engenheiros.data?.find(u => String(u.id) === f.engineerUserId);
                return { ...f, engineerUserId: e.target.value, engineer: escolhido?.name ?? f.engineer, engineerRegistration: creaAoTrocarEngenheiro(f.engineerRegistration, anterior, escolhido) };
              });
            }}
          >
            <option value="">{form.engineer && !form.engineerUserId ? `Registro anterior: ${form.engineer}` : "Selecione"}</option>
            {(engenheiros.data ?? [])
              .filter(u => !buscaEngenheiro.trim() || (u.name ?? "").toLowerCase().includes(buscaEngenheiro.trim().toLowerCase()) || String(u.id) === form.engineerUserId)
              .map(u => <option key={u.id} value={u.id}>{u.name}{u.role === "admin" ? " (admin)" : ""}{u.crea ? ` · ${formatarCrea(u.crea, u.creaUf)}` : ""}</option>)}
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
            {[...Object.keys(PROJECT_TYPE_LABELS), ...form.types.filter(t => t !== "projeto_completo" && !PROJECT_TYPE_LABELS[t])].map(tipo => (
              <label key={tipo} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={form.types.includes(tipo)}
                  onChange={e => setForm(f => { const types = e.target.checked ? [...f.types, tipo] : f.types.filter(t => t !== tipo); return { ...f, types, checklist: projectChecklist(types, f.checklist, PROJECT_TYPE_LABELS) }; })}
                />
                {PROJECT_TYPE_LABELS[tipo] ?? tipo}
              </label>
            ))}
          </div>
          {!form.types.length && <p className="text-xs text-amber-700">Obrigatório: selecione ao menos um tipo.</p>}
        </fieldset>
        {form.incorporationStudyId !== null && (
          <fieldset className="grid gap-3 rounded border border-sky-200 p-3 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 font-semibold">Aprovação externa (sincronizada com a Incorporação)</legend>
            <Choice label="Órgão" value={form.approvalAuthority} onChange={v => setForm(f => ({ ...f, approvalAuthority: v }))} options={ORGAOS_APROVACAO.map(o => ({ value: o, label: o }))} />
            <Field label="Protocolo">
              <input className={inputClass} value={form.approvalProtocol} onChange={e => setForm(f => ({ ...f, approvalProtocol: e.target.value }))} />
            </Field>
            <Choice label="Situação de aprovação externa" value={form.approvalStatus} onChange={v => setForm(f => ({ ...f, approvalStatus: v }))} options={STATUS_APROVACAO_EXTERNA} />
            <Field label="Observações do processo">
              <input className={inputClass} value={form.approvalNotes} onChange={e => setForm(f => ({ ...f, approvalNotes: e.target.value }))} />
            </Field>
            <p className="text-xs text-slate-600 sm:col-span-2">O status abaixo é o andamento técnico interno; a situação acima é a do órgão. Prazo e engenheiro também voltam ao processo.</p>
          </fieldset>
        )}
        <Choice
          label="Status"
          value={form.status}
          onChange={v => setForm(f => ({ ...f, status: v }))}
          options={choices(PROJECT_STATUS)}
        />
        {linkedLeadId ? (
          <Field label="Lead vinculado">
            <span>{leads.data?.find(l => l.id === linkedLeadId)?.name ?? `Lead #${linkedLeadId}`}</span>
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
            <div className="grid gap-2 rounded border p-3" key={c.id ?? i}>
              <input
                type="checkbox"
                aria-label={`Concluído: ${c.text}`}
                checked={c.done}
                disabled
                title="O item é concluído automaticamente quando PDF e editável válidos estão anexados."
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
              <div className="flex flex-wrap gap-2">
                {(["editable", "pdf"] as const).map(kind => <label key={kind} className="cursor-pointer rounded border px-3 py-2 text-sm">
                  {kind === "pdf" ? "Enviar PDF" : "Enviar arquivo editável"}
                  <input className="hidden" type="file" accept={kind === "pdf" ? ".pdf,application/pdf" : undefined} disabled={!!uploading} onChange={async e => {
                    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
                    if (!id) { toast.error("Salve o projeto antes de enviar arquivos."); return; }
                    setUploading(`${i}-${kind}`); setProgress(0);
                    try { const uploaded = await uploadProjectDocument(`/api/projetos/${id}/documentos`, file, c.id || `legacy-${i}`, kind, setProgress); setForm(f => { const files = [...f.files.filter(existing => !(existing.itemId === uploaded.itemId && existing.kind === uploaded.kind)), uploaded]; return { ...f, files, checklist: reconcileProjectChecklist(f.checklist, files.filter(doc => doc.itemId && doc.kind).map(doc => ({ itemId: doc.itemId!, kind: doc.kind! }))) }; }); await list.refetch(); toast.success("Arquivo salvo no Google Drive."); }
                    catch(error) { toast.error(error instanceof Error ? error.message : "Falha no envio."); } finally { setUploading(null); }
                  }} />
                </label>)}
              </div>
              <div className="flex gap-2 text-xs"><span className={c.pdfDone ? "font-bold text-emerald-700" : "text-slate-500"}>PDF {c.pdfDone ? "✓" : "○"}</span><span className={c.editableDone ? "font-bold text-emerald-700" : "text-slate-500"}>Editável {c.editableDone ? "✓" : "○"}</span></div>
              {form.files.filter(file => file.itemId === (c.id || `legacy-${i}`)).map(file => <div key={file.url} className="flex items-center gap-2 text-sm"><a href={file.url} target="_blank" rel="noopener noreferrer" className="underline">{file.kind === "pdf" ? "PDF" : "Editável"}: {file.name}</a>{file.originalName && <span className="text-xs text-slate-500">original: {file.originalName}</span>}{file.documentId && <Button type="button" size="sm" variant="outline" onClick={() => void excluirDocumento(file)}>Excluir</Button>}</div>)}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setForm(f => ({
                ...f,
                checklist: [...f.checklist, { id: crypto.randomUUID(), text: "", done: false }],
              }))
            }
          >
            Adicionar item
          </Button>
        </section>
        {uploading && <p role="status">Enviando ao Google Drive: {progress}%</p>}
        <p className="text-sm text-slate-600">Até 300 MB por arquivo. Salve alterações no checklist antes de enviar arquivos para itens novos.</p>
        {form.files.filter(file => !file.itemId).length > 0 && <section><h2 className="font-semibold">Documentos anteriores</h2>{form.files.filter(file => !file.itemId).map(file => <a className="block underline" key={file.url} href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a>)}</section>}
      </Editor>
    </OperationalPage>
  );
}
