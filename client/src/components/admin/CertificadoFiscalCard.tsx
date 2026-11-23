// EPIC-029 S-4 (22/11/2026) — cartão do certificado A1 da emissão de NFS-e (Configurações › Integrações).
// Caminho principal (pedido do dono): usar o A1 que já está no Jurídico, pelo botão "Usar também para emitir notas
// fiscais" do cartão de lá. Aqui fica só o resumo (titular, CNPJ, validade, impressão digital), o atalho para o
// Jurídico, desativar, testar conexão e, como alternativa, o envio direto do .pfx. O servidor nunca devolve o arquivo
// nem a senha. A emissão continua desligada.
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { bytesBase64 } from "@/lib/juridico-arquivos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const AMBIENTE: Record<string, string> = { desligado: "emissão desligada", producao_restrita: "produção restrita (testes)", producao: "produção" };
const data = (v: string) => new Date(v).toLocaleDateString("pt-BR");

async function arquivoEmBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { return bytesBase64(bytes); } finally { bytes.fill(0); }
}

export function CertificadoFiscalCard() {
  const utils = trpc.useUtils();
  const status = trpc.integracoes.certificadoFiscal.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const nomes = trpc.fiscal.emissores.listar.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const [resultado, setResultado] = useState<Record<number, { ok: boolean; mensagem: string }>>({});
  const [alternativa, setAlternativa] = useState(false);
  const [emissorId, setEmissorId] = useState<number | "">("");
  const recarregar = () => utils.integracoes.certificadoFiscal.status.invalidate();
  const enviar = trpc.integracoes.certificadoFiscal.enviar.useMutation();
  const desativar = trpc.integracoes.certificadoFiscal.desativar.useMutation({
    onSuccess: async () => { toast.success("Certificado desativado (nada foi apagado)."); await recarregar(); },
    onError: e => toast.error(e.message),
  });
  const testar = trpc.integracoes.certificadoFiscal.testarConexao.useMutation({
    onSuccess: (r, v) => setResultado(x => ({ ...x, [v.emissorId]: r })),
    onError: e => toast.error(e.message),
  });
  const proibido = (status.error?.data?.code as string | undefined) === "FORBIDDEN";
  if (proibido) return null;
  const emissores = status.data ?? [];
  const razao = (cnpj: string) => nomes.data?.find(n => n.cnpj === cnpj)?.razaoSocial ?? null;

  async function enviarArquivo(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget, dados = new FormData(form), file = dados.get("pfx"), senha = String(dados.get("senha") || "");
    if (!(file instanceof File) || !file.size || !senha || emissorId === "") return;
    if (!/\.(pfx|p12)$/i.test(file.name) || file.size > 1024 * 1024) { toast.error("Selecione um certificado A1 .pfx ou .p12 de até 1 MiB."); return; }
    try {
      const r = await enviar.mutateAsync({ pfxBase64: await arquivoEmBase64(file), senha, emissorId, origem: "arquivo" });
      toast.success(`Certificado guardado: ${r.titular}, válido até ${data(r.validoAte)}.`);
      form.reset(); setAlternativa(false); await recarregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível guardar o certificado."); }
    finally { const campo = form.elements.namedItem("senha") as HTMLInputElement | null; if (campo) campo.value = ""; }
  }

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">Certificado A1 — emissão de NFS-e</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="flex items-start gap-2 text-gray-300"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Use o certificado que já está no Jurídico: em <Link href="/admin/juridico?aba=certificados" className="underline text-[#C9A961]">Jurídico › Certificados digitais</Link>, no cartão do certificado, clique em "Usar também para emitir notas fiscais". Ele fica guardado cifrado no servidor; aqui aparece só o resumo. O certificado não emite nada sozinho: a nota só sai depois que o administrador liberar a emissão da empresa e ligar o ambiente (Dados fiscais do perfil).</p>
        {status.isLoading && <p className="text-gray-300">Carregando…</p>}
        {status.error && <p className="text-red-300">Erro: {status.error.message}</p>}
        {!status.isLoading && !emissores.length && <p className="text-gray-300">Nenhuma empresa emissora cadastrada ainda (BPO › Contabilidade › Notas fiscais).</p>}
        {emissores.map(e => {
          const c = e.certificado, r = resultado[e.id];
          return (
            <div key={e.id} className="space-y-1 rounded-lg bg-[#1A2332] p-3">
              <p className="font-semibold">{razao(e.cnpj) ?? "Empresa emissora"} · CNPJ {e.cnpj} · {AMBIENTE[e.ambiente] ?? e.ambiente}</p>
              {c ? <>
                <p>Titular: {c.titular} · CNPJ do certificado: {c.cnpj}</p>
                <p>Válido de {data(c.validoDe)} até {data(c.validoAte)}{c.autoridade ? ` · emitido por ${c.autoridade}` : ""}</p>
                <p className="break-all text-xs text-gray-400">Impressão digital (SHA-256): {c.impressaoDigital}</p>
                <p className="text-xs text-gray-400">{c.cadeiaIcp ? "Cadeia ICP-Brasil conferida." : "Cadeia ICP-Brasil não conferida (o arquivo não trouxe os certificados intermediários)."} Enviado {c.origem === "juridico" ? "do Jurídico" : "por arquivo"} em {data(c.enviadoEm)}.</p>
                {c.aviso && <p role="alert" className="flex items-start gap-2 font-bold text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {c.aviso}</p>}
              </> : <p className="text-gray-300">Sem certificado ativo.</p>}
              {r && <p className={`flex items-start gap-2 ${r.ok ? "text-green-300" : "text-red-300"}`}>{r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />} {r.mensagem}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" className={botaoSec} disabled={testar.isPending} onClick={() => testar.mutate({ emissorId: e.id })}>Testar conexão</Button>
                {c && <Button size="sm" variant="outline" className={botaoSec} disabled={desativar.isPending} onClick={() => { if (confirm("Desativar este certificado para a emissão? Nada é apagado; para voltar, envie de novo.")) desativar.mutate({ emissorId: e.id }); }}>Desativar</Button>}
              </div>
            </div>
          );
        })}
        <p className="text-xs text-gray-400">Se o JWT_SECRET do servidor mudar, o certificado guardado deixa de abrir: envie de novo.</p>
        {emissores.length > 0 && <Button size="sm" variant="outline" className={botaoSec} onClick={() => setAlternativa(v => !v)}>{alternativa ? "Cancelar" : "Alternativa: enviar o arquivo .pfx"}</Button>}
        {alternativa && (
          <form className="space-y-3 rounded-lg bg-[#1A2332] p-3" onSubmit={ev => void enviarArquivo(ev)}>
            <div><Label className="text-gray-300" htmlFor="emissor-cert">Empresa emissora</Label>
              <select id="emissor-cert" required value={emissorId} onChange={ev => setEmissorId(ev.target.value ? Number(ev.target.value) : "")} className="mt-1 w-full rounded border border-[#C9A961]/30 bg-[#1A2332] p-2 text-white">
                <option value="">Selecione</option>{emissores.map(e => <option key={e.id} value={e.id}>{razao(e.cnpj) ?? "Empresa"} · {e.cnpj}</option>)}
              </select></div>
            <div><Label className="text-gray-300" htmlFor="pfx-cert">Arquivo A1 (.pfx ou .p12)</Label><Input id="pfx-cert" name="pfx" type="file" accept=".pfx,.p12,application/x-pkcs12" required className="mt-1" /></div>
            <div><Label className="text-gray-300" htmlFor="senha-cert">Senha do certificado</Label><Input id="senha-cert" name="senha" type="password" autoComplete="off" required className="mt-1" /></div>
            <Button type="submit" size="sm" disabled={enviar.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{enviar.isPending ? "Conferindo…" : "Conferir e guardar"}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
