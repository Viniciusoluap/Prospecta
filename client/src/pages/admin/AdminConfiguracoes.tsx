import { FormEvent, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, KeyRound, Plus, Settings, Shield, Trash2, UserCog } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ADMIN_MODULE_LABELS, ADMIN_MODULES, AdminModule, parsePermissions } from "../../../../shared/admin-permissions";

const ROLES = ["admin", "corretor", "colaborador", "cliente"] as const;

export default function AdminConfiguracoes() {
  const utils = trpc.useUtils();
  const { data: usuarios = [], isLoading } = trpc.configuracoes.listUsers.useQuery();
  const [novo, setNovo] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const usuario = usuarios.find((item) => item.id === editId) ?? null;
  const [permissoes, setPermissoes] = useState<AdminModule[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [papel, setPapel] = useState<(typeof ROLES)[number]>("colaborador");

  useEffect(() => {
    if (!usuario) return;
    setPermissoes(parsePermissions(usuario.permissions));
    setAtivo(usuario.active);
    setPapel(usuario.role === "user" ? "cliente" : usuario.role);
  }, [usuario]);

  const refresh = () => utils.configuracoes.listUsers.invalidate();
  const criar = trpc.configuracoes.createUser.useMutation({ onSuccess: async () => { await refresh(); setNovo(false); toast.success("Usuário criado"); }, onError: e => toast.error(e.message) });
  const atualizar = trpc.configuracoes.updateUser.useMutation({ onSuccess: async () => { await refresh(); setEditId(null); toast.success("Acesso atualizado"); }, onError: e => toast.error(e.message) });
  const redefinir = trpc.configuracoes.resetPassword.useMutation({ onSuccess: () => toast.success("Senha redefinida"), onError: e => toast.error(e.message) });
  const excluir = trpc.configuracoes.deleteUser.useMutation({ onSuccess: async () => { await refresh(); setEditId(null); toast.success("Usuário excluído"); }, onError: e => toast.error(e.message) });

  function handleNovo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    criar.mutate({
      name: String(data.get("name") || ""), email: String(data.get("email") || ""), password: String(data.get("password") || ""),
      role: String(data.get("role")) as (typeof ROLES)[number], phone: String(data.get("phone") || "") || null,
      creci: String(data.get("creci") || "") || null, permissions: [],
    });
  }

  function handleEditar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usuario) return;
    const data = new FormData(event.currentTarget);
    atualizar.mutate({ id: usuario.id, name: String(data.get("name") || ""), role: papel, active: ativo,
      phone: String(data.get("phone") || "") || null, creci: String(data.get("creci") || "") || null, permissions: permissoes });
  }

  return <div className="min-h-screen bg-[#1A2332] text-white">
    <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft /></Button></Link><Settings className="text-[#C9A961]" /><div><h1 className="text-2xl font-bold text-[#C9A961]">Configurações</h1><p className="text-sm text-gray-400">Usuários, papéis e permissões por módulo</p></div></div>
      <Button onClick={() => setNovo(true)} className="bg-[#C9A961] font-bold text-[#1A2332]"><Plus className="mr-2 h-4 w-4" /> Novo usuário</Button>
    </div></header>
    <main className="mx-auto max-w-7xl p-4 md:p-6"><Card className="border-[#C9A961]/20 bg-[#2C3E50]"><CardContent className="space-y-2 pt-6">
      {isLoading ? <p>Carregando…</p> : usuarios.map(item => <button key={item.id} onClick={() => setEditId(item.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg bg-[#1A2332] p-4 text-left hover:ring-1 hover:ring-[#C9A961]/50">
        <div className="flex items-center gap-3"><UserCog className={item.active ? "text-green-400" : "text-gray-600"} /><div><p className="font-semibold">{item.name || "Sem nome"}</p><p className="text-xs text-gray-400">{item.email}</p></div></div>
        <div className="text-right"><p className="text-sm capitalize text-[#C9A961]">{item.role}</p><p className="text-xs text-gray-500">{item.active ? "Ativo" : "Inativo"} · {parsePermissions(item.permissions).length} permissões</p></div>
      </button>)}
    </CardContent></Card></main>

    <Dialog open={novo} onOpenChange={setNovo}><DialogContent className="border-[#C9A961]/30 bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
      <form onSubmit={handleNovo} className="grid gap-4 md:grid-cols-2"><Campo name="name" label="Nome" required /><Campo name="email" label="E-mail" type="email" required /><Campo name="password" label="Senha inicial (mín. 8)" type="password" required />
        <div><Label>Papel</Label><Select name="role" defaultValue="colaborador"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></div>
        <Campo name="phone" label="Telefone" /><Campo name="creci" label="CRECI" /><Button type="submit" disabled={criar.isPending} className="md:col-span-2 bg-[#C9A961] text-[#1A2332]">Criar usuário</Button>
      </form></DialogContent></Dialog>

    <Dialog open={!!usuario} onOpenChange={open => !open && setEditId(null)}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">{usuario && <>
      <DialogHeader><DialogTitle>Gerenciar acesso — {usuario.name}</DialogTitle></DialogHeader><form onSubmit={handleEditar} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2"><Campo name="name" label="Nome" defaultValue={usuario.name || ""} required /><Campo name="phone" label="Telefone" defaultValue={usuario.phone || ""} /><Campo name="creci" label="CRECI" defaultValue={usuario.creci || ""} />
          <div><Label>Papel</Label><Select value={papel} onValueChange={value => setPapel(value as typeof papel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></div>
        </div><label className="flex items-center justify-between rounded-lg bg-[#2C3E50] p-3"><span>Usuário ativo</span><Switch checked={ativo} onCheckedChange={setAtivo} /></label>
        <div><div className="mb-2 flex items-center gap-2"><Shield className="h-4 w-4 text-[#C9A961]" /><h3 className="font-semibold">Permissões por módulo</h3></div><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{ADMIN_MODULES.map(module => <label key={module} className="flex items-center gap-2 rounded bg-[#2C3E50] p-2 text-sm"><input type="checkbox" checked={papel === "admin" || permissoes.includes(module)} disabled={papel === "admin"} onChange={() => setPermissoes(current => current.includes(module) ? current.filter(p => p !== module) : [...current, module])} className="accent-[#C9A961]" />{ADMIN_MODULE_LABELS[module]}</label>)}</div></div>
        <Button type="submit" disabled={atualizar.isPending} className="w-full bg-[#C9A961] text-[#1A2332]">Salvar acesso</Button>
      </form><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); redefinir.mutate({ id: usuario.id, password: String(data.get("password")) }); event.currentTarget.reset(); }} className="flex gap-2 border-t border-white/10 pt-4"><Input name="password" type="password" minLength={8} required placeholder="Nova senha" /><Button type="submit" variant="outline"><KeyRound className="mr-2 h-4 w-4" /> Redefinir</Button></form>
      <Button variant="destructive" onClick={() => confirm(`Excluir ${usuario.name}?`) && excluir.mutate({ id: usuario.id })}><Trash2 className="mr-2 h-4 w-4" /> Excluir usuário</Button>
    </>}</DialogContent></Dialog>
  </div>;
}

function Campo({ name, label, type = "text", required, defaultValue }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string }) {
  return <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required={required} defaultValue={defaultValue} className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /></div>;
}
