// EPIC-025 E9 (regra do dono de 20/11/2026) — atendimento pelo número da empresa, só admin: "Dolores responde clientes
// cadastrados" (DESLIGADO por padrão), tetos, horas de silêncio depois que a equipe responde, teto de saudações, transcrição de áudio
// pela Cloudflare (DESLIGADA por padrão) e as credenciais dela (o token nunca volta para a tela: só os 4 últimos caracteres).
// Campanhas de saudação e os textos dos avisos ficam na Central › Templates.
import { useState } from "react";
import { toast } from "sonner";
import { Headphones } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inputCls = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
type Numeros = "clienteTetoDia" | "clienteTetoGlobalDia" | "silencioHoras" | "saudacaoTetoDia" | "transcricaoDuracaoMaxS" | "transcricaoTetoNumeroDia" | "transcricaoTetoGlobalDia" | "avisoIntervaloHoras";
const CAMPOS: Array<[Numeros, string]> = [
  ["clienteTetoDia", "Respostas por cliente por dia"], ["clienteTetoGlobalDia", "Respostas a clientes por dia (total)"],
  ["silencioHoras", "Horas calada depois que a equipe responde"], ["saudacaoTetoDia", "Saudações por dia (total)"],
  ["transcricaoDuracaoMaxS", "Duração máxima do áudio (s)"], ["transcricaoTetoNumeroDia", "Áudios transcritos por número por dia"],
  ["transcricaoTetoGlobalDia", "Áudios transcritos por dia (total)"], ["avisoIntervaloHoras", "Horas entre avisos de ligação/áudio"],
];

export function AtendimentoEmpresaCard() {
  const utils = trpc.useUtils();
  const q = trpc.dolores.atendimento.status.useQuery(undefined, { retry: false });
  const [valores, setValores] = useState<Partial<Record<Numeros, string>>>({});
  const [conta, setConta] = useState("");
  const [token, setToken] = useState("");
  const onError = (e: { message: string }) => toast.error(e.message);
  const recarregar = () => utils.dolores.atendimento.status.invalidate();
  const salvar = trpc.dolores.atendimento.salvarConfig.useMutation({ onSuccess: async () => { toast.success("Atendimento salvo."); setValores({}); await recarregar(); }, onError });
  const salvarCf = trpc.dolores.atendimento.salvarCloudflare.useMutation({ onSuccess: async () => { toast.success("Credenciais da Cloudflare salvas."); setConta(""); setToken(""); await recarregar(); }, onError });
  const removerCf = trpc.dolores.atendimento.removerCloudflare.useMutation({ onSuccess: async () => { toast.success("Credenciais removidas; transcrição desligada."); await recarregar(); }, onError });
  const d = q.data;

  function enviarNumeros(e: React.FormEvent) {
    e.preventDefault();
    const dados: Partial<Record<Numeros, number>> = {};
    for (const [k] of CAMPOS) { const v = valores[k]?.replace(/\D/g, ""); if (v) dados[k] = Number(v); }
    if (!Object.keys(dados).length) { toast.error("Preencha pelo menos um campo."); return; }
    salvar.mutate(dados);
  }

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Headphones className="h-5 w-5" /> Atendimento pelo WhatsApp da empresa</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : q.error ? <p role="alert" className="text-sm text-red-300">{q.error.message}</p> : d && <>
          {d.desligadoPorFalha && <p role="alert" className="rounded border border-red-400/30 bg-red-400/10 p-2 text-xs text-red-200">A resposta a clientes foi desligada sozinha porque o consumo de uma chamada não pôde ser registrado{d.desligadoPorFalha.soNestaInstancia ? " (só nesta instância)" : ""}. Confira e ligue de novo.</p>}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Dolores responde clientes cadastrados: <strong className={d.config.clienteLigado ? "text-green-300" : "text-gray-300"}>{d.config.clienteLigado ? "ligado" : "desligado"}</strong></span>
            <Button size="sm" disabled={salvar.isPending} className={d.config.clienteLigado ? "bg-red-700 text-white hover:bg-red-800" : "bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]"}
              onClick={() => {
                if (d.config.clienteLigado) { salvar.mutate({ clienteLigado: false }); return; }
                if (window.confirm("Ligar a resposta a clientes cadastrados? A Dolores passa a responder, pelo número da empresa, quem tem o telefone de UM cliente do CRM — só sobre o caso dele, sem valores, e consome créditos da Anthropic dentro do limite mensal.")) salvar.mutate({ clienteLigado: true });
              }}>{d.config.clienteLigado ? "Desligar" : "Ligar"}</Button>
            <span>Transcrição de áudio: <strong className={d.config.transcricaoLigada ? "text-green-300" : "text-gray-300"}>{d.config.transcricaoLigada ? "ligada" : "desligada"}</strong></span>
            <Button size="sm" variant="outline" disabled={salvar.isPending} className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10"
              onClick={() => salvar.mutate({ transcricaoLigada: !d.config.transcricaoLigada })}>{d.config.transcricaoLigada ? "Desligar" : "Ligar"}</Button>
          </div>
          <p className="text-xs text-gray-400">Telefone ligado a mais de um cadastro vai para a equipe. Quando alguém da equipe responde na conversa, a Dolores fica calada nela pelas horas abaixo. Número desconhecido recebe só a saudação da campanha ativa (Central › Templates). Ligação não é atendida: a pessoa recebe por texto que pode escrever. O áudio vai à Cloudflare para transcrever: isso entra no termo de consentimento (pendência do jurídico).</p>
          <form className="grid gap-3 rounded-lg bg-[#1A2332] p-3 md:grid-cols-2" onSubmit={enviarNumeros}>
            {CAMPOS.map(([k, rotulo]) => (
              <div key={k}>
                <Label className="text-gray-300" htmlFor={`atend-${k}`}>{rotulo}</Label>
                <Input id={`atend-${k}`} inputMode="numeric" placeholder={String(d.config[k])} value={valores[k] ?? ""} onChange={e => setValores(v => ({ ...v, [k]: e.target.value }))} className={inputCls} />
              </div>
            ))}
            <div className="md:col-span-2"><Button type="submit" size="sm" disabled={salvar.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvar.isPending ? "Salvando…" : "Salvar"}</Button></div>
          </form>
          <div className="rounded-lg bg-[#1A2332] p-3 text-sm">
            <p className="font-semibold text-gray-200">Cloudflare Workers AI (transcrição — modelo {d.cloudflare.modelo})</p>
            <p className="text-xs text-gray-300">{d.cloudflare.configurado ? `Account ID terminando em ${d.cloudflare.conta} · API Token terminando em ${d.cloudflare.token}.` : "Account ID e API Token não salvos."}</p>
            <form className="mt-2 grid gap-2 md:grid-cols-2" onSubmit={e => { e.preventDefault(); salvarCf.mutate({ conta, token }); }}>
              <div><Label className="text-gray-300" htmlFor="cf-conta">Account ID</Label><Input id="cf-conta" autoComplete="off" value={conta} onChange={e => setConta(e.target.value)} className={inputCls} /></div>
              <div><Label className="text-gray-300" htmlFor="cf-token">API Token (Workers AI)</Label><Input id="cf-token" type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} className={inputCls} /></div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" size="sm" disabled={salvarCf.isPending || !conta.trim() || !token.trim()} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">Salvar</Button>
                {d.cloudflare.configurado && <Button type="button" size="sm" variant="outline" disabled={removerCf.isPending} onClick={() => { if (window.confirm("Remover as credenciais da Cloudflare? A transcrição é desligada.")) removerCf.mutate(); }}>Remover</Button>}
              </div>
            </form>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
