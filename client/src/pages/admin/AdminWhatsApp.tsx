import { useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, MessageCircle, AlertCircle,
  Search, Send, Smartphone, Eye, Users, Plus, Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import type { WhatsappTemplate } from "@shared/whatsapp/templates";
import { ConexaoWhatsApp } from "@/components/whatsapp/ConexaoWhatsApp";
import { abaInicialCentral, abasCentralWhatsapp, linkConexaoWhatsapp, type AbaCentral } from "@shared/whatsapp/central";
import { ConversasWhatsApp } from "@/components/whatsapp/ConversasWhatsApp";
import { VARIAVEIS_TEMPLATE, variaveisDoTexto } from "@shared/whatsapp/variaveis";
import { CampoDocumentos, CampoImovel, CampoTexto, textoDocumentosMarcados } from "@/components/whatsapp/CamposVariaveisEnvio";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  enviada: { label: "Enviada", bg: "bg-gray-500/20", text: "text-gray-300" },
  entregue: { label: "Entregue", bg: "bg-blue-500/20", text: "text-blue-300" },
  lida: { label: "Lida", bg: "bg-green-500/20", text: "text-green-300" },
  falhou: { label: "Falhou", bg: "bg-red-500/20", text: "text-red-300" },
};

export default function AdminWhatsApp() {
  const { user } = useAuth();
  const role = user?.role ?? "cliente";
  const utils = trpc.useUtils();

  // Pedido de 25/10: ?aba=conversas&numero=… abre direto o chat (notificações e card do lead).
  const params = new URLSearchParams(window.location.search);
  // Item 12 (25/10 noite): abre em Conversas; a aba de conexão existe só para quem não é admin.
  const [activeTab, setActiveTab] = useState<AbaCentral>(abaInicialCentral(role, params.get("aba")));
  useEffect(() => { if (!abasCentralWhatsapp(role).includes(activeTab)) setActiveTab("conversas"); }, [role, activeTab]);
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);
  const [searchLead, setSearchLead] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsappTemplate | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [servicosSelecionados, setServicosSelecionados] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ id?: number; nome: string; categoria: string; conteudo: string } | null>(null);

  const conexao = trpc.whatsapp.minhaConexao.useQuery();
  const leadsQuery = trpc.whatsapp.leadsParaEnvio.useQuery();
  const historico = trpc.whatsapp.historico.useQuery();
  const templatesQuery = trpc.whatsapp.templates.useQuery();
  const servicosQuery = trpc.whatsapp.servicosDisponiveis.useQuery();
  const templates = templatesQuery.data ?? [];
  const salvarTemplate = trpc.whatsapp.salvarTemplate.useMutation({
    onSuccess: () => { toast.success("Template salvo."); setEditor(null); utils.whatsapp.templates.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const enviar = trpc.whatsapp.enviar.useMutation({
    onSuccess: (data) => {
      if (!data.success) { toast.error(data.error ?? "Erro ao enviar"); return; }
      toast.success(`${data.enviadas} enviada(s)${data.falhas > 0 ? `, ${data.falhas} falha(s)` : ""}`, data.falhas > 0 ? { icon: "⚠️" } : undefined);
      setSelectedLeads([]); setMensagem(""); setSelectedTemplate(null); setExtras({}); setServicosSelecionados([]); setDocsGeral({ marcados: [], livre: "" }); setDocsUnico(null);
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

  // Pedido de 25/10: variáveis do template preenchidas por destinatário, com prévia e campos para o que faltar.
  // Pedido de 25/10 (noite): os campos não somem a cada letra — a lista vem de `semCampoGeral` (não depende
  // do que está sendo digitado), a prévia espera a digitação parar e mantém o resultado anterior.
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [docsGeral, setDocsGeral] = useState({ marcados: [] as string[], livre: "" });
  const [docsUnico, setDocsUnico] = useState<{ leadId: number; marcados: string[]; livre: string } | null>(null);
  const variaveis = variaveisDoTexto(mensagem);
  const usaVariaveis = variaveis.length > 0;
  const usaDocumentos = variaveis.includes("documentos");
  const usaServicos = variaveis.includes("servico") || variaveis.includes("servicos");
  const unico = selectedLeads.length === 1 ? selectedLeads[0] : null;
  const docsLead = trpc.whatsapp.documentosParaEnvio.useQuery({ ids: unico ? [unico] : [] }, { enabled: usaDocumentos && unico !== null });
  // Um destinatário: o checklist dele já vem com os pendentes marcados.
  useEffect(() => {
    const d = docsLead.data?.[0];
    if (unico !== null && d && d.id === unico && docsUnico?.leadId !== unico) setDocsUnico({ leadId: unico, marcados: d.pendentes, livre: "" });
  }, [docsLead.data, unico, docsUnico?.leadId]);
  const textoServicos = servicosSelecionados.map(v => servicosQuery.data?.find(s => s.value === v)?.label ?? v).join(", ");
  const extrasEnvio: Record<string, string> = { ...extras,
    ...(usaServicos ? { servico: textoServicos, servicos: textoServicos } : {}),
    ...(usaDocumentos && unico === null ? { documentos: textoDocumentosMarcados(docsGeral.marcados, docsGeral.livre) } : {}) };
  const extrasPorLead = Object.fromEntries(selectedLeads.map(id => [String(id), {
    ...(usaDocumentos && unico === id && docsUnico?.leadId === id ? { documentos: textoDocumentosMarcados(docsUnico.marcados, docsUnico.livre) } : {}),
    ...(usaServicos ? { servico: textoServicos, servicos: textoServicos } : {}),
  }]));
  const [entradaPrevia, setEntradaPrevia] = useState({ extras: extrasEnvio, extrasPorLead });
  const chaveEntrada = JSON.stringify({ extrasEnvio, extrasPorLead });
  useEffect(() => {
    const t = setTimeout(() => setEntradaPrevia({ extras: extrasEnvio, extrasPorLead }), 400);
    return () => clearTimeout(t);
  }, [chaveEntrada]); // eslint-disable-line react-hooks/exhaustive-deps
  const previa = trpc.whatsapp.previaEnvio.useQuery(
    { mensagem, ids: selectedLeads, ...entradaPrevia },
    { enabled: usaVariaveis && selectedLeads.length > 0 && mensagem.trim().length > 0, placeholderData: keepPreviousData },
  );
  // Campos que aparecem: o que falta no cadastro de algum destinatário (documentos de 1 destinatário tem checklist próprio).
  const campos = Array.from(new Set((previa.data ?? []).flatMap((p) => p.semCampoGeral ?? []))).filter((v) => !(v === "documentos" && unico !== null));
  const camposVazios = campos.filter((v) => !(extrasEnvio[v] ?? "").trim());
  const docsUnicoVazio = usaDocumentos && unico !== null && docsUnico?.leadId === unico && !textoDocumentosMarcados(docsUnico.marcados, docsUnico.livre);
  const bloqueado = camposVazios.length > 0 || docsUnicoVazio || (usaServicos && !servicosSelecionados.length);
  function handleEnviar() {
    if (!mensagem.trim() || selectedLeads.length === 0) return;
    if (bloqueado) { toast.error("Preencha os campos destacados antes de enviar."); return; }
    const destinatarios = leads.filter((l) => selectedLeads.includes(l.id)).map((l) => ({ id: l.id, nome: l.name, telefone: l.phone }));
    enviar.mutate({ mensagem, destinatarios, extras: extrasEnvio, extrasPorLead });
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 sm:gap-4">
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
        <div className="flex gap-1 border-b border-[#C9A961]/20 overflow-x-auto">
          {([
            { key: "conversas" as const, label: "Conversas", icon: Users },
            { key: "enviar" as const, label: "Enviar Mensagem", icon: Send },
            { key: "templates" as const, label: "Templates", icon: MessageCircle },
            { key: "conexao" as const, label: "Minha conexão", icon: Smartphone },
          ]).filter(({ key }) => abasCentralWhatsapp(role).includes(key)).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex shrink-0 items-center gap-2 rounded-t px-4 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors whitespace-nowrap ${activeTab === key ? "border-[#C9A961] bg-[#C9A961]/10 text-[#C9A961]" : "border-transparent text-gray-500 hover:bg-white/5 hover:text-white"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {activeTab === "conversas" && <ConversasWhatsApp numeroInicial={params.get("numero")} />}

        {/* Conexão */}
        {activeTab === "conexao" && <ConexaoWhatsApp role={role} />}
        {/* Enviar */}
        {activeTab === "enviar" && (
          <div className="space-y-4">
            {!conexaoAtiva && (
              <div className="flex items-center gap-3 border border-yellow-500/30 bg-yellow-500/10 p-4 rounded">
                <AlertCircle size={18} className="text-yellow-400 shrink-0" />
                <p className="text-sm text-yellow-200">
                  Conecte o WhatsApp (QR code ou API oficial) na aba <button type="button" className="underline text-[#C9A961]" onClick={() => setActiveTab("conexao")}>Minha conexão</button>.
                </p>
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
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
                    {filteredLeads.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Nenhum lead encontrado.</p>}
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
                      onChange={(e) => { const t = templates.find((t) => t.id === e.target.value) ?? null; setSelectedTemplate(t); setMensagem(t?.body ?? ""); setServicosSelecionados([]); }}
                      className={`${inputCls} w-full rounded-md px-3 py-2 text-sm mt-1`}>
                      <option value="">— Selecione um template —</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.category} — {t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Mensagem</Label>
                    <textarea rows={5} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Digite a mensagem ou selecione um template..."
                      className={`${inputCls} w-full rounded-md px-3 py-2.5 text-sm mt-1 resize-none font-mono`} />
                    <p className="text-xs text-gray-400 mt-1">{mensagem.length} caracteres</p>
                  </div>
                  {usaVariaveis && selectedLeads.length > 0 && (
                    <div className="space-y-3 border-t border-[#C9A961]/10 pt-3">
                      {usaServicos && <div><Label className="text-gray-300">Serviços da mensagem</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{(servicosQuery.data ?? []).map(s => <label key={s.value} className="flex items-center gap-2 text-xs text-gray-200"><input type="checkbox" className="accent-[#C9A961]" checked={servicosSelecionados.includes(s.value)} onChange={() => setServicosSelecionados(v => v.includes(s.value) ? v.filter(x => x !== s.value) : [...v, s.value])}/>{s.label}</label>)}</div>{!servicosSelecionados.length && <p className="mt-1 text-xs text-yellow-200">Selecione ao menos um serviço.</p>}</div>}
                      {usaDocumentos && unico !== null && docsUnico?.leadId === unico && (
                        <div>
                          <Label className="text-gray-300">Documentos (pendentes do cliente já marcados)</Label>
                          <CampoDocumentos marcados={docsUnico.marcados} livre={docsUnico.livre} pendentes={docsLead.data?.[0]?.pendentes}
                            onChange={(marcados, livre) => setDocsUnico({ leadId: unico, marcados, livre })} />
                          {docsUnicoVazio && <p className="mt-1 text-xs text-yellow-200">Marque ao menos um documento.</p>}
                        </div>
                      )}
                      {usaDocumentos && unico === null && <p className="text-xs text-gray-300">Cada contato recebe a lista dos documentos pendentes dele.</p>}
                      {campos.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-yellow-200">Alguns destinatários não têm estes dados no cadastro. Informe para enviar:</p>
                          {campos.map((v) => v === "imovel" ? (
                            <div key={v}><Label className="text-gray-300">{VARIAVEIS_TEMPLATE.imovel}</Label>
                              <CampoImovel valor={extras.imovel ?? ""} onChange={(t) => setExtras((x) => ({ ...x, imovel: t }))} /></div>
                          ) : v === "documentos" ? (
                            <div key={v}><Label className="text-gray-300">Documentos (para quem não tem pendentes no checklist)</Label>
                              <CampoDocumentos marcados={docsGeral.marcados} livre={docsGeral.livre} onChange={(marcados, livre) => setDocsGeral({ marcados, livre })} /></div>
                          ) : (
                            <CampoTexto key={v} nome={v} valor={extras[v] ?? ""} onChange={(t) => setExtras((x) => ({ ...x, [v]: t }))} />
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-300">Prévia (como cada contato vai receber):</p>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {(previa.data ?? []).slice(0, 20).map((p) => (
                          <div key={p.id} className="rounded bg-[#1A2332] p-2 text-xs text-gray-100 whitespace-pre-wrap">
                            <b className="text-[#C9A961]">{leads.find((l) => l.id === p.id)?.name}: </b>{p.texto}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button onClick={handleEnviar} disabled={enviar.isPending || selectedLeads.length === 0 || !mensagem.trim() || bloqueado} className="bg-green-600 hover:bg-green-700 text-white font-bold">
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
              <span className="text-xs text-gray-400">{historico.data?.length ?? 0} registros</span>
            </CardHeader>
            <CardContent>
              {!historico.data?.length ? (
                <div className="py-10 text-center"><MessageCircle size={32} className="text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-400">Nenhuma mensagem enviada ainda.</p></div>
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
                            <td className="px-4 py-3"><p className="font-medium text-white">{m.nomeDestinatario ?? m.destinatario}</p><p className="text-xs text-gray-400">{m.destinatario}</p></td>
                            <td className="px-4 py-3 hidden md:table-cell max-w-xs"><p className="text-xs text-gray-400 truncate">{m.mensagem}</p></td>
                            <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold rounded ${badge.bg} ${badge.text}`}>{badge.label}</span>{m.erroMsg && <p className="text-xs text-red-400 mt-0.5">{m.erroMsg}</p>}</td>
                            <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-400">{new Date(m.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
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
