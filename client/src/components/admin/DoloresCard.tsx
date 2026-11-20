// EPIC-025 (Dolores, etapa 2): WhatsApp da Dolores — só admin. Número do dono (o único que comanda), limites mensais de tokens e o
// interruptor da IA, DESLIGADO por padrão. Etapa 9 (regra do dono de 20/11/2026, "uma conexão só"): a conexão (QR code, Conferir,
// Reativar recebimento, Desconectar) passou para o cartão "WhatsApp da empresa (Dolores e Central)" (WhatsappEmpresaCard).
// Nenhum número completo, chave ou segredo aparece aqui.
// EPIC-024 S-11: o modelo da Dolores é escolhido em Integrações › Anthropic › Modelo por função; aqui só aparece o em uso.
import { useState } from "react";
import { toast } from "sonner";
import { Bot, Info } from "lucide-react";
import { previsaoDoLimite, type PrevisaoDoLimite } from "@shared/dolores/precos-padrao";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inputCls = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
const STATUS: Record<string, string> = { conectado: "conectado", aguardando_qr: "aguardando a leitura do QR code", desconectado: "desconectado" };
const fmt = (n: number) => n.toLocaleString("pt-BR");
const ORIGEM_MODELO: Record<string, string> = {
  funcao: "escolhido para a Dolores em Integrações › Anthropic", anterior: "modelo antigo deste cartão — passe a escolher em Integrações › Anthropic",
  preferencial: "preferencial do painel", padrao: "padrão",
};
const brl = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const digitos = (v: string) => Math.max(0, Math.floor(Number(v.replace(/\D/g, "")) || 0));

/** EPIC-026 C5 — "equivale a até R$ X por mês" (pior caso e só a conversa), com os avisos. Preço sugerido não entra. */
function PrevisaoDoLimiteEmReais({ p, teto }: { p: PrevisaoDoLimite | null; teto: number }) {
  if (!p) return <p className="text-xs text-amber-200 md:col-span-2">Não consegui calcular os limites em reais agora (preços por modelo indisponíveis).</p>;
  return (
    <div className="space-y-1 text-xs md:col-span-2" aria-live="polite">
      {p.piorCaso ? <p className="text-gray-200">Os dois limites juntos equivalem a até <strong>{brl(p.piorCaso.reais ?? 0)} por mês</strong> (pior caso: tudo no modelo mais caro em uso, {p.piorCaso.modelo}{p.piorCaso.fonte === "reserva" ? ", pelo preço de reserva" : ""}).</p>
        : <p className="text-amber-200">Ainda não dá para mostrar em reais: {p.semCotacao ? "falta a cotação do dólar" : "falta o preço dos modelos em uso"} (Integrações › Dolores — operação contínua).</p>}
      {p.daConversa && <p className="text-gray-300">Se for só o modelo da conversa ({p.daConversa.modelo}): {p.daConversa.reais != null ? <>até <strong>{brl(p.daConversa.reais)}</strong></> : "sem preço cadastrado"}.</p>}
      {p.semPreco.length > 0 && <p className="text-amber-200">Sem preço cadastrado: {p.semPreco.join(", ")} — a previsão pode ficar abaixo do real.</p>}
      {p.acimaDoTeto && <p role="alert" className="font-semibold text-red-300">Atenção: o pior caso passa do teto do dono ({brl(teto)} por mês). Diminua os limites.</p>}
      {p.suspeita && <p role="alert" className="text-yellow-200">{p.suspeita}</p>}
    </div>
  );
}

function irParaAnthropic(e: React.MouseEvent) {
  const alvo = document.getElementById("integracao-anthropic");
  if (!alvo) return;
  e.preventDefault();
  alvo.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DoloresCard() {
  const utils = trpc.useUtils();
  const status = trpc.dolores.status.useQuery(undefined, { retry: false });
  const [numeroDono, setNumeroDono] = useState("");
  const [limiteEntrada, setLimiteEntrada] = useState("");
  const [limiteSaida, setLimiteSaida] = useState("");
  const onError = (e: { message: string }) => toast.error(e.message);
  const recarregar = () => utils.dolores.status.invalidate();
  const salvar = trpc.dolores.salvar.useMutation({
    onSuccess: async () => { toast.success("Configuração da Dolores salva."); setNumeroDono(""); setLimiteEntrada(""); setLimiteSaida(""); await recarregar(); },
    onError,
  });
  const ligar = trpc.dolores.ligarIa.useMutation({ onSuccess: async r => { toast.success(r.iaLigada ? "IA da Dolores ligada." : "IA da Dolores desligada."); await recarregar(); }, onError });
  const s = status.data;
  // a mesma conta do servidor, refeita com o que está digitado (campo vazio = o valor salvo)
  const previsao = !s?.previsao ? null : previsaoDoLimite({
    limites: { entrada: limiteEntrada.trim() ? digitos(limiteEntrada) : s.limites.entrada, saida: limiteSaida.trim() ? digitos(limiteSaida) : s.limites.saida },
    modelosEmUso: s.previsao.modelos.emUso, modeloDaConversa: s.previsao.modelos.daConversa,
    tabela: new Map(s.previsao.precosEmUso.filter(x => x.preco).map(x => [x.modelo, x.preco!])), reserva: s.previsao.reserva, cotacao: s.previsao.cotacao, tetoReais: s.tetoDonoReais,
  });

  function enviarConfig(e: React.FormEvent) {
    e.preventDefault();
    const dados: { numeroDono?: string; limiteEntrada?: number; limiteSaida?: number } = {};
    if (numeroDono.trim()) dados.numeroDono = numeroDono.trim();
    if (limiteEntrada.trim()) dados.limiteEntrada = Math.max(0, Math.floor(Number(limiteEntrada.replace(/\D/g, ""))));
    if (limiteSaida.trim()) dados.limiteSaida = Math.max(0, Math.floor(Number(limiteSaida.replace(/\D/g, ""))));
    if (!Object.keys(dados).length) { toast.error("Preencha pelo menos um campo."); return; }
    salvar.mutate(dados);
  }

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Bot className="h-5 w-5" /> Dolores — WhatsApp (funcionária digital)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : status.error ? <p role="alert" className="text-sm text-red-300">{status.error.message}</p> : s && <>
          <div className="grid gap-1 text-sm text-gray-200 md:grid-cols-2">
            <p>WhatsApp da empresa: {s.numeroDolores ?? "—"} ({STATUS[s.statusConexao] ?? s.statusConexao}) — conexão no cartão "WhatsApp da empresa"</p>
            <p>Número do dono (único que comanda): {s.numeroDono ?? "não cadastrado"}</p>
            <p>IA da Dolores: <strong className={s.iaLigada ? "text-green-300" : "text-gray-300"}>{s.iaLigada ? "ligada" : "desligada"}</strong>{s.pausada ? " · pausada" : ""}</p>
            <p>Modelo em uso: {s.modeloEmUso ? <code className="rounded bg-black/30 px-1">{s.modeloEmUso}</code> : "nenhum"}{s.origemModelo ? ` (${ORIGEM_MODELO[s.origemModelo] ?? s.origemModelo})` : ""}{" · "}
              <a href="#integracao-anthropic" onClick={irParaAnthropic} className="text-[#C9A961] underline underline-offset-2 hover:text-[#B8985A]">alterar em Integrações › Anthropic</a></p>
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
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> A Dolores lê o sistema, cria tarefas e registra acompanhamentos; cobranças e documentos esperam a aprovação do dono (fila abaixo). Comandos só do número do dono, por texto. Mensagem de outro número nunca é comando: vai para a Central e, se for cliente cadastrado e o "Dolores responde clientes cadastrados" estiver ligado (desligado por padrão), ela responde só sobre o caso dele. Com a IA desligada, ela responde ao dono só uma frase fixa, sem gastar nada.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={ligar.isPending} className={s.iaLigada ? "bg-red-700 text-white hover:bg-red-800" : "bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]"}
              onClick={() => {
                if (s.iaLigada) { ligar.mutate({ ligada: false }); return; }
                if (window.confirm("Ligar a IA da Dolores? Cada comando do dono pelo WhatsApp passa a consumir créditos da Anthropic, até os limites mensais definidos aqui.")) ligar.mutate({ ligada: true });
              }}>{s.iaLigada ? "Desligar a IA" : "Ligar a IA"}</Button>
          </div>

          <form className="grid gap-3 rounded-lg bg-[#1A2332] p-3 md:grid-cols-2" onSubmit={enviarConfig}>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-dono">Número do dono (DDD + número)</Label>
              <Input id="dolores-dono" inputMode="tel" autoComplete="off" placeholder={s.numeroDono ?? "99 99123-4567"} value={numeroDono} onChange={e => setNumeroDono(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-entrada">Limite mensal — tokens de entrada</Label>
              <Input id="dolores-entrada" inputMode="numeric" placeholder={s.limites.entrada ? fmt(s.limites.entrada) : "0 = bloqueada"} value={limiteEntrada} onChange={e => setLimiteEntrada(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label className="text-gray-300" htmlFor="dolores-saida">Limite mensal — tokens de saída</Label>
              <Input id="dolores-saida" inputMode="numeric" placeholder={s.limites.saida ? fmt(s.limites.saida) : "0 = bloqueada"} value={limiteSaida} onChange={e => setLimiteSaida(e.target.value)} className={inputCls} />
            </div>
            <PrevisaoDoLimiteEmReais p={previsao} teto={s.tetoDonoReais} />
            <p className="text-xs text-gray-400 md:col-span-2">O teto da operação é {brl(s.tetoDonoReais)} por mês. A conta acima usa os preços cadastrados em Integrações › Dolores — operação contínua (US$ por milhão de tokens) e a cotação do dólar, e conta toda a entrada a preço cheio (o pior caso). Ao bater o limite, a IA para e o dono é avisado uma vez no mês.</p>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="submit" size="sm" disabled={salvar.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvar.isPending ? "Salvando…" : "Salvar"}</Button>
              <Button type="button" size="sm" variant="outline" disabled={salvar.isPending} className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10"
                onClick={() => salvar.mutate({ limiteEntrada: s.limitesPadrao.entrada, limiteSaida: s.limitesPadrao.saida })}>
                Usar o padrão ({fmt(s.limitesPadrao.entrada)} / {fmt(s.limitesPadrao.saida)})</Button>
            </div>
          </form>
        </>}
      </CardContent>
    </Card>
  );
}
