import { FormEvent, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { assinarPdf, definirCertificadoPadrao, importarCertificado, listarCertificados, removerCertificado, type CertificadoSalvo } from "@/lib/certificados-digitais";
import { bytesBase64 } from "@/lib/juridico-arquivos";

export default function CertificadosJuridico({ owner, documento, fechar, concluiu }: {
  owner: number; documento?: { id: number; contractId: number; name: string } | null;
  fechar: () => void; concluiu: () => Promise<unknown>;
}) {
  const utils = trpc.useUtils();
  const upload = trpc.juridico.uploadDocument.useMutation();
  const [certificados, setCertificados] = useState<CertificadoSalvo[]>([]);
  const [selecionado, setSelecionado] = useState("");
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const atualizar = async () => {
    const rows = await listarCertificados(owner); setCertificados(rows);
    setSelecionado(v => rows.some(x => x.id === v) ? v : rows.find(x => x.padrao)?.id || rows[0]?.id || "");
  };
  useEffect(() => { void atualizar().catch(e => setErro(e.message)); }, [owner]);
  useEffect(() => { setSenha(""); }, [documento?.id, selecionado]);

  async function importar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form), file = data.get("certificado");
    if (!(file instanceof File) || !file.size) return;
    setOcupado(true); setErro("");
    try {
      const cert = await importarCertificado(owner, file, String(data.get("senha") || ""));
      form.reset(); await atualizar(); setSelecionado(cert.id); toast.success("Certificado importado neste navegador");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao importar certificado."); }
    finally { const campo = form.elements.namedItem("senha") as HTMLInputElement | null; if (campo) campo.value = ""; setOcupado(false); }
  }
  async function assinar() {
    const cert = certificados.find(x => x.id === selecionado); if (!cert || !documento) return;
    setOcupado(true); setErro("");
    const senhaAtual = senha; setSenha("");
    try {
      const original = await utils.juridico.documentContent.fetch({ id: documento.id });
      const { bytes } = await assinarPdf(Uint8Array.from(atob(original.base64), c => c.charCodeAt(0)), cert, senhaAtual);
      if (bytes.length > 3 * 1024 * 1024) throw new Error("O PDF assinado ultrapassa 3 MiB. Reduza o arquivo antes de assinar.");
      // Assinatura de uma parte não significa que todas as partes já assinaram o contrato.
      await upload.mutateAsync({ contractId: documento.contractId, type: "assinatura_digital",
        name: `${documento.name.replace(/\.pdf$/i, "").slice(0, 160)}-assinado-${cert.documento || cert.id.slice(0, 12)}.pdf`, base64: bytesBase64(bytes) });
      await concluiu(); toast.success("PDF assinado e salvo nos documentos. O original foi preservado."); fechar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível assinar o PDF."); }
    finally { setOcupado(false); }
  }
  const data = (value: string) => new Date(value).toLocaleDateString("pt-BR");
  const conteudo = <div className="space-y-4">
    <p className="text-sm text-gray-300">Certificados A1 (.pfx ou .p12) guardados com criptografia neste navegador e nesta conta. A senha é solicitada a cada assinatura e não é salva. Em outro aparelho, importe novamente.</p>
    {erro && <p role="alert" className="text-red-300">{erro}</p>}
    {documento ? <>
      <p className="break-all">Documento: {documento.name}</p>
      <Label htmlFor="certificado-selecionado">Certificado para assinar</Label>
      <select id="certificado-selecionado" value={selecionado} disabled={ocupado} onChange={e => setSelecionado(e.target.value)} className="w-full rounded border border-slate-500 bg-[#1A2332] p-2">
        <option value="" disabled>Selecione um certificado</option>{certificados.map(c => <option key={c.id} value={c.id}>{c.titular} · válido até {data(c.vencimento)}</option>)}
      </select>
      {certificados.find(c => c.id === selecionado) && <p className="text-sm text-gray-300">Emitido por {certificados.find(c => c.id === selecionado)!.emissor}</p>}
      <Label htmlFor="senha-assinatura">Senha do certificado</Label><Input id="senha-assinatura" type="password" autoComplete="off" value={senha} disabled={ocupado} onChange={e => setSenha(e.target.value)} />
      <p className="text-sm text-gray-300">Confira o documento e o titular antes de assinar. Esta assinatura é do titular selecionado; as demais partes continuam pendentes. Sem carimbo de tempo ou validação de revogação automática.</p>
      <Button onClick={() => void assinar()} disabled={ocupado || !selecionado || !senha}>{ocupado ? "Assinando e salvando…" : "Assinar digitalmente"}</Button>
    </> : <>
      {!certificados.length && <p>Nenhum certificado importado neste navegador.</p>}
      {certificados.map(c => <div key={c.id} className="space-y-2 rounded border border-slate-500 p-4">
        <p className="break-words font-semibold">{c.titular} {c.padrao && "· Padrão"}</p>
        {c.documento && <p>CPF/CNPJ: {c.documento}</p>}<p>Emitido por {c.emissor}</p>
        <p>Válido de {data(c.inicio)} até {data(c.vencimento)} · {new Date(c.vencimento) <= new Date() ? "Vencido" : new Date(c.inicio) > new Date() ? "Ainda não válido" : "Dentro da validade"}</p>
        <p className="break-all text-xs text-gray-400">Serial: {c.serial}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={ocupado || c.padrao} onClick={() => void definirCertificadoPadrao(owner, c.id).then(atualizar).catch(e => setErro(e.message))}>Usar como padrão</Button>
          <Button variant="outline" disabled={ocupado} onClick={() => { if (confirm(`Remover ${c.titular} deste navegador?`)) void removerCertificado(owner, c.id).then(atualizar).catch(e => setErro(e.message)); }}>Remover certificado</Button></div>
      </div>)}
    </>}
    <form onSubmit={importar} className="space-y-3 rounded border border-slate-500 p-4">
      <h3 className="font-semibold text-[#C9A961]">Importar certificado digital</h3>
      <Label htmlFor="arquivo-certificado">Arquivo A1 (.pfx ou .p12)</Label><Input id="arquivo-certificado" name="certificado" type="file" accept=".pfx,.p12,application/x-pkcs12" required disabled={ocupado} />
      <Label htmlFor="senha-importacao">Senha do certificado</Label><Input id="senha-importacao" name="senha" type="password" autoComplete="off" required disabled={ocupado} />
      <Button type="submit" disabled={ocupado}>{ocupado ? "Processando…" : "Importar certificado"}</Button>
    </form>
  </div>;
  return documento ? <Dialog open onOpenChange={v => { if (!v && !ocupado) fechar(); }}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Assinar digitalmente</DialogTitle></DialogHeader>{conteudo}</DialogContent></Dialog> : <section className="space-y-4 rounded-lg bg-[#2C3E50] p-5"><h2 className="text-xl font-bold text-[#C9A961]">Certificados digitais</h2>{conteudo}</section>;
}
