// EPIC-025 (Dolores, etapa 2): WhatsApp da Dolores — só admin. Conexão própria por QR code (número dela, separado do
// da Central de Vendas), número do dono (o único que comanda), limites mensais de tokens e o interruptor da IA,
// DESLIGADO por padrão. Nenhum número completo, chave ou segredo aparece aqui.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Info, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const inputCls = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
const STATUS: Record<string, string> = { conectado: "conectado", aguardando_qr: "aguardando a leitura do QR code", desconectado: "desconectado" };
const fmt = (n: number) => n.toLocaleString("pt-BR");

export function DoloresCard() {
  const utils = trpc.useUtils();
  const status = trpc.dolores.status.useQuery(undefined, { retry: false });
  const [qr, setQr] = useState<string | null>(null);
  const [numeroDono, setNumeroDono] = useState("");
  const [limiteEntrada, setLimiteEntrada] = useState("");
  const [limiteSaida, setLimiteSaida] = useState("");
  const [modelo, setModelo] = useState("");
  const onError = (e: { message: string }) => toast.error(e.message);
  const recarregar = () => utils.dolores.status.invalidate();
  const conexao = trpc.dolores.statusConexao.useQuery(undefined, { enabled: Boolean(qr), refetchInterval: 4000, retry: false });
  useEffect(() => {
    if (conexao.data?.status === "conectado") { setQr(null); toast.success("Número da Dolores conectado."); void recarregar(); }
    if (conexao.error) { setQr(null); toast.error(conexao.error.message); void recarregar(); }
  }, [conexao.data?.status, conexao.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const conectar = trpc.dolores.conectar.useMutation({ onSuccess: r => { if (r.qrCode) setQr(r.qrCode); else { toast.success("Número da Dolores já conectado."); void conexao.refetch(); void recarregar(); } }, onError });
  const desconectar = trpc.dolores.desconectar.useMutation({ onSuccess: async () => { toast.success("Número da Dolores desconectado."); setQr(null); await recarregar(); }, onError });
  const avisos = trpc.dolores.ativarAvisos.useMutation({ onSuccess: r => toast.success(r.mensagem), onError });
  const salvar = trpc.dolores.salvar.useMutation({
    onSuccess: async () => { toast.success("Configuração da Dolores salva."); setNumeroDono(""); setLimiteEntrada(""); setLimiteSaida(""); setModelo(""); await recarregar(); },
    onError,
  });
  const ligar = trpc.dolores.ligarIa.useMutation({ onSuccess: async r => { toast.success(r.iaLigada ? "IA da Dolores ligada." : "IA da Dolores desligada."); await recarregar(); }, onError });
  const s = status.data;

  function enviarConfig(e: React.FormEvent) {
    e.preventDefault();
    const dados: { numeroDono?: string; limiteEntrada?: number; limiteSaida?: number; modelo?: string | null } = {};
    if (numeroDono.trim()) dados.numeroDono = numeroDono.trim();
    if (limiteEntrada.trim()) dados.limiteEntrada = Math.max(0, Math.floor(Number(limiteEntrada.replace(/\D/g, ""))));
    if (limiteSaida.trim()) dados.limiteSaida = Math.max(0, Math.floor(Number(limiteSaida.replace(/\D/g, ""))));
    if (modelo.trim()) dados.modelo = modelo.trim() === "-" ? null : modelo.trim();
    if (!Object.keys(dados).length) { toast.error("Preencha pelo menos um campo."); return; }
    salvar.mutate(dados);
  }

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Bot className="h-5 w-5" /> Dolores — WhatsApp (funcionária digital)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : status.error ? <p role="alert" className="text-sm text-red-300">{status.error.message}</p> : s && <>
          <div className="grid gap-1 text-sm text-gray-200 md:grid-cols-2">
            <p>Número da Dolores: {s.numeroDolores ?? "—"} ({STATUS[s.statusConexao] ?? s.statusConexao})</p>
            <p>Número do dono (único que comanda): {s.numeroDono ?? "não cadastrado"}</p>
            <p>IA da Dolores: <strong className={s.iaLigada ? "text-green-300" : "text-gray-300"}>{s.iaLigada ? "ligada" : "desligada"}</strong>{s.pausada ? " · pausada" : ""}</p>
            <p>Modelo em uso: {s.modeloEmUso ? <code className="rounded bg-black/30 px-1">{s.modeloEmUso}</code> : "nenhum"}{s.modelo ? " (da Dolores)" : s.modeloEmUso ? " (preferencial do painel)" : ""}</p>
            <p>Uso em {s.mes}: {fmt(s.uso.entrada)} / {s.limites.entrada ? fmt(s.limites.entrada) : "sem limite"} tokens de entrada</p>
            <p>{fmt(s.uso.saida)} / {s.limites.saida ? fmt(s.limites.saida) : "sem limite"} tokens de saída{s.bloqueioDoLimite === "limite_mensal" ? " — limite atingido" : ""}</p>
          </div>
          {s.pendencias.length > 0 && (
            <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-2 text-xs text-yellow-100">
              <p className="font-semibold">Para a Dolores responder pelo WhatsApp falta:</p>
              <ul className="ml-4 list-disc">{s.pendencias.map(p => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <p className="flex items-start gap-2 rounded-lg border border-[#C9A961]/30 bg-[#C9A961]/10 p-2 text-xs text-gray-200">
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> A Dolores só lê o sistema (etapa 2). Ela responde apenas ao número do dono; mensagem de outro número é ignorada e registrada. Com a IA desligada, ela responde só uma frase fixa, sem gastar nada.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className={botaoSec} disabled={conectar.isPending} onClick={() => conectar.mutate()}>
              {conectar.isPending ? "Gerando…" : s.statusConexao === "conectado" ? "Conferir conexão" : "Conectar o número da Dolores (QR code)"}
            </Button>
            {s.instancia && <Button size="sm" variant="outline" className={botaoSec} disabled={avisos.isPending} onClick={() => avisos.mutate()}>Reativar recebimento</Button>}
            {s.instancia && <Button size="sm" variant="outline" className={botaoSec} disabled={desconectar.isPending}
              onClick={() => { if (window.confirm("Desconectar o número da Dolores? Ela deixa de receber os comandos até conectar de novo.")) desconectar.mutate(); }}>Desconectar</Button>}
            <Button size="sm" disabled={ligar.isPending} className={s.iaLigada ? "bg-red-700 text-white hover:bg-red-800" : "bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]"}
              onClick={() => {
                if (s.iaLigada) { ligar.mutate({ ligada: false }); return; }
                if (window.confirm("Ligar a IA da Dolores? Cada comando do dono pelo WhatsApp passa a consumir créditos da Anthropic, até os limites mensais definidos aqui.")) ligar.mutate({ ligada: true });
              }}>{s.iaLigada ? "Desligar a IA" : "Ligar a IA"}</Button>
          </div>

          {qr && (
            <div className="rounded-lg bg-white p-3 text-center text-sm text-gray-800">
              <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR code para conectar o WhatsApp da Dolores" className="mx-auto h-56 w-56" />
              <p className="mt-2">No celular DA DOLORES: WhatsApp › Aparelhos conectados › Conectar aparelho. {conexao.isFetching && <Loader2 className="inline h-3 w-3 animate-spin" />}</p>
              <p className="text-xs text-gray-500">Não use o número da empresa nem o do dono.</p>
            </div>
          )}

          <form className="grid gap-3 rounded-lg bg-[#1A2332] p-3 md:grid-cols-2" onSubmit={enviarConfig}>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-dono">Número do dono (DDD + número)</Label>
              <Input id="dolores-dono" inputMode="tel" autoComplete="off" placeholder={s.numeroDono ?? "99 99123-4567"} value={numeroDono} onChange={e => setNumeroDono(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-modelo">Modelo próprio (vazio = preferencial do painel; "-" limpa)</Label>
              <Input id="dolores-modelo" autoComplete="off" placeholder={s.modelo ?? s.modeloPainel ?? "id do modelo"} value={modelo} onChange={e => setModelo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-entrada">Limite mensal — tokens de entrada</Label>
              <Input id="dolores-entrada" inputMode="numeric" placeholder={s.limites.entrada ? fmt(s.limites.entrada) : "0 = bloqueada"} value={limiteEntrada} onChange={e => setLimiteEntrada(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-saida">Limite mensal — tokens de saída</Label>
              <Input id="dolores-saida" inputMode="numeric" placeholder={s.limites.saida ? fmt(s.limites.saida) : "0 = bloqueada"} value={limiteSaida} onChange={e => setLimiteSaida(e.target.value)} className={inputCls} />
            </div>
            <p className="text-xs text-gray-400 md:col-span-2">O teto da operação é R$ 1.621 por mês: converta em tokens pelo preço do modelo escolhido na página de preços da Anthropic (passo a passo em docs/dolores/como-ligar.md). Ao bater o limite, a IA para e o dono é avisado uma vez no mês.</p>
            <div className="md:col-span-2"><Button type="submit" size="sm" disabled={salvar.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvar.isPending ? "Salvando…" : "Salvar"}</Button></div>
          </form>
        </>}
      </CardContent>
    </Card>
  );
}
