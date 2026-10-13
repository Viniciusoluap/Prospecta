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

const ROLES = ["admin", "corretor", "colaborador", "cliente", "empreiteiro"] as const;
const ROLE_LABEL: Record<(typeof ROLES)[number], string> = { admin: "Administrador", colaborador: "Colaborador", corretor: "Corretor", cliente: "Cliente", empreiteiro: "Empreiteiro" };

export default function AdminConfiguracoes() {
  const utils = trpc.useUtils();
  const { data: usuarios = [], isLoading } = trpc.configuracoes.listUsers.useQuery();
  const [novo, setNovo] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const usuario = usuarios.find((item) => item.id === editId) ?? null;
  const [permissoes, setPermissoes] = useState<AdminModule[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [papel, setPapel] = useState<(typeof ROLES)[number]>("colaborador");
  // Item 05: campos do cadastro conforme o perfil.
  const [papelNovo, setPapelNovo] = useState<(typeof ROLES)[number]>("colaborador");
  const [permissoesNovo, setPermissoesNovo] = useState<AdminModule[]>([]);
  const [leadNovo, setLeadNovo] = useState("");
  const [leadEdit, setLeadEdit] = useState("");
  const [buscaLead, setBuscaLead] = useState("");
  const { data: leadsSemConta = [] } = trpc.configuracoes.leadsSemConta.useQuery();

  useEffect(() => {
    if (!usuario) return;
    setPermissoes(parsePermissions(usuario.permissions));
    setAtivo(usuario.active);
    setPapel(usuario.role === "user" ? "cliente" : usuario.role);
    setLeadEdit(usuario.leadId ? String(usuario.leadId) : "");
  }, [usuario]);

  const refresh = () => utils.configuracoes.listUsers.invalidate();
  const criar = trpc.configuracoes.createUser.useMutation({
    onSuccess: async (result) => {
      await refresh(); setNovo(false);
      toast.success(result.emailEnviado ? "Usuário criado — email com o link de definição de senha enviado" : "Usuário criado, mas o email não pôde ser enviado (confira a configuração de SMTP)");
    },
    onError: e => toast.error(e.message),
  });
  const atualizar = trpc.configuracoes.updateUser.useMutation({ onSuccess: async () => { await refresh(); setEditId(null); toast.success("Acesso atualizado"); }, onError: e => toast.error(e.message) });
  const redefinir = trpc.configuracoes.resetPassword.useMutation({
    onSuccess: (result) => toast.success(result.emailEnviado ? "Link de redefinição enviado por email" : "Sessões revogadas, mas o email não pôde ser enviado (confira a configuração de SMTP)"),
    onError: e => toast.error(e.message),
  });
  const excluir = trpc.configuracoes.deleteUser.useMutation({ onSuccess: async () => { await refresh(); setEditId(null); toast.success("Usuário excluído"); }, onError: e => toast.error(e.message) });

  function handleNovo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    criar.mutate({
      name: String(data.get("name") || ""), email: String(data.get("email") || ""),
      role: papelNovo, phone: String(data.get("phone") || "") || null,
      creci: String(data.get("creci") || "") || null,
      permissions: papelNovo === "colaborador" ? permissoesNovo : [],
      leadId: papelNovo === "cliente" && leadNovo ? Number(leadNovo) : null,
    });
  }

  function handleEditar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usuario) return;
    const data = new FormData(event.currentTarget);
    atualizar.mutate({ id: usuario.id, name: String(data.get("name") || ""), role: papel, active: ativo,
      phone: String(data.get("phone") || "") || null, creci: String(data.get("creci") || "") || null,
      permissions: papel === "colaborador" ? permissoes : [],
      leadId: papel === "cliente" && leadEdit ? Number(leadEdit) : null });
  }

  return <div className="min-h-screen bg-[#1A2332] text-white">
    <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft /></Button></Link><Settings className="text-[#C9A961]" /><div><h1 className="text-2xl font-bold text-[#C9A961]">Configurações</h1><p className="text-sm text-gray-400">Usuários, papéis e permissões por módulo</p></div></div>
      <Button onClick={() => setNovo(true)} className="bg-[#C9A961] font-bold text-[#1A2332]"><Plus className="mr-2 h-4 w-4" /> Novo usuário</Button>
    </div></header>
    <main className="mx-auto max-w-7xl p-4 md:p-6"><Card className="border-[#C9A961]/20 bg-[#2C3E50]"><CardContent className="space-y-2 pt-6">
      {isLoading ? <p className="text-gray-300">Carregando…</p> : usuarios.map(item => <button key={item.id} onClick={() => setEditId(item.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg bg-[#1A2332] p-4 text-left hover:ring-1 hover:ring-[#C9A961]/50">
        <div className="flex items-center gap-3"><UserCog className={item.active ? "text-green-400" : "text-gray-600"} /><div><p className="font-semibold text-white">{item.name || "Sem nome"}</p><p className="text-xs text-gray-400">{item.email}</p></div></div>
        <div className="text-right"><p className="text-sm text-[#C9A961]">{ROLE_LABEL[item.role === "user" ? "cliente" : item.role] ?? item.role}</p><p className="text-xs text-gray-400">{item.active ? "Ativo" : "Inativo"} · {parsePermissions(item.permissions).length} permissões</p></div>
      </button>)}
    </CardContent></Card></main>

    <Dialog open={novo} onOpenChange={setNovo}><DialogContent className="border-[#C9A961]/30 bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
      <form onSubmit={handleNovo} className="grid gap-4 md:grid-cols-2"><Campo name="name" label="Nome" required /><Campo name="email" label="E-mail" type="email" required />
        <div><Label>Perfil</Label><Select value={papelNovo} onValueChange={(v) => setPapelNovo(v as typeof papelNovo)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLES.map(role => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent></Select></div>
        <Campo name="phone" label={papelNovo === "corretor" ? "Telefone *" : "Telefone"} required={papelNovo === "corretor"} />
        {papelNovo === "corretor" && <Campo name="creci" label="CRECI *" required />}
        {papelNovo === "cliente" && <div className="md:col-span-2"><Label>Cliente do CRM *</Label><Input value={buscaLead} onChange={(e) => setBuscaLead(e.target.value)} placeholder="Pesquisar cliente" className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /><select value={leadNovo} onChange={(e) => setLeadNovo(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-sm"><option value="">Selecione</option>{leadsSemConta.filter((l) => !buscaLead.trim() || `${l.name} ${l.email ?? ""}`.toLowerCase().includes(buscaLead.trim().toLowerCase())).slice(0, 200).map((l) => <option key={l.id} value={l.id}>{l.name}{l.email ? ` · ${l.email}` : ""}</option>)}</select></div>}
        {papelNovo === "colaborador" && <fieldset className="md:col-span-2"><legend className="mb-1 text-sm">Módulos liberados</legend><div className="grid gap-1 sm:grid-cols-2">{ADMIN_MODULES.map((m) => <label key={m} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={permissoesNovo.includes(m)} onChange={() => setPermissoesNovo((c) => c.includes(m) ? c.filter((x) => x !== m) : [...c, m])} className="accent-[#C9A961]" />{ADMIN_MODULE_LABELS[m]}</label>)}</div></fieldset>}
        {papelNovo === "empreiteiro" && <p className="text-xs text-gray-300 md:col-span-2">O empreiteiro vê só as obras em que for escolhido como empreiteiro (na tela da obra).</p>}
        <p className="text-xs text-gray-300 md:col-span-2">O usuário recebe um email para definir a própria senha — ninguém mais vê ou digita a senha dele.</p>
        <Button type="submit" disabled={criar.isPending} className="md:col-span-2 bg-[#C9A961] text-[#1A2332]">Criar usuário</Button>
      </form></DialogContent></Dialog>

    <Dialog open={!!usuario} onOpenChange={open => !open && setEditId(null)}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">{usuario && <>
      <DialogHeader><DialogTitle>Gerenciar acesso — {usuario.name}</DialogTitle></DialogHeader><form onSubmit={handleEditar} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2"><Campo name="name" label="Nome" defaultValue={usuario.name || ""} required /><Campo name="phone" label="Telefone" defaultValue={usuario.phone || ""} /><Campo name="creci" label="CRECI" defaultValue={usuario.creci || ""} />
          <div><Label>Perfil</Label><Select value={papel} onValueChange={value => setPapel(value as typeof papel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLES.map(role => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent></Select></div>
          {papel === "cliente" && <div className="md:col-span-2"><Label>Cliente do CRM *</Label><Input value={buscaLead} onChange={(e) => setBuscaLead(e.target.value)} placeholder="Pesquisar cliente" className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /><select value={leadEdit} onChange={(e) => setLeadEdit(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-sm"><option value="">Selecione</option>{usuario.leadId && <option value={usuario.leadId}>Atual: cliente #{usuario.leadId}</option>}{leadsSemConta.filter((l) => !buscaLead.trim() || `${l.name} ${l.email ?? ""}`.toLowerCase().includes(buscaLead.trim().toLowerCase())).slice(0, 200).map((l) => <option key={l.id} value={l.id}>{l.name}{l.email ? ` · ${l.email}` : ""}</option>)}</select></div>}
        </div>
        <p className="text-xs text-gray-400">Trocar o perfil ou desativar encerra as sessões abertas do usuário.</p><label className="flex items-center justify-between rounded-lg bg-[#2C3E50] p-3"><span>Usuário ativo</span><Switch checked={ativo} onCheckedChange={setAtivo} /></label>
        {papel === "colaborador" && <div><div className="mb-2 flex items-center gap-2"><Shield className="h-4 w-4 text-[#C9A961]" /><h3 className="font-semibold">Módulos liberados (colaborador)</h3></div><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{ADMIN_MODULES.map(module => <label key={module} className="flex items-center gap-2 rounded bg-[#2C3E50] p-2 text-sm"><input type="checkbox" checked={permissoes.includes(module)} onChange={() => setPermissoes(current => current.includes(module) ? current.filter(p => p !== module) : [...current, module])} className="accent-[#C9A961]" />{ADMIN_MODULE_LABELS[module]}</label>)}</div></div>}
        <Button type="submit" disabled={atualizar.isPending} className="w-full bg-[#C9A961] text-[#1A2332]">Salvar acesso</Button>
      </form><div className="flex items-center justify-between gap-2 border-t border-white/10 pt-4"><p className="text-xs text-gray-300">Envia um email para {usuario.name} definir uma nova senha (invalida sessões ativas na hora).</p><Button type="button" variant="outline" disabled={redefinir.isPending} onClick={() => redefinir.mutate({ id: usuario.id })}><KeyRound className="mr-2 h-4 w-4" /> Enviar link de redefinição</Button></div>
      <Button variant="destructive" onClick={() => confirm(`Excluir ${usuario.name}?`) && excluir.mutate({ id: usuario.id })}><Trash2 className="mr-2 h-4 w-4" /> Excluir usuário</Button>
    </>}</DialogContent></Dialog>
  </div>;
}

function Campo({ name, label, type = "text", required, defaultValue }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string }) {
  return <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required={required} defaultValue={defaultValue} className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /></div>;
}
