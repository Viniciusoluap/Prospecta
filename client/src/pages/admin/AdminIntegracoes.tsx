// LOTE B (25/10): Configurações › Integrações — Asaas, Pluggy e WhatsApp (Evolution) num lugar só.
// Cada bloco testa ao abrir e no botão Testar (mensagem real do serviço), mostra só os 4 últimos
// caracteres da chave salva e permite trocar (o servidor valida antes de salvar).
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Copy, Loader2, Plug, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubPciAtual } from "@/components/admin/SubPciAtual";

type Servico = "asaas" | "pluggy" | "whatsapp";
type Campo = { nome: string; rotulo: string; segredo?: boolean; placeholder?: string; opcional?: boolean };

const campoCls = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";

function useTeste(servico: Servico) {
  return trpc.integracoes.testar.useQuery({ servico }, { retry: false, refetchOnWindowFocus: false });
}

function Status({ teste }: { teste: ReturnType<typeof useTeste> }) {
  if (teste.isFetching) return <p className="flex items-center gap-2 text-sm text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /> Testando…</p>;
  if (teste.error) return <p className="flex items-start gap-2 text-sm text-red-300"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /> Erro: {teste.error.message}</p>;
  if (!teste.data) return null;
  return teste.data.ok
    ? <p className="flex items-start gap-2 text-sm text-green-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Conectado — {teste.data.mensagem}</p>
    : <p className="flex items-start gap-2 text-sm text-red-300"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /> Erro — {teste.data.mensagem}</p>;
}

function Bloco({ titulo, servico, salvo, extra, campos, salvando, onSalvar }: {
  titulo: string;
  servico: Servico;
  salvo: ReactNode;
  extra?: ReactNode;
  campos: Campo[];
  salvando: boolean;
  onSalvar: (valores: Record<string, string>) => Promise<unknown>;
}) {
  const teste = useTeste(servico);
  const [trocando, setTrocando] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const preenchido = campos.some(c => valores[c.nome]?.trim()) && campos.every(c => c.opcional || valores[c.nome]?.trim());

  async function salvar() {
    try {
      await onSalvar(valores);
      setValores({});
      setTrocando(false);
      await teste.refetch();
    } catch { /* o toast de erro vem do onError da mutação */ }
  }

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">{titulo}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Status teste={teste} />
        <div className="text-sm text-gray-300">{salvo}</div>
        {extra}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className={botaoSec} disabled={teste.isFetching} onClick={() => teste.refetch()}>Testar</Button>
          <Button size="sm" variant="outline" className={botaoSec} onClick={() => { setTrocando(t => !t); setValores({}); }}>{trocando ? "Cancelar" : "Trocar"}</Button>
        </div>
        {trocando && (
          <form className="space-y-3 rounded-lg bg-[#1A2332] p-3" onSubmit={e => { e.preventDefault(); void salvar(); }}>
            {campos.map(c => (
              <div key={c.nome}>
                <Label className="text-gray-300">{c.rotulo}{c.opcional ? " (opcional)" : ""}</Label>
                <Input type={c.segredo ? "password" : "text"} autoComplete="off" placeholder={c.placeholder} value={valores[c.nome] ?? ""}
                  onChange={e => setValores(v => ({ ...v, [c.nome]: e.target.value }))} className={campoCls} />
              </div>
            ))}
            <Button type="submit" size="sm" disabled={!preenchido || salvando} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">
              {salvando ? "Validando…" : "Validar e salvar"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const FONTE = (f: "env" | "banco" | null) => (f === "env" ? " (variável de ambiente do servidor)" : f === "banco" ? " (salva nesta tela)" : "");

export default function AdminIntegracoes() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.integracoes.status.useQuery();
  const aposSalvar = (msg: string) => async () => { toast.success(msg); await utils.integracoes.status.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);
  const salvarAsaas = trpc.integracoes.salvarAsaas.useMutation({ onSuccess: aposSalvar("Asaas salvo."), onError });
  const webhookAsaas = trpc.integracoes.verificarWebhookAsaas.useQuery(undefined, { enabled: false, retry: false });
  const recuperarWebhook = trpc.integracoes.recuperarWebhookAsaas.useMutation({
    onSuccess: async result => { toast.success(result.mensagem); await webhookAsaas.refetch(); }, onError,
  });
  const salvarPluggy = trpc.integracoes.salvarPluggy.useMutation({ onSuccess: aposSalvar("Pluggy salva."), onError });
  const salvarEvolution = trpc.integracoes.salvarEvolution.useMutation({ onSuccess: aposSalvar("Servidor do WhatsApp salvo."), onError });

  const asaas = status?.asaas;
  const pluggy = status?.pluggy;
  const whatsapp = status?.whatsapp;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {/* Pedido de 25/10 (noite), item 13: Voltar leva ao Painel. */}
          <Link href="/admin"><Button variant="ghost" size="icon" aria-label="Voltar ao Painel"><ArrowLeft /></Button></Link>
          <Plug className="text-[#C9A961]" />
          <div>
            <h1 className="text-2xl font-bold text-[#C9A961]">Integrações</h1>
            <p className="text-sm text-gray-400">Asaas, Pluggy e WhatsApp — cada chave fica salva só aqui.</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        {isLoading || !status ? <p className="text-gray-300">Carregando…</p> : <>
          <Bloco
            titulo="Asaas — cobranças e conta Asaas do BPO"
            servico="asaas"
            salvo={<>
              <p>{asaas?.configurado ? `Chave salva terminando em ${asaas.final}${FONTE(asaas.fonte)} — ambiente ${asaas.ambiente === "production" ? "produção" : "sandbox"}.` : "Nenhuma chave de API salva."}</p>
              {asaas?.fonte === "env" && <p className="text-yellow-200">A chave em uso vem da variável ASAAS_API_KEY do servidor e tem precedência{asaas.salvaNoBancoIgnorada ? " — a chave salva nesta tela está sendo ignorada" : ""}.</p>}
              <p>{asaas?.webhookConfigurado ? `Token do webhook terminando em ${asaas.webhookFinal}${FONTE(asaas.webhookFonte)}.` : "Token do webhook não salvo (os avisos de pagamento do Asaas serão recusados)."}</p>
            </>}
            extra={asaas && (
              <div className="rounded-lg border border-[#C9A961]/30 bg-[#C9A961]/10 p-3 text-sm">
                <p className="font-semibold">URL do webhook para cadastrar no Asaas:</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-black/30 px-2 py-1">{asaas.webhookUrl}</code>
                  <Button type="button" size="sm" variant="outline" className={botaoSec}
                    onClick={() => { void navigator.clipboard.writeText(asaas.webhookUrl); toast.success("URL copiada!"); }}>
                    <Copy className="mr-1 h-3 w-3" /> Copiar
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-300">No Asaas: Integrações › Webhooks, use o mesmo token salvo aqui. O ambiente (produção/sandbox) é reconhecido pela chave ($aact_prod… = produção).</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" className={botaoSec} disabled={webhookAsaas.isFetching || recuperarWebhook.isPending} onClick={() => void webhookAsaas.refetch()}>Verificar webhook</Button>
                  <Button type="button" size="sm" variant="outline" className={botaoSec} disabled={webhookAsaas.isFetching || recuperarWebhook.isPending || !asaas.webhookConfigurado} onClick={() => {
                    if (window.confirm("Conferir o endpoint e atualizar somente o webhook deste sistema com a URL e o token salvos, ativando a fila? Os eventos pendentes poderão ser reenviados.")) recuperarWebhook.mutate();
                  }}>{recuperarWebhook.isPending ? "Recuperando…" : "Recuperar sincronização"}</Button>
                </div>
                {webhookAsaas.error && <p role="alert" className="mt-2 text-red-300">{webhookAsaas.error.message}</p>}
                {webhookAsaas.data && <div role="status" className="mt-2 space-y-1">
                  <p>{webhookAsaas.data.mensagem}</p>
                  {!webhookAsaas.data.encontrado && <div className="text-xs text-gray-300">
                    <p>Webhooks consultados nesta conta: {webhookAsaas.data.totalWebhooks}. Confira os destinos abaixo; nenhuma configuração foi alterada.</p>
                    <ul className="mt-1 space-y-1">{webhookAsaas.data.destinos.map((destino, index) => <li key={index} className="break-all">{destino.nome}: {destino.endereco}</li>)}</ul>
                    {webhookAsaas.data.totalWebhooks > webhookAsaas.data.destinos.length && <p>Exibindo os primeiros {webhookAsaas.data.destinos.length} destinos.</p>}
                  </div>}
                  {webhookAsaas.data.encontrado && <p>Ambiente: {webhookAsaas.data.ambiente}. URL: {webhookAsaas.data.urlCorreta ? "correta" : "precisa atualizar"}. Token: {webhookAsaas.data.tokenConfere === null ? "não informado pelo provedor" : webhookAsaas.data.tokenConfere ? "confere" : "divergente"}. Fila: {webhookAsaas.data.interrompido ? "interrompida" : "ativa"}. Webhook: {webhookAsaas.data.ativo ? "habilitado" : "desabilitado"}.</p>}
                </div>}
              </div>
            )}
            campos={[
              { nome: "apiKey", rotulo: "Nova chave de API", segredo: true, placeholder: "$aact_prod_...", opcional: true },
              { nome: "webhookToken", rotulo: "Novo token do webhook", segredo: true, opcional: true },
            ]}
            salvando={salvarAsaas.isPending}
            onSalvar={v => salvarAsaas.mutateAsync({ apiKey: v.apiKey?.trim() || undefined, webhookToken: v.webhookToken?.trim() || undefined })}
          />

          <Bloco
            titulo="Pluggy — contas do Meu Pluggy no BPO"
            servico="pluggy"
            salvo={<p>{pluggy?.configurado ? `Client ID terminando em ${pluggy.clientIdFinal} · Client Secret terminando em ${pluggy.secretFinal}.` : "Client ID e Client Secret não salvos."}</p>}
            extra={<p className="text-xs text-gray-300">Conectar as contas do banco: BPO › Bancos › “Conectar conta Pluggy”.</p>}
            campos={[
              { nome: "clientId", rotulo: "Client ID", segredo: true },
              { nome: "clientSecret", rotulo: "Client Secret", segredo: true },
            ]}
            salvando={salvarPluggy.isPending}
            onSalvar={v => salvarPluggy.mutateAsync({ clientId: v.clientId ?? "", clientSecret: v.clientSecret ?? "" })}
          />

          <Bloco
            titulo="WhatsApp — servidor da Evolution (QR code)"
            servico="whatsapp"
            salvo={<p>{whatsapp?.configurado ? `Endereço ${whatsapp.url} · chave terminando em ${whatsapp.final}${FONTE(whatsapp.fonte)}.` : "Endereço e chave do servidor não salvos."}</p>}
            extra={<p className="text-xs text-gray-300">A conexão do número (QR code), as conexões dos corretores, as conversas e os envios ficam na <Link href="/admin/whatsapp?aba=conexao" className="underline text-[#C9A961]">Central WhatsApp</Link>.</p>}
            campos={[
              { nome: "url", rotulo: "Endereço do servidor", placeholder: "https://evolution-xxxx.up.railway.app" },
              { nome: "apiKey", rotulo: "Chave de acesso (AUTHENTICATION_API_KEY)", segredo: true },
            ]}
            salvando={salvarEvolution.isPending}
            onSalvar={v => salvarEvolution.mutateAsync({ url: v.url ?? "", apiKey: v.apiKey ?? "" })}
          />
          {/* Lote 03, correção 09: "Minha Conexão WhatsApp" e "Conexões dos Corretores" ficam só na Central WhatsApp (aba Minha conexão). */}
          <SubPciAtual />
        </>}
      </main>
    </div>
  );
}
