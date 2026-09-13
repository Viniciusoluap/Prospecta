import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { brokerInput } from "../../../../shared/operacional";
import {
  Choice,
  DeleteButton,
  Editor,
  Field,
  inputClass,
  OperationalPage,
  parseArray,
  Rows,
} from "./OperationalUI";
const blank = () => ({
  name: "",
  email: "",
  phone: "",
  creci: "",
  active: true,
  avatar: "",
  specialties: "",
  notes: "",
});
export default function AdminBrokerDirectory() {
  const { user } = useAuth();
  const list = trpc.corretores.list.useQuery();
  const create = trpc.corretores.create.useMutation();
  const update = trpc.corretores.update.useMutation();
  const remove = trpc.corretores.delete.useMutation();
  const [form, setForm] = useState(blank);
  const [id, setId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const rows = (list.data || []).filter(
    r =>
      `${r.name} ${r.email} ${r.creci}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || String(r.active) === status)
  );
  return (
    <OperationalPage
      title="Corretores"
      description="Cadastro, CRECI, especialidades e situação. Senhas e permissões são administradas exclusivamente em Configurações."
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
      onNew={() => {
        setForm(blank());
        setId(null);
        setOpen(true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buscar nome, e-mail ou CRECI">
          <input
            className={inputClass}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </Field>
        <Choice
          label="Situação"
          optional
          value={status}
          onChange={setStatus}
          options={[
            { value: "true", label: "Ativo" },
            { value: "false", label: "Inativo" },
          ]}
        />
      </div>
      <Rows
        headers={[
          "Corretor",
          "Contato",
          "CRECI / especialidades",
          "Situação",
          "Ações",
        ]}
        empty={!rows.length}
      >
        {rows.map(r => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td>
              {r.email}
              <br />
              {r.phone}
            </td>
            <td>
              {r.creci}
              <br />
              {parseArray<string>(r.specialties).join(", ")}
            </td>
            <td>{r.active ? "Ativo" : "Inativo"}</td>
            <td>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setId(r.id);
                    setForm({
                      name: r.name || "",
                      email: r.email || "",
                      phone: r.phone || "",
                      creci: r.creci || "",
                      active: r.active,
                      avatar: r.avatar || "",
                      specialties: parseArray<string>(r.specialties).join(", "),
                      notes: r.notes || "",
                    });
                    setOpen(true);
                  }}
                >
                  Perfil / editar
                </Button>
                {user?.role === "admin" && (
                  <DeleteButton
                    onDelete={async () => {
                      await remove.mutateAsync({ id: r.id });
                      await list.refetch();
                    }}
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
      </Rows>
      <Editor
        title={id ? "Perfil do corretor" : "Cadastrar corretor"}
        open={open}
        onClose={() => setOpen(false)}
        onSave={async () => {
          const data = brokerInput.parse({
            ...form,
            specialties: form.specialties
              .split(",")
              .map(s => s.trim())
              .filter(Boolean),
          });
          if (id) await update.mutateAsync({ id, data });
          else await create.mutateAsync(data);
          await list.refetch();
        }}
      >
        {(
          [
            ["name", "Nome"],
            ["email", "E-mail de acesso (imutável após cadastro)"],
            ["phone", "Telefone"],
            ["creci", "CRECI"],
            ["avatar", "URL HTTPS da foto"],
            ["specialties", "Especialidades, separadas por vírgula"],
            ["notes", "Observações"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              disabled={key === "email" && id !== null}
              type={
                key === "email" ? "email" : key === "avatar" ? "url" : "text"
              }
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <Choice
          label="Situação"
          value={String(form.active)}
          onChange={v => setForm(f => ({ ...f, active: v === "true" }))}
          options={[
            { value: "true", label: "Ativo" },
            { value: "false", label: "Inativo" },
          ]}
        />
        <p className="text-sm text-slate-600 sm:col-span-2">
          O cadastro não concede acesso automaticamente. Um administrador deve
          definir senha e módulos em Configurações. Excluir remove a conta;
          desativar preserva o histórico.
        </p>
      </Editor>
    </OperationalPage>
  );
}
