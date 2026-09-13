import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const inputClass =
  "w-full rounded border border-slate-300 bg-white p-2 text-slate-900 disabled:bg-slate-100";
export const money = (value: string | number) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dateTime = (value: Date | string) =>
  new Date(value).toLocaleString("pt-BR");
export function localDate(value: Date | string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function parseArray<T>(s: string | null | undefined): T[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  optional?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        className={inputClass}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {optional && <option value="">Não vinculado</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export const choices = (items: readonly string[]) =>
  items.map(value => ({ value, label: value.replaceAll("_", " ") }));
export const ids = (items: { id: number; name: string | null }[] | undefined) =>
  (items || []).map(item => ({
    value: String(item.id),
    label: item.name || `#${item.id}`,
  }));
export const optionalId = (v: string) => (v ? Number(v) : null);

export function OperationalPage({
  title,
  description,
  children,
  loading,
  error,
  retry,
  onNew,
}: {
  title: string;
  description: string;
  children: ReactNode;
  loading?: boolean;
  error?: { message: string } | null;
  retry?: () => void;
  onNew?: () => void;
}) {
  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link href="/admin/acesso" className="text-sm underline">
          ← Central administrativa
        </Link>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-[#906a25]">{title}</h1>
            <p className="mt-2 text-slate-600">{description}</p>
          </div>
          {onNew && <Button onClick={onNew}>Novo cadastro</Button>}
        </header>
        {loading ? (
          <p role="status">Carregando…</p>
        ) : error ? (
          <div role="alert" className="rounded border border-red-300 p-4">
            {error.message}{" "}
            <Button variant="outline" onClick={retry}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}
export function Editor({
  title,
  open,
  onClose,
  onSave,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onSave: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v && !pending) {
          setError("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-white text-slate-900 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Confira os dados antes de salvar. Exclusões exigem confirmação.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async e => {
            e.preventDefault();
            setPending(true);
            setError("");
            try {
              await onSave();
              toast.success("Cadastro salvo");
              onClose();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Não foi possível salvar"
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {children}
          {error && (
            <p
              role="alert"
              className="whitespace-pre-wrap text-red-700 sm:col-span-2"
            >
              {error}
            </p>
          )}
          <div className="flex gap-3 sm:col-span-2">
            <Button disabled={pending} type="submit">
              {pending ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function DeleteButton({
  onDelete,
}: {
  onDelete: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending}
      onClick={async () => {
        if (
          !window.confirm(
            "Excluir este registro? Esta ação não pode ser desfeita pela tela."
          )
        )
          return;
        setPending(true);
        try {
          await onDelete();
          toast.success("Registro excluído");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Falha ao excluir");
        } finally {
          setPending(false);
        }
      }}
    >
      Excluir
    </Button>
  );
}
export function Rows({
  headers,
  children,
  empty,
}: {
  headers: string[];
  children: ReactNode;
  empty: boolean;
}) {
  return empty ? (
    <p className="rounded border bg-white p-8 text-center">
      Nenhum registro encontrado para estes filtros.
    </p>
  ) : (
    <div className="overflow-x-auto rounded border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100">
          <tr>
            {headers.map(h => (
              <th key={h} className="p-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:p-3 [&_tr]:border-t">{children}</tbody>
      </table>
    </div>
  );
}
