// EPIC-025 E9 (regra do dono de 20/11/2026: "eu quero uma conexão só") — a conexão ÚNICA do WhatsApp da empresa, só admin.
// O mesmo número serve a Dolores e a Central (Conversas, Enviar mensagem, Templates). Reaproveita a instância que já existe
// (`prospecta-dolores`): conectada, não pede QR de novo. Os campos da Dolores (número do dono, limites, IA) ficam no cartão dela.
// Nenhum número completo, chave ou segredo aparece aqui.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2, Smartphone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const STATUS: Record<string, string> = { conectado: "conectado", aguardando_qr: "aguardando a leitura do QR code", desconectado: "desconectado" };

export function WhatsappEmpresaCard() {
  const utils = trpc.useUtils();
  const status = trpc.dolores.status.useQuery(undefined, { retry: false });
  const [qr, setQr] = useState<string | null>(null);
  const onError = (e: { message: string }) => toast.error(e.message);
  const recarregar = () => Promise.all([utils.dolores.status.invalidate(), utils.whatsapp.minhaConexao.invalidate()]);
  // A consulta só lê a situação; conferir o número e ligar o aviso de mensagens é a mutação confirmarConexao.
  const conexao = trpc.dolores.statusConexao.useQuery(undefined, { enabled: Boolean(qr), refetchInterval: 4000, retry: false });
  const confirmar = trpc.dolores.confirmarConexao.useMutation({
    onSuccess: async r => { setQr(null); if (r.status === "conectado") toast.success("WhatsApp da empresa conectado."); await recarregar(); },
    onError: async e => { setQr(null); toast.error(e.message); await recarregar(); },
  });
  useEffect(() => {
    if (conexao.data?.status === "conectado" && !confirmar.isPending) confirmar.mutate();
    if (conexao.error) { setQr(null); toast.error(conexao.error.message); void recarregar(); }
  }, [conexao.data?.status, conexao.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const conectar = trpc.dolores.conectar.useMutation({ onSuccess: r => { if (r.qrCode) setQr(r.qrCode); else confirmar.mutate(); }, onError });
  const desconectar = trpc.dolores.desconectar.useMutation({ onSuccess: async () => { toast.success("WhatsApp da empresa desconectado."); setQr(null); await recarregar(); }, onError });
  const avisos = trpc.dolores.ativarAvisos.useMutation({ onSuccess: r => toast.success(r.mensagem), onError });
  // QA-SEG E9 achado 2: a conexão da Central de ANTES da conexão única (QR feito em "Minha conexão" por admin/colaborador)
  const antiga = trpc.dolores.conexaoAntiga.useQuery(undefined, { retry: false });
  const removerAntiga = trpc.dolores.removerConexaoAntiga.useMutation({
    onSuccess: async r => { toast.success(r.removidas ? "Conexão antiga da Central removida." : "Não havia conexão antiga da Central."); await Promise.all([utils.dolores.conexaoAntiga.invalidate(), recarregar()]); },
    onError,
  });
  const s = status.data;

  return (
    <Card id="whatsapp-empresa" className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Smartphone className="h-5 w-5" /> WhatsApp da empresa (Dolores e Central)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : status.error ? <p role="alert" className="text-sm text-red-300">{status.error.message}</p> : s && <>
          <p className="text-sm text-gray-200">Número da empresa: {s.numeroDolores ?? "—"} (<strong className={s.statusConexao === "conectado" ? "text-green-300" : "text-gray-300"}>{STATUS[s.statusConexao] ?? s.statusConexao}</strong>)</p>
          <p className="flex items-start gap-2 rounded-lg border border-[#C9A961]/30 bg-[#C9A961]/10 p-2 text-xs text-gray-200">
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> Uma conexão só: este número atende a Dolores (comandos do dono, grupos e clientes cadastrados) e a Central WhatsApp (Conversas, Enviar mensagem, Templates). A conversa do dono com a Dolores e os grupos nunca aparecem na Central. Os corretores continuam conectando o próprio número na Central › Minha conexão.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className={botaoSec} disabled={conectar.isPending} onClick={() => conectar.mutate()}>
              {conectar.isPending ? "Gerando…" : s.statusConexao === "conectado" ? "Conferir conexão" : "Conectar o número da empresa (QR code)"}
            </Button>
            {s.instancia && <Button size="sm" variant="outline" className={botaoSec} disabled={avisos.isPending} onClick={() => avisos.mutate()}>Reativar recebimento</Button>}
            {s.instancia && <Button size="sm" variant="outline" className={botaoSec} disabled={desconectar.isPending}
              onClick={() => { if (window.confirm("Desconectar o WhatsApp da empresa? A Dolores e a Central deixam de receber e enviar até conectar de novo (será preciso ler o QR code).")) desconectar.mutate(); }}>Desconectar</Button>}
          </div>
          {antiga.data?.existe && (
            <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-gray-200">
              <p>Ainda existe a conexão antiga da Central ({antiga.data.conexoes.map(c => `${c.numero ?? "número não informado"}, ${STATUS[c.status] ?? c.status}`).join("; ")}). Ela não grava mais nada na Central, mas continua no servidor do WhatsApp: remova-a para o mesmo número não ficar em duas conexões.</p>
              <Button size="sm" variant="outline" className={botaoSec} disabled={removerAntiga.isPending}
                onClick={() => { if (window.confirm("Remover a conexão antiga da Central? Ela é desligada no servidor do WhatsApp e apagada; o histórico das conversas continua. A conexão da empresa (esta acima) não é tocada.")) removerAntiga.mutate(); }}>
                {removerAntiga.isPending ? "Removendo…" : "Remover a conexão antiga da Central"}
              </Button>
            </div>
          )}
          <p className="text-xs text-gray-400">"Reativar recebimento" registra de novo o aviso de mensagens, grupos e LIGAÇÕES na Evolution (necessário uma vez depois desta atualização, para o aviso de ligação funcionar). Não desconecta nada.</p>
          <RecebimentoUltimas24h />
          {qr && (
            <div className="rounded-lg bg-white p-3 text-center text-sm text-gray-800">
              <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR code para conectar o WhatsApp da empresa" className="mx-auto h-56 w-56" />
              <p className="mt-2">No celular da EMPRESA: WhatsApp › Aparelhos conectados › Conectar aparelho. {conexao.isFetching && <Loader2 className="inline h-3 w-3 animate-spin" />}</p>
              <p className="text-xs text-gray-500">Não use o número do dono (ele é quem escreve para a Dolores).</p>
            </div>
          )}
        </>}
      </CardContent>
    </Card>
  );
}

/** Motivos do registro do recebimento em português (o código grava só o motivo curto, sem conteúdo). */
const MOTIVOS: Record<string, string> = {
  "instancia-desconhecida": "aviso de outra instância",
  "evento-nao-tratado": "evento que o sistema não trata",
  status: "status/lista de transmissão",
  sem_id: "sem identificador da mensagem",
  outro_destino: "endereço em forma desconhecida",
  reacao: "reação", edicao: "edição ou apagamento", interacao: "fixação, enquete ou botão",
  "propria-numero": "do próprio número da empresa", "lid-do-dono": "do dono, sem número no aviso (não é comando)",
  "nao-autorizado": "remetente sem permissão", "sem-numero": "sem número conferível",
};
const ENDERECOS: Record<string, string> = { numero: "com número", lid: "@lid (sem número)", grupo: "grupo", status: "status", vazio: "sem endereço", outro: "endereço desconhecido" };

/**
 * EPIC-026 C2 (regra do dono de 20/11/2026: nenhuma mensagem some sem registro) — o que chegou ao webhook da empresa nas últimas
 * 24 h e o destino de cada item. Só contagens: nenhum texto, número ou nome. Só admin (o servidor confere o papel).
 */
function RecebimentoUltimas24h() {
  const [aberto, setAberto] = useState(false);
  const r = trpc.dolores.recebimento.useQuery(undefined, { enabled: aberto, retry: false, refetchInterval: aberto ? 15_000 : false });
  const d = r.data;
  return (
    <div className="rounded-lg border border-white/10 p-2 text-xs text-gray-200">
      <button type="button" className="font-semibold text-[#C9A961] underline" onClick={() => setAberto(a => !a)} aria-expanded={aberto}>
        Recebimento nas últimas 24 h {aberto ? "▲" : "▼"}
      </button>
      {aberto && (r.isLoading ? <p className="mt-2 text-gray-300">Carregando…</p> : r.error ? <p role="alert" className="mt-2 text-red-300">{r.error.message}</p> : d && (
        <div className="mt-2 space-y-1">
          <p>Chegaram ao sistema: <strong>{d.chegaram}</strong> aviso(s), dos quais <strong>{d.mensagens.total}</strong> mensagem(ns)
            {d.mensagens.total > 0 && <> ({Object.entries(d.mensagens.porEndereco).map(([k, v]) => `${v} ${ENDERECOS[k] ?? k}`).join(", ")})</>}.</p>
          <ul className="list-disc pl-5">
            <li>Foram para a Central: <strong>{d.central}</strong>{d.centralSemNumero > 0 && <> (+ <strong>{d.centralSemNumero}</strong> de número não identificado)</>}</li>
            <li>Foram para a Dolores (comandos do dono): <strong>{d.dolores}</strong></li>
            <li>De grupos: <strong>{d.grupos}</strong> · enviadas pelo número da empresa: <strong>{d.enviadasPelaEmpresa}</strong></li>
            <li>Repetidas (reentrega, sem duplicar): <strong>{d.repetidas}</strong> · com erro: <strong className={d.erros ? "text-red-300" : ""}>{d.erros}</strong>
              {d.semDesfecho > 0 && <> · sem desfecho registrado: <strong className="text-red-300">{d.semDesfecho}</strong></>}</li>
            <li>Outros avisos (conexão, situação de envio, ligação, grupo): <strong>{d.outrosEventos}</strong></li>
          </ul>
          <p>Ignoradas: <strong>{d.ignoradas.reduce((s, i) => s + i.total, 0)}</strong></p>
          {d.ignoradas.length > 0 && (
            <ul className="list-disc pl-5">
              {d.ignoradas.map(i => <li key={`${i.evento}-${i.motivo}-${i.endereco}`}>{i.total} × {MOTIVOS[i.motivo] ?? (i.motivo || "sem motivo")}{i.endereco ? ` (${ENDERECOS[i.endereco] ?? i.endereco})` : ""}{i.evento !== "messages.upsert" ? ` — ${i.evento}` : ""}</li>)}
            </ul>
          )}
          {d.chegaram === 0 && <p className="text-amber-200">Nada chegou nas últimas 24 h: se alguém escreveu para o número da empresa, o aviso não saiu da Evolution (confira a conexão e use "Reativar recebimento").</p>}
          <p className="text-gray-400">Contagem desde {d.desde.replace("T", " ")}h (UTC). Só números: nenhum texto, telefone ou nome é guardado.</p>
        </div>
      ))}
    </div>
  );
}
