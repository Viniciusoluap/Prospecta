import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, FileCheck2, KeyRound, Plus, Search, Settings, Shield, Trash2, UserCog } from "lucide-react";
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
import { UFS } from "../../../../shared/engenheiro";
import { PerfilEngenheiroPanel } from "@/components/admin/PerfilEngenheiroPanel";
import { TextoDoTermo } from "@/components/consentimento/TextoDoTermo";

const ROLES = ["admin", "corretor", "colaborador", "cliente", "empreiteiro"] as const;
// Lote 2, correção 04: "Engenheiro" é um perfil da tela — no acesso é colaborador (módulos) + perfil profissional.
const PERFIS = ["admin", "corretor", "colaborador", "engenheiro", "cliente", "empreiteiro"] as const;
type Perfil = (typeof PERFIS)[number];
const ROLE_LABEL: Record<Perfil, string> = { admin: "Administrador", colaborador: "Colaborador", engenheiro: "Engenheiro", corretor: "Corretor", cliente: "Cliente", empreiteiro: "Empreiteiro" };
const papelDoPerfil = (p: Perfil): (typeof ROLES)[number] => p === "engenheiro" ? "colaborador" : p;
const comModulos = (p: Perfil) => p === "colaborador" || p === "engenheiro";
/** Perfil da tela a partir do usuário gravado (engenheiro = colaborador com perfil profissional). */
const perfilDe = (u: { engenheiro: boolean; role: string }): Perfil | null =>
  u.engenheiro ? "engenheiro" : u.role === "user" ? "cliente" : (PERFIS as readonly string[]).includes(u.role) ? (u.role as Perfil) : null;
const perfilDaUrl = (): Perfil | "todos" => {
  const p = new URLSearchParams(window.location.search).get("perfil");
  return (PERFIS as readonly string[]).includes(p ?? "") ? (p as Perfil) : "todos";
};
const estiloFiltro = "h-9 rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";

export default function AdminConfiguracoes() {
  const utils = trpc.useUtils();
  const { data: usuarios = [], isLoading } = trpc.configuracoes.listUsers.useQuery();
  const [novo, setNovo] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const usuario = usuarios.find((item) => item.id === editId) ?? null;
  const [permissoes, setPermissoes] = useState<AdminModule[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [papel, setPapel] = useState<Perfil>("colaborador");
  // Item 05: campos do cadastro conforme o perfil.
  const [papelNovo, setPapelNovo] = useState<Perfil>("colaborador");
  const [permissoesNovo, setPermissoesNovo] = useState<AdminModule[]>([]);
  const [leadNovo, setLeadNovo] = useState("");
  const [leadEdit, setLeadEdit] = useState("");
  const [buscaLead, setBuscaLead] = useState("");
  // Item 12 (18/10): conta de cliente usa nome e telefone do cadastro no CRM.
  const [nomeNovo, setNomeNovo] = useState("");
  const [foneNovo, setFoneNovo] = useState("");
  const [nomeEdit, setNomeEdit] = useState("");
  const [foneEdit, setFoneEdit] = useState("");
  const { data: leadsSemConta = [] } = trpc.configuracoes.leadsSemConta.useQuery();
  // EPIC-023 (S-A): filtros da lista — perfil (mesmas opções do formulário), situação e busca.
  const [filtroPerfil, setFiltroPerfil] = useState<Perfil | "todos">(perfilDaUrl);
  const [filtroSituacao, setFiltroSituacao] = useState<"todos" | "ativos" | "inativos">("todos");
  const [busca, setBusca] = useState("");
  const [convidar, setConvidar] = useState(true);
  // EPIC-024 S-12: aceites do termo de consentimento (só leitura; só admin por papel).
  const [verTermo, setVerTermo] = useState(false);
  const { data: termo } = trpc.consentimento.admin.resumo.useQuery(undefined, { retry: false });
  const aceiteDe = useMemo(() => new Map((termo?.usuarios ?? []).map(u => [u.userId, u])), [termo]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return usuarios.filter(u =>
      (filtroPerfil === "todos" || perfilDe(u) === filtroPerfil) &&
      (filtroSituacao === "todos" || u.active === (filtroSituacao === "ativos")) &&
      (!termo || `${u.name ?? ""} ${u.leadName ?? ""} ${u.email ?? ""} ${u.creci ?? ""} ${u.phone ?? ""}`.toLowerCase().includes(termo)));
  }, [usuarios, filtroPerfil, filtroSituacao, busca]);

  useEffect(() => {
    if (!usuario) return;
    setPermissoes(parsePermissions(usuario.permissions));
    setAtivo(usuario.active);
    setPapel(usuario.engenheiro ? "engenheiro" : usuario.role === "user" ? "cliente" : usuario.role);
    setLeadEdit(usuario.leadId ? String(usuario.leadId) : "");
    setNomeEdit(usuario.leadName || usuario.name || "");
    setFoneEdit(usuario.leadPhone || usuario.phone || "");
  }, [usuario]);

  /** Ao escolher o cliente do CRM, nome e telefone vêm do cadastro dele. */
  function escolherLead(valor: string, alvo: "novo" | "edit") {
    const lead = leadsSemConta.find(l => String(l.id) === valor);
    const atual = alvo === "edit" && usuario?.leadId && String(usuario.leadId) === valor
      ? { name: usuario.leadName, phone: usuario.leadPhone }
      : lead;
    if (alvo === "novo") setLeadNovo(valor);
    else setLeadEdit(valor);
    if (!atual) return;
    if (alvo === "novo") {
      if (atual.name) setNomeNovo(atual.name);
      setFoneNovo(atual.phone || "");
    } else {
      if (atual.name) setNomeEdit(atual.name);
      setFoneEdit(atual.phone || "");
    }
  }

  const refresh = () => utils.configuracoes.listUsers.invalidate();
  const criar = trpc.configuracoes.createUser.useMutation({
    onSuccess: async (result) => {
      await refresh(); setNovo(false);
      toast.success(!result.convidado ? "Corretor cadastrado sem convite — envie o link de senha quando quiser, em Gerenciar acesso" : result.emailEnviado ? "Usuário criado — email com o link de definição de senha enviado" : "Usuário criado, mas o email não pôde ser enviado (confira a configuração de SMTP)");
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
      role: papelDoPerfil(papelNovo), phone: String(data.get("phone") || "") || null,
      creci: String(data.get("creci") || "") || null,
      permissions: comModulos(papelNovo) ? permissoesNovo : [],
      engenheiro: papelNovo === "engenheiro",
      crea: papelNovo === "engenheiro" ? String(data.get("crea") || "") || null : null,
      creaUf: papelNovo === "engenheiro" ? String(data.get("creaUf") || "") || null : null,
      leadId: papelNovo === "cliente" && leadNovo ? Number(leadNovo) : null,
      ...(papelNovo === "corretor" ? { defaultCommissionPct: String(data.get("defaultCommissionPct") || ""), notes: String(data.get("notes") || ""), enviarConvite: convidar } : {}),
    });
  }

  function handleEditar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usuario) return;
    const data = new FormData(event.currentTarget);
    atualizar.mutate({ id: usuario.id, name: String(data.get("name") || ""), role: papelDoPerfil(papel), active: ativo,
      phone: String(data.get("phone") || "") || null, creci: papel === "corretor" ? String(data.get("creci") || "") || null : usuario.creci,
      permissions: comModulos(papel) ? permissoes : [],
      engenheiro: papel === "engenheiro",
      leadId: papel === "cliente" && leadEdit ? Number(leadEdit) : null,
      ...(papel === "corretor" ? { defaultCommissionPct: String(data.get("defaultCommissionPct") || ""), notes: String(data.get("notes") || "") } : {}) });
  }

  return <div className="min-h-screen bg-[#1A2332] text-white">
    <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft /></Button></Link><Settings className="text-[#C9A961]" /><div><h1 className="text-2xl font-bold text-[#C9A961]">Usuários e acesso</h1><p className="text-sm text-gray-400">Cadastro de usuários, papéis e permissões</p></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setVerTermo(true)} className="border-[#C9A961]/40 bg-transparent text-[#C9A961] hover:bg-[#C9A961]/10"><FileCheck2 className="mr-2 h-4 w-4" /> Termo de consentimento</Button><Button onClick={() => { setNomeNovo(""); setFoneNovo(""); setLeadNovo(""); setConvidar(true); if (filtroPerfil !== "todos") setPapelNovo(filtroPerfil); setNovo(true); }} className="bg-[#C9A961] font-bold text-[#1A2332]"><Plus className="mr-2 h-4 w-4" /> Novo usuário</Button></div>
    </div></header>
    <main className="mx-auto max-w-7xl p-4 md:p-6"><Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100"><CardContent className="space-y-2 pt-6">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1"><Label htmlFor="busca-usuario" className="text-xs text-gray-300">Buscar</Label><div className="relative mt-1"><Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" /><Input id="busca-usuario" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, e-mail, CRECI ou telefone" className="border-[#C9A961]/30 bg-[#1A2332] pl-8 text-white placeholder:text-gray-400" /></div></div>
        <div><Label htmlFor="filtro-perfil" className="text-xs text-gray-300">Tipo de usuário</Label><select id="filtro-perfil" value={filtroPerfil} onChange={e => setFiltroPerfil(e.target.value as Perfil | "todos")} className={`mt-1 block ${estiloFiltro}`}><option value="todos">Todos</option>{PERFIS.map(p => <option key={p} value={p}>{ROLE_LABEL[p]}</option>)}</select></div>
        <div><Label htmlFor="filtro-situacao" className="text-xs text-gray-300">Situação</Label><select id="filtro-situacao" value={filtroSituacao} onChange={e => setFiltroSituacao(e.target.value as typeof filtroSituacao)} className={`mt-1 block ${estiloFiltro}`}><option value="todos">Todos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option></select></div>
        <p className="pb-2 text-xs text-gray-400">{visiveis.length} de {usuarios.length}</p>
      </div>
      {isLoading ? <p className="text-gray-300">Carregando…</p> : visiveis.length === 0 ? <p className="rounded-lg bg-[#1A2332] p-4 text-sm text-gray-300">Nenhum usuário com esses filtros.</p> : visiveis.map(item => <button key={item.id} onClick={() => setEditId(item.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg bg-[#1A2332] p-4 text-left hover:ring-1 hover:ring-[#C9A961]/50">
        <div className="flex items-center gap-3"><UserCog className={item.active ? "text-green-400" : "text-gray-300"} /><div><p className="font-semibold text-white">{item.name || "Sem nome"}</p><p className="text-xs text-gray-400">{item.email}</p>{termo && <LinhaDoTermo aceite={aceiteDe.get(item.id)} />}</div></div>
        <div className="text-right"><p className="text-sm text-[#C9A961]">{item.engenheiro ? ROLE_LABEL.engenheiro : ROLE_LABEL[item.role === "user" ? "cliente" : item.role] ?? item.role}</p><p className="text-xs text-gray-400">{item.active ? "Ativo" : "Inativo"} · {item.role === "corretor" ? `CRECI ${item.creci || "—"}${item.defaultCommissionPct ? ` · comissão ${Number(item.defaultCommissionPct).toLocaleString("pt-BR")}%` : ""}` : `${parsePermissions(item.permissions).length} permissões`}</p></div>
      </button>)}
    </CardContent></Card>
    </main>

    <Dialog open={verTermo} onOpenChange={setVerTermo}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Termo de consentimento</DialogTitle></DialogHeader>
      {termo ? <div className="space-y-4">
        <p role="note" className="rounded-md border border-amber-400/50 bg-amber-400/10 p-3 text-sm font-semibold text-amber-200">{termo.avisoProvisorio}</p>
        <div className="rounded-md bg-[#2C3E50] p-3 text-sm text-gray-100">
          <p>Versão vigente: <strong>{termo.versaoAtual}</strong></p>
          <p className="mt-1">Aceites por versão: {termo.porVersao.length === 0 ? "nenhum ainda" : termo.porVersao.map(v => `${v.versao} — ${v.usuarios} ${v.usuarios === 1 ? "usuário" : "usuários"}`).join(" · ")}</p>
          <p className="mt-1">Pedir o aceite no próximo login: <strong>{termo.pedirNoLogin ? "ligado" : "desligado"}</strong> (quem já tinha senha não é perguntado enquanto estiver desligado).</p>
        </div>
        {termo.pendenciasDoJuridico.length > 0 && <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100">
          <p className="font-semibold text-amber-200">Pontos para o jurídico revisar (não aparecem para o público):</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{termo.pendenciasDoJuridico.map(p => <li key={p}>{p}</li>)}</ul>
        </div>}
        <TextoDoTermo />
      </div> : <p className="text-sm text-gray-300">Carregando… (se não abrir, confira se a migração 0127 foi aplicada)</p>}
    </DialogContent></Dialog>

    <Dialog open={novo} onOpenChange={setNovo}><DialogContent className="border-[#C9A961]/30 bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
      <form onSubmit={handleNovo} className="grid gap-4 md:grid-cols-2"><Campo name="name" label={papelNovo === "cliente" ? "Nome (do CRM)" : "Nome"} required value={nomeNovo} onChange={setNomeNovo} readOnly={papelNovo === "cliente"} /><Campo name="email" label="E-mail" type="email" required />
        <div><Label>Perfil</Label><Select value={papelNovo} onValueChange={(v) => setPapelNovo(v as typeof papelNovo)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PERFIS.map(role => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent></Select></div>
        <Campo name="phone" label={papelNovo === "corretor" ? "Telefone *" : papelNovo === "cliente" ? "Telefone (do CRM)" : "Telefone"} required={papelNovo === "corretor"} value={foneNovo} onChange={setFoneNovo} readOnly={papelNovo === "cliente"} />
        {papelNovo === "corretor" && <><Campo name="creci" label="CRECI *" required /><Campo name="defaultCommissionPct" label="Comissão padrão (%)" /><div className="md:col-span-2"><Label htmlFor="notes-novo">Observações</Label><textarea id="notes-novo" name="notes" rows={2} className="mt-1 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] p-2 text-sm text-white" /></div><label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={convidar} onChange={e => setConvidar(e.target.checked)} className="accent-[#C9A961]" />Enviar agora o e-mail para o corretor definir a senha</label></>}
        {papelNovo === "engenheiro" && <><Campo name="crea" label="Nº do CREA" /><div><Label htmlFor="creaUf">UF do CREA</Label><select id="creaUf" name="creaUf" defaultValue="" className="mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-sm"><option value="">—</option>{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></div><p className="text-xs text-gray-300 md:col-span-2">Engenheiro tem os mesmos acessos do colaborador (módulos abaixo). Endereço, CREAs de outros estados e documentos ficam em "Gerenciar acesso" depois de criado.</p></>}
        {papelNovo === "cliente" && <div className="md:col-span-2"><Label>Cliente do CRM *</Label><Input value={buscaLead} onChange={(e) => setBuscaLead(e.target.value)} placeholder="Pesquisar cliente" className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /><select aria-label="Cliente do CRM" value={leadNovo} onChange={(e) => escolherLead(e.target.value, "novo")} className="mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-sm"><option value="">Selecione</option>{leadsSemConta.filter((l) => !buscaLead.trim() || `${l.name} ${l.email ?? ""}`.toLowerCase().includes(buscaLead.trim().toLowerCase())).slice(0, 200).map((l) => <option key={l.id} value={l.id}>{l.name}{l.phone ? ` · ${l.phone}` : ""}{l.email ? ` · ${l.email}` : ""}</option>)}</select></div>}
        {comModulos(papelNovo) && <fieldset className="md:col-span-2"><legend className="mb-1 text-sm">Módulos liberados</legend><div className="grid gap-1 sm:grid-cols-2">{ADMIN_MODULES.map((m) => <label key={m} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={permissoesNovo.includes(m)} onChange={() => setPermissoesNovo((c) => c.includes(m) ? c.filter((x) => x !== m) : [...c, m])} className="accent-[#C9A961]" />{ADMIN_MODULE_LABELS[m]}</label>)}</div></fieldset>}
        {papelNovo === "empreiteiro" && <p className="text-xs text-gray-300 md:col-span-2">O empreiteiro vê só as obras em que for escolhido como empreiteiro (na tela da obra).</p>}
        <p className="text-xs text-gray-300 md:col-span-2">{papelNovo === "corretor" && !convidar ? "O corretor fica cadastrado sem acesso; o link de senha pode ser enviado depois, em Gerenciar acesso." : "O usuário recebe um email para definir a própria senha — ninguém mais vê ou digita a senha dele."}</p>
        <Button type="submit" disabled={criar.isPending} className="md:col-span-2 bg-[#C9A961] text-[#1A2332]">Criar usuário</Button>
      </form></DialogContent></Dialog>

    <Dialog open={!!usuario} onOpenChange={open => !open && setEditId(null)}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">{usuario && <>
      <DialogHeader><DialogTitle>Gerenciar acesso — {usuario.name}</DialogTitle></DialogHeader><form onSubmit={handleEditar} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2"><Campo name="name" label={papel === "cliente" ? "Nome (do CRM)" : "Nome"} required value={nomeEdit} onChange={setNomeEdit} readOnly={papel === "cliente"} /><Campo name="phone" label={papel === "corretor" ? "Telefone *" : papel === "cliente" ? "Telefone (do CRM)" : "Telefone"} required={papel === "corretor"} value={foneEdit} onChange={setFoneEdit} readOnly={papel === "cliente"} />{papel === "corretor" && <><Campo name="creci" label="CRECI *" required defaultValue={usuario.creci || ""} /><Campo name="defaultCommissionPct" label="Comissão padrão (%)" defaultValue={usuario.defaultCommissionPct ? String(Number(usuario.defaultCommissionPct)) : ""} /></>}
          <div><Label>Perfil</Label><Select value={papel} onValueChange={value => setPapel(value as typeof papel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PERFIS.map(role => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent></Select></div>
          {papel === "cliente" && <div className="md:col-span-2"><Label>Cliente do CRM *</Label><Input value={buscaLead} onChange={(e) => setBuscaLead(e.target.value)} placeholder="Pesquisar cliente" className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /><select aria-label="Cliente do CRM" value={leadEdit} onChange={(e) => escolherLead(e.target.value, "edit")} className="mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-sm"><option value="">Selecione</option>{usuario.leadId && <option value={usuario.leadId}>Atual: {usuario.leadName || "cliente sem nome"}{usuario.leadPhone ? ` · ${usuario.leadPhone}` : ""}</option>}{leadsSemConta.filter((l) => !buscaLead.trim() || `${l.name} ${l.email ?? ""}`.toLowerCase().includes(buscaLead.trim().toLowerCase())).slice(0, 200).map((l) => <option key={l.id} value={l.id}>{l.name}{l.phone ? ` · ${l.phone}` : ""}{l.email ? ` · ${l.email}` : ""}</option>)}</select></div>}
        </div>
        {papel === "corretor" && <div><Label htmlFor="notes-edit">Observações</Label><textarea id="notes-edit" name="notes" rows={3} defaultValue={usuario.notes || ""} className="mt-1 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] p-2 text-sm text-white" /><p className="mt-1 text-xs text-gray-400">A comissão padrão vale nas obras sem percentual próprio. Vazio = sem regra.</p></div>}
        <p className="text-xs text-gray-400">Trocar o perfil ou desativar encerra as sessões abertas do usuário.</p><label className="flex items-center justify-between rounded-lg bg-[#2C3E50] p-3"><span>Usuário ativo</span><Switch checked={ativo} onCheckedChange={setAtivo} /></label>
        {comModulos(papel) && <div><div className="mb-2 flex items-center gap-2"><Shield className="h-4 w-4 text-[#C9A961]" /><h3 className="font-semibold">Módulos liberados ({papel === "engenheiro" ? "engenheiro" : "colaborador"})</h3></div><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{ADMIN_MODULES.map(module => <label key={module} className="flex items-center gap-2 rounded bg-[#2C3E50] p-2 text-sm"><input type="checkbox" checked={permissoes.includes(module)} onChange={() => setPermissoes(current => current.includes(module) ? current.filter(p => p !== module) : [...current, module])} className="accent-[#C9A961]" />{ADMIN_MODULE_LABELS[module]}</label>)}</div></div>}
        <Button type="submit" disabled={atualizar.isPending} className="w-full bg-[#C9A961] text-[#1A2332]">Salvar acesso</Button>
      </form>
      {papel === "engenheiro" && (usuario.engenheiro ? <PerfilEngenheiroPanel userId={usuario.id} /> : <p className="rounded-lg border border-[#C9A961]/30 p-3 text-sm text-gray-300">Clique em "Salvar acesso" para ativar o perfil Engenheiro e abra o usuário de novo para preencher os dados profissionais e enviar documentos.</p>)}<div className="flex items-center justify-between gap-2 border-t border-white/10 pt-4"><p className="text-xs text-gray-300">Envia um email para {usuario.name} definir uma nova senha (invalida sessões ativas na hora).</p><Button type="button" variant="outline" disabled={redefinir.isPending} onClick={() => redefinir.mutate({ id: usuario.id })}><KeyRound className="mr-2 h-4 w-4" /> Enviar link de redefinição</Button></div>
      <Button variant="destructive" onClick={() => confirm(`Excluir ${usuario.name}?`) && excluir.mutate({ id: usuario.id })}><Trash2 className="mr-2 h-4 w-4" /> Excluir usuário</Button>
    </>}</DialogContent></Dialog>
  </div>;
}

// Item 13 (18/10): para conta de cliente, nome e telefone vêm do CRM (só leitura).
function Campo({ name, label, type = "text", required, defaultValue, value, onChange, readOnly }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; value?: string; onChange?: (valor: string) => void; readOnly?: boolean }) {
  const controlado = onChange ? { value: value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) } : { defaultValue };
  return <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required={required} readOnly={readOnly} {...controlado} className="mt-1 read-only:opacity-80 border-[#C9A961]/30 bg-[#2C3E50] text-white placeholder:text-gray-400" /></div>;
}

/** EPIC-024 S-12: situação do termo de um usuário (só leitura). */
function LinhaDoTermo({ aceite }: { aceite?: { versao: string; aceitoEm: Date | string; aceitouVersaoAtual: boolean } }) {
  if (!aceite) return <p className="text-xs text-gray-400">Termo: não aceito</p>;
  const quando = new Date(aceite.aceitoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return <p className={`text-xs ${aceite.aceitouVersaoAtual ? "text-green-300" : "text-amber-200"}`}>Termo: aceito em {quando} · versão {aceite.versao}{aceite.aceitouVersaoAtual ? "" : " (anterior)"}</p>;
}
