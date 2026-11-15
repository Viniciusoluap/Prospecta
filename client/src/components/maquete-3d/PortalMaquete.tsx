// Maquete 3D (EPIC-022, etapa 3) — área do cliente no portal: ver os próprios projetos, pedir a maquete 3D,
// pagar pelo Asaas (PIX, boleto ou cartão) e, depois da validação da equipe, abrir o link para andar pela casa.
import { useState } from "react";
import { Box, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import type { FaixaPreco, StatusMaquete } from "@shared/maquete-3d/regras";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Como o cliente lê cada situação do pedido. */
const SITUACAO: Record<StatusMaquete, string> = {
  aguardando_aprovacao: "Pedido enviado — aguardando a aprovação da nossa equipe", aguardando_pagamento: "Aprovado — aguardando o seu pagamento", aguardando_autorizacao: "Em análise", liberada: "Pagamento confirmado — na fila de produção",
  em_leitura: "Em produção", em_revisao: "Em produção — conferência da planta", validada: "Quase pronta — em validação final",
  publicada: "Pronta", recusada: "Pedido não aceito",
};
type Cobranca = { id: string; link: string | null; pixImagem: string | null; pixCopiaCola: string | null };
type Metodo = "pix" | "boleto" | "cartao";

function Pagamento({ cobranca }: { cobranca: Cobranca }) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-slate-800">
      <p className="font-semibold">Falta só o pagamento. Assim que ele for confirmado, a sua maquete entra em produção.</p>
      {cobranca.pixImagem && <img src={`data:image/png;base64,${cobranca.pixImagem}`} alt="QR Code do PIX" className="h-44 w-44 rounded bg-white p-1" />}
      {cobranca.pixCopiaCola && (
        <Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(cobranca.pixCopiaCola!).then(() => toast.success("Código PIX copiado.")); }}>
          <Copy className="mr-2 h-4 w-4" />Copiar o código PIX
        </Button>
      )}
      {cobranca.link && <a href={cobranca.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 underline"><ExternalLink className="h-4 w-4" />Abrir a página de pagamento</a>}
    </div>
  );
}

export function PortalMaquete() {
  const utils = trpc.useUtils();
  const resumo = trpc.portalMaquete.resumo.useQuery();
  const [faixas, setFaixas] = useState<Record<number, FaixaPreco>>({});
  const [metodo, setMetodo] = useState<Metodo>("pix");
  const [cobrancas, setCobrancas] = useState<Record<number, Cobranca>>({});
  const solicitar = trpc.portalMaquete.solicitar.useMutation({
    onSuccess: () => { toast.success("Pedido enviado. Avisamos por e-mail assim que for aprovado."); void utils.portalMaquete.resumo.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const pagar = trpc.portalMaquete.pagar.useMutation({
    onSuccess: (r, v) => { setCobrancas(c => ({ ...c, [v.id]: r.cobranca })); },
    onError: e => toast.error(e.message),
  });

  if (resumo.isLoading) return <p className="text-sm text-slate-500">Carregando…</p>;
  if (resumo.error) return <p className="text-sm text-red-600">{resumo.error.message}</p>;
  const dados = resumo.data!;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Veja a sua casa em 3D antes de construir: decorada, com iluminação de manhã, no pôr do sol e à noite, e ande por dentro dos cômodos no computador ou no celular.</p>
      {dados.projetos.length === 0 && dados.avulsas.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">Você ainda não tem projeto cadastrado. Quando o seu projeto estiver com a nossa equipe, a maquete 3D aparece aqui.</p>}
      {[...dados.avulsas.map(a => ({ id: -a.id, nome: a.titulo.replace(/^Maquete 3D — /, ""), temPdf: true, maquete: a as typeof a | null, semProjeto: true })),
        ...dados.projetos.map(p => ({ ...p, semProjeto: false }))].map(p => {
        const m = p.maquete, cobranca = m ? cobrancas[m.id] : undefined, faixa = faixas[p.id] ?? dados.precos[0].faixa;
        // Pedido criado pela equipe sem projeto cadastrado: o cliente acompanha e paga, mas não pede de novo por aqui.
        const podePedir = !p.semProjeto && (!m || m.status === "recusada");
        return (
          <Card key={p.id}>
            <CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base"><Box className="h-5 w-5 text-amber-600" />{p.nome}{m && <Badge variant={m.status === "publicada" ? "default" : "secondary"}>{SITUACAO[m.status]}</Badge>}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {m?.status === "publicada" && m.link && (
                <a href={m.link} target="_blank" rel="noreferrer"><Button type="button" size="lg"><Box className="mr-2 h-5 w-5" />Abrir a minha maquete 3D</Button></a>
              )}
              {m?.status === "recusada" && <p className="text-red-600">Não foi possível produzir a maquete{m.recusaMotivo ? `: ${m.recusaMotivo}` : "."} Fale com a nossa equipe{p.semProjeto ? "." : "; você pode pedir de novo abaixo."}</p>}
              {m?.status === "aguardando_aprovacao" && (
                <p className="text-slate-600">Recebemos o seu pedido{m.preco !== null ? ` (${reais(m.preco)})` : ""}. A nossa equipe confere o projeto e aprova; depois disso o pagamento é liberado aqui e você é avisado por e-mail.</p>
              )}
              {m && m.status !== "publicada" && m.status !== "recusada" && m.status !== "aguardando_pagamento" && m.status !== "aguardando_aprovacao" && (
                <p className="text-slate-600">Recebemos o seu pagamento{m.pagoEm ? ` em ${new Date(m.pagoEm).toLocaleDateString("pt-BR")}` : ""}. A nossa equipe está preparando e conferindo a maquete; quando ficar pronta, o botão para abrir aparece aqui.</p>
              )}
              {m?.status === "aguardando_pagamento" && (
                cobranca ? <Pagamento cobranca={cobranca} /> : (
                  <div className="flex flex-wrap items-end gap-3">
                    <span>Pedido aprovado. Valor: <strong>{m.preco !== null ? reais(m.preco) : "—"}</strong></span>
                    <label className="block">Forma de pagamento
                      <select className="mt-1 block h-10 rounded-md border px-2" value={metodo} onChange={e => setMetodo(e.target.value as Metodo)}>
                        <option value="pix">PIX</option><option value="boleto">Boleto</option><option value="cartao">Cartão de crédito</option>
                      </select></label>
                    <Button type="button" size="lg" disabled={pagar.isPending} onClick={() => pagar.mutate({ id: m.id, metodo })}>Pagar agora</Button>
                  </div>
                )
              )}
              {podePedir && (
                p.temPdf ? (
                  <div className="space-y-3">
                    <fieldset className="space-y-2">
                      <legend className="font-medium">Qual é o tamanho da sua casa?</legend>
                      {dados.precos.map(f => (
                        <label key={f.faixa} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50">
                          <span className="flex items-center gap-2"><input type="radio" name={`faixa-${p.id}`} checked={faixa === f.faixa} onChange={() => setFaixas(x => ({ ...x, [p.id]: f.faixa }))} />{f.rotulo}</span>
                          <strong>{reais(f.preco)}</strong>
                        </label>
                      ))}
                    </fieldset>
                    <Button type="button" size="lg" disabled={solicitar.isPending} onClick={() => solicitar.mutate({ projectId: p.id, faixaPreco: faixa })}>Pedir a minha maquete 3D</Button>
                    <p className="text-xs text-slate-500">A nossa equipe confere o tamanho com o projeto e aprova o pedido; só então o pagamento é liberado. A maquete é entregue aqui no portal e por e-mail.</p>
                  </div>
                ) : <p className="text-slate-500">O PDF deste projeto ainda não está cadastrado. Assim que a nossa equipe incluir, você poderá pedir a maquete 3D aqui.</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
