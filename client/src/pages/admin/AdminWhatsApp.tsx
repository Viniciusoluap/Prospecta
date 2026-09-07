import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, MessageCircle, CheckCircle2, Clock, AlertCircle, Wifi, WifiOff,
  Search, Send, Smartphone, Eye, Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { WHATSAPP_TEMPLATES, type WhatsappTemplate } from "@shared/whatsapp/templates";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  enviada: { label: "Enviada", bg: "bg-gray-500/20", text: "text-gray-300" },
  entregue: { label: "Entregue", bg: "bg-blue-500/20", text: "text-blue-300" },
  lida: { label: "Lida", bg: "bg-green-500/20", text: "text-green-300" },
  falhou: { label: "Falhou", bg: "bg-red-500/20", text: "text-red-300" },
};

function StatusConexao({ status }: { status: string }) {
  if (status === "conectado") {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-400 text-xs font-bold rounded"><Wifi size={12} /> Conectado</span>;
  }
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-500/10 text-gray-400 text-xs font-bold rounded"><WifiOff size={12} /> Desconectado</span>;
}

export default function AdminWhatsApp() {
  const { user } = useAuth();
  const role = user?.role ?? "cliente";
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<"conexao" | "enviar" | "templates" | "historico">("conexao");
  const [businessToken, setBusinessToken] = useState("");
  const [businessPhoneId, setBusinessPhoneId] = useState("");
  const [businessNumero, setBusinessNumero] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);
  const [searchLead, setSearchLead] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsappTemplate | null>(null);
  const [mensagem, setMensagem] = useState("");

  const conexao = trpc.whatsapp.minhaConexao.useQuery();
  const conexoesCorretores = trpc.whatsapp.conexoesCorretores.useQuery(undefined, { enabled: role === "admin" });
  const leadsQuery = trpc.whatsapp.leadsParaEnvio.useQuery();
  const historico = trpc.whatsapp.historico.useQuery();

  const salvarConexao = trpc.whatsapp.salvarConexao.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp Business configurado com sucesso!");
      setBusinessToken(""); setBusinessPhoneId(""); setBusinessNumero("");
      utils.whatsapp.minhaConexao.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const desconectar = trpc.whatsapp.desconectar.useMutation({
    onSuccess: () => { toast.success("WhatsApp desconectado"); utils.whatsapp.minhaConexao.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const enviar = trpc.whatsapp.enviar.useMutation({
    onSuccess: (data) => {
      if (!data.success) { toast.error(data.error ?? "Erro ao enviar"); return; }
      toast.success(`${data.enviadas} enviada(s)${data.falhas > 0 ? `, ${data.falhas} falha(s)` : ""}`, data.falhas > 0 ? { icon: "⚠️" } : undefined);
      setSelectedLeads([]); setMensagem(""); setSelectedTemplate(null);
      utils.whatsapp.historico.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const leads = leadsQuery.data ?? [];
  const filteredLeads = leads.filter((l) => !searchLead || l.name.toLowerCase().includes(searchLead.toLowerCase()) || l.phone.includes(searchLead));
  const conexaoAtiva = conexao.data?.status === "conectado";
  const totalEnviadas = historico.data?.length ?? 0;
  const totalLidas = historico.data?.filter((m) => m.status === "lida").length ?? 0;
  const totalFalhas = historico.data?.filter((m) => m.status === "falhou").length ?? 0;
  const taxaLeitura = totalEnviadas > 0 ? Math.round((totalLidas / totalEnviadas) * 100) : 0;

  function handleEnviar() {
    if (!mensagem.trim() || selectedLeads.length === 0) return;
    const destinatarios = leads.filter((l) => selectedLeads.includes(l.id)).map((l) => ({ id: l.id, nome: l.name, telefone: l.phone }));
    enviar.mutate({ mensagem, destinatarios });
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link href="/admin"><Button variant="ghost" size="icon" className="text-gray-400 hover:text-white"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-2xl font-bold text-[#C9A961]">Central WhatsApp</h1>
          <span className="text-sm text-gray-400">{leads.length} leads disponíveis</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Leads Disponíveis", value: leads.length, icon: Users, color: "text-[#C9A961]" },
            { label: "Mensagens Enviadas", value: totalEnviadas, icon: MessageCircle, color: "text-blue-400" },
            { label: "Taxa de Leitura", value: `${taxaLeitura}%`, icon: Eye, color: "text-green-400" },
            { label: "Falhas", value: totalFalhas, icon: AlertCircle, color: "text-red-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className={cardCls}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">{label}</span>
                  <Icon size={15} className={color} />
                </div>
                <p className="font-black text-white text-xl">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#C9A961]/20 overflow-x-auto">
          {([
            { key: "conexao" as const, label: "Conexão", icon: Smartphone },
            { key: "enviar" as const, label: "Enviar Mensagem", icon: Send },
            { key: "templates" as const, label: "Templates", icon: MessageCircle },
            { key: "historico" as const, label: "Histórico", icon: Clock },
          ]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors whitespace-nowrap ${activeTab === key ? "border-[#C9A961] text-[#C9A961]" : "border-transparent text-gray-500 hover:text-white"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Conexão */}
        {activeTab === "conexao" && (
          <div className="space-y-5">
            {role === "colaborador" && (
              <Card className={cardCls}>
                <CardHeader><CardTitle className="text-sm text-gray-300">WhatsApp Business (Admin)</CardTitle></CardHeader>
                <CardContent>
                  {conexao.data ? (
                    <div className="space-y-2"><StatusConexao status={conexao.data.status} />{conexao.data.numero && <p className="text-xs text-gray-400">{conexao.data.numero}</p>}</div>
                  ) : <p className="text-sm text-gray-400">Nenhuma conexão configurada pelo administrador.</p>}
                  <p className="text-xs text-gray-500 mt-3">Como colaborador, você usa a conexão do administrador. Contate o admin para gerenciar.</p>
                </CardContent>
              </Card>
            )}

            {(role === "admin" || role === "corretor") && (
              <Card className={cardCls}>
                <CardHeader><CardTitle className="text-sm text-gray-300">Minha Conexão WhatsApp Business</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {conexaoAtiva ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-3 bg-green-500/10 rounded">
                        <CheckCircle2 size={20} className="text-green-400" />
                        <div><p className="font-bold text-green-400 text-sm">Conectado via WhatsApp Business API</p>{conexao.data?.numero && <p className="text-xs text-gray-400">{conexao.data.numero}</p>}</div>
                      </div>
                      <Button variant="outline" onClick={() => desconectar.mutate()} disabled={desconectar.isPending}
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10">
                        <WifiOff className="h-4 w-4 mr-2" /> {desconectar.isPending ? "Removendo..." : "Remover conexão"}
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={(e) => { e.preventDefault(); salvarConexao.mutate({ token: businessToken, phoneNumberId: businessPhoneId, numero: businessNumero }); }} className="space-y-3">
                      <div className="border border-blue-500/30 bg-blue-500/10 p-4 text-xs text-blue-300 rounded space-y-1">
                        <p className="font-bold">WhatsApp Business API (Meta Cloud API)</p>
                        <p>Gratuito até 1.000 conversas/mês. Requer conta Meta Business verificada.</p>
                        <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="inline-block mt-1 font-bold underline">Ver guia de configuração →</a>
                      </div>
                      <div><Label className="text-gray-300">Token de Acesso Permanente</Label><Input value={businessToken} onChange={(e) => setBusinessToken(e.target.value)} placeholder="EAAxxxxxxxx..." required className={`${inputCls} mt-1`} /></div>
                      <div><Label className="text-gray-300">Phone Number ID</Label><Input value={businessPhoneId} onChange={(e) => setBusinessPhoneId(e.target.value)} placeholder="1234567890" required className={`${inputCls} mt-1`} /></div>
                      <div><Label className="text-gray-300">Número WhatsApp</Label><Input value={businessNumero} onChange={(e) => setBusinessNumero(e.target.value)} placeholder="+55 94 9 9999-9999" required className={`${inputCls} mt-1`} /></div>
                      <Button type="submit" disabled={salvarConexao.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Salvar e Conectar
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            )}

            {role === "admin" && (
              <Card className={cardCls}>
                <CardHeader><CardTitle className="text-sm text-gray-300">Conexões dos Corretores {conexoesCorretores.data && conexoesCorretores.data.length > 0 && `(${conexoesCorretores.data.length})`}</CardTitle></CardHeader>
                <CardContent>
                  {!conexoesCorretores.data?.length ? <p className="text-sm text-gray-400">Nenhum corretor cadastrado.</p> : (
                    <div className="divide-y divide-[#C9A961]/10">
                      {conexoesCorretores.data.map((c) => (
                        <div key={c.userId} className="flex items-center gap-4 py-3">
                          <div className="w-8 h-8 bg-[#1A2332] flex items-center justify-center text-[#C9A961] font-black text-sm shrink-0 rounded">{c.nome[0]}</div>
                          <div className="flex-1 min-w-0"><p className="font-bold text-white text-sm truncate">{c.nome}</p>{c.numero && <p className="text-xs text-gray-400">{c.numero}</p>}</div>
                          <StatusConexao status={c.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Enviar */}
        {activeTab === "enviar" && (
          <div className="space-y-4">
            {!conexaoAtiva && (
              <div className="flex items-center gap-3 border border-yellow-500/30 bg-yellow-500/10 p-4 rounded">
                <AlertCircle size={18} className="text-yellow-400 shrink-0" />
                <p className="text-sm text-yellow-200">{role === "colaborador" ? "A conexão WhatsApp do administrador não está ativa. Contate o admin." : "Configure sua conexão WhatsApp Business na aba Conexão."}</p>
              </div>
            )}
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-5 ${!conexaoAtiva ? "opacity-50 pointer-events-none" : ""}`}>
              <Card className={cardCls}>
                <CardHeader>
                  <CardTitle className="text-sm text-gray-300 flex items-center justify-between">
                    <span>Destinatários{selectedLeads.length > 0 && <span className="text-[#C9A961]"> ({selectedLeads.length})</span>}</span>
                    {selectedLeads.length > 0 && <button onClick={() => setSelectedLeads([])} className="text-xs text-red-400 hover:underline">Limpar</button>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <Input placeholder="Buscar lead..." value={searchLead} onChange={(e) => setSearchLead(e.target.value)} className={`${inputCls} pl-8`} />
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {filteredLeads.map((l) => {
                      const selected = selectedLeads.includes(l.id);
                      return (
                        <label key={l.id} className={`flex items-center gap-3 p-2.5 cursor-pointer rounded border transition-colors ${selected ? "border-[#C9A961] bg-[#C9A961]/5" : "border-transparent hover:bg-[#1A2332]"}`}>
                          <input type="checkbox" checked={selected} onChange={() => setSelectedLeads((prev) => selected ? prev.filter((id) => id !== l.id) : [...prev, l.id])} className="accent-[#C9A961]" />
                          <div className="flex-1 min-w-0"><p className="text-sm font-medium text-white truncate">{l.name}</p><p className="text-xs text-gray-400">{l.phone}</p></div>
                        </label>
                      );
                    })}
                    {filteredLeads.length === 0 && <p className="text-xs text-gray-500 text-center py-4">Nenhum lead encontrado.</p>}
                  </div>
                  <button onClick={() => setSelectedLeads(leads.map((l) => l.id))} className="flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-white">
                    <Users size={12} /> Selecionar todos ({leads.length})
                  </button>
                </CardContent>
              </Card>

              <Card className={cardCls}>
                <CardHeader><CardTitle className="text-sm text-gray-300">Mensagem</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-gray-300">Template</Label>
                    <select value={selectedTemplate?.id ?? ""}
                      onChange={(e) => { const t = WHATSAPP_TEMPLATES.find((t) => t.id === e.target.value) ?? null; setSelectedTemplate(t); setMensagem(t?.body ?? ""); }}
                      className={`${inputCls} w-full rounded-md px-3 py-2 text-sm mt-1`}>
                      <option value="">— Selecione um template —</option>
                      {WHATSAPP_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.category} — {t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Mensagem</Label>
                    <textarea rows={5} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Digite a mensagem ou selecione um template..."
                      className={`${inputCls} w-full rounded-md px-3 py-2.5 text-sm mt-1 resize-none font-mono`} />
                    <p className="text-xs text-gray-500 mt-1">{mensagem.length} caracteres</p>
                  </div>
                  <Button onClick={handleEnviar} disabled={enviar.isPending || selectedLeads.length === 0 || !mensagem.trim()} className="bg-green-600 hover:bg-green-700 text-white font-bold">
                    <Send className="h-4 w-4 mr-2" /> {enviar.isPending ? "Enviando..." : `Enviar para ${selectedLeads.length} contato${selectedLeads.length !== 1 ? "s" : ""}`}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Templates */}
        {activeTab === "templates" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHATSAPP_TEMPLATES.map((t) => (
              <Card key={t.id} className={cardCls}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div><p className="font-bold text-white text-sm">{t.name}</p><span className="text-[10px] font-bold bg-[#C9A961]/20 text-[#C9A961] px-2 py-0.5 rounded uppercase">{t.category}</span></div>
                    <Button size="sm" onClick={() => { setSelectedTemplate(t); setMensagem(t.body); setActiveTab("enviar"); }} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold text-xs">Usar</Button>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed mt-3 whitespace-pre-line">{t.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Histórico */}
        {activeTab === "historico" && (
          <Card className={cardCls}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-gray-300">Mensagens Enviadas</CardTitle>
              <span className="text-xs text-gray-500">{historico.data?.length ?? 0} registros</span>
            </CardHeader>
            <CardContent>
              {!historico.data?.length ? (
                <div className="py-10 text-center"><MessageCircle size={32} className="text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-400">Nenhuma mensagem enviada ainda.</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#1A2332]">
                        <th className="px-4 py-3 text-left text-xs font-black text-[#C9A961] uppercase">Contato</th>
                        <th className="px-4 py-3 text-left text-xs font-black text-[#C9A961] uppercase hidden md:table-cell">Mensagem</th>
                        <th className="px-4 py-3 text-left text-xs font-black text-[#C9A961] uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-black text-[#C9A961] uppercase hidden lg:table-cell">Data/Hora</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C9A961]/10">
                      {historico.data.map((m) => {
                        const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.enviada;
                        return (
                          <tr key={m.id} className="hover:bg-[#1A2332]/50">
                            <td className="px-4 py-3"><p className="font-medium text-white">{m.nomeDestinatario ?? m.destinatario}</p><p className="text-xs text-gray-500">{m.destinatario}</p></td>
                            <td className="px-4 py-3 hidden md:table-cell max-w-xs"><p className="text-xs text-gray-400 truncate">{m.mensagem}</p></td>
                            <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold rounded ${badge.bg} ${badge.text}`}>{badge.label}</span>{m.erroMsg && <p className="text-xs text-red-400 mt-0.5">{m.erroMsg}</p>}</td>
                            <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-500">{new Date(m.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
