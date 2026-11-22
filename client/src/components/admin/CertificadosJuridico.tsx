import { FormEvent, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { assinarPdf, guardarSenha, recuperarSenha, esquecerSenha, definirCertificadoPadrao, importarCertificado, listarCertificados, removerCertificado, type CertificadoSalvo, type PosicaoAssinatura } from "@/lib/certificados-digitais";
import { bytesBase64 } from "@/lib/juridico-arquivos";

import PosicionarAssinaturaPdf from "./PosicionarAssinaturaPdf";

export default function CertificadosJuridico({ owner, documento, fechar, concluiu }: {
  owner: number; documento?: { id: number; contractId: number; name: string } | null;
  fechar: () => void; concluiu: () => Promise<unknown>;
}) {
  const utils = trpc.useUtils();
  const upload = trpc.juridico.uploadDocument.useMutation();
  const [certificados, setCertificados] = useState<CertificadoSalvo[]>([]);
  const [selecionado, setSelecionado] = useState("");
  const [senha, setSenha] = useState("");
  const [pdfBytes,setPdfBytes]=useState<Uint8Array>();
  const [posicao,setPosicao]=useState<PosicaoAssinatura|null>(null);
  const [lembrada,setLembrada]=useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const atualizar = async () => {
    const rows = await listarCertificados(owner); setCertificados(rows);
    setSelecionado(v => rows.some(x => x.id === v) ? v : rows.find(x => x.padrao)?.id || rows[0]?.id || "");
  };
  useEffect(() => { void atualizar().catch(e => setErro(e.message)); }, [owner]);
  useEffect(() => { let ativa=true;setSenha("");setLembrada(false);const cert=certificados.find(c=>c.id===selecionado);if(cert)void recuperarSenha(cert).then(s=>{if(ativa&&s){setSenha(s);setLembrada(true);}});return()=>{ativa=false;}; }, [documento?.id,selecionado,certificados]);
  useEffect(()=>{setPdfBytes(undefined);setPosicao(null);if(documento)void utils.juridico.documentContent.fetch({id:documento.id}).then(c=>setPdfBytes(Uint8Array.from(atob(c.base64),x=>x.charCodeAt(0)))).catch(()=>setErro("Não foi possível carregar o PDF para assinatura."));},[documento?.id]);

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
    const cert = certificados.find(x => x.id === selecionado); if (!cert || !documento || !pdfBytes || !posicao) return;
    setOcupado(true); setErro("");
    const senhaAtual = senha;
    try {
      await guardarSenha(cert,senhaAtual);
      const { bytes } = await assinarPdf(pdfBytes,cert,senhaAtual,posicao);
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
    <p className="text-sm text-gray-300">Certificados A1 (.pfx ou .p12) guardados com criptografia neste navegador e nesta conta. A senha fica criptografada neste aparelho para as próximas assinaturas. Em outro aparelho, importe novamente.</p>
    {erro && <p role="alert" className="text-red-300">{erro}</p>}
    {documento ? <>
      <p className="break-all">Documento: {documento.name}</p>
      <Label htmlFor="certificado-selecionado">Certificado para assinar</Label>
      <select id="certificado-selecionado" value={selecionado} disabled={ocupado} onChange={e => setSelecionado(e.target.value)} className="w-full rounded border border-slate-500 bg-[#1A2332] p-2">
        <option value="" disabled>Selecione um certificado</option>{certificados.map(c => <option key={c.id} value={c.id}>{c.titular} · válido até {data(c.vencimento)}</option>)}
      </select>
      {certificados.find(c => c.id === selecionado) && <p className="text-sm text-gray-300">Emitido por {certificados.find(c => c.id === selecionado)!.emissor}</p>}
      {lembrada ? <p className="text-sm text-green-300">Senha salva neste aparelho.</p> : <><Label htmlFor="senha-assinatura">Senha do certificado (será salva neste aparelho)</Label><Input id="senha-assinatura" type="password" autoComplete="off" value={senha} disabled={ocupado} onChange={e => setSenha(e.target.value)} /></>}
      {pdfBytes ? <div className={ocupado ? "pointer-events-none opacity-60" : ""}><PosicionarAssinaturaPdf bytes={pdfBytes} mudou={setPosicao} /></div> : <p>Carregando PDF…</p>}
      <p className="text-sm text-gray-300">Confira o documento e o titular antes de assinar. Esta assinatura é do titular selecionado; as demais partes continuam pendentes. Sem carimbo de tempo ou validação de revogação automática.</p>
      <Button onClick={() => void assinar()} disabled={ocupado || !selecionado || !senha || !posicao || !pdfBytes}>{ocupado ? "Assinando e salvando…" : "Assinar digitalmente"}</Button>
    </> : <>
      {!certificados.length && <p>Nenhum certificado importado neste navegador.</p>}
      {certificados.map(c => <div key={c.id} className="space-y-2 rounded border border-slate-500 p-4">
        <p className="break-words font-semibold">{c.titular} {c.padrao && "· Padrão"}</p>
        {c.documento && <p>CPF/CNPJ: {c.documento}</p>}<p>Emitido por {c.emissor}</p>
        <p>Válido de {data(c.inicio)} até {data(c.vencimento)} · {new Date(c.vencimento) <= new Date() ? "Vencido" : new Date(c.inicio) > new Date() ? "Ainda não válido" : "Dentro da validade"}</p>
        <p className="break-all text-xs text-gray-400">Serial: {c.serial}</p><p className="text-sm">{c.senhaSalva ? "Senha salva neste aparelho" : "A senha será salva na próxima assinatura"}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={ocupado || c.padrao} onClick={() => void definirCertificadoPadrao(owner, c.id).then(atualizar).catch(e => setErro(e.message))}>Usar como padrão</Button>
          <Button variant="outline" disabled={ocupado || !c.senhaSalva} onClick={()=>void esquecerSenha(c).then(atualizar).catch(e=>setErro(e.message))}>Esquecer senha</Button><Button variant="outline" disabled={ocupado} onClick={() => { if (confirm(`Remover ${c.titular} deste navegador?`)) void removerCertificado(owner, c.id).then(atualizar).catch(e => setErro(e.message)); }}>Remover certificado</Button></div>
      </div>)}
    </>}
    {!documento && <form onSubmit={importar} className="space-y-3 rounded border border-slate-500 p-4">
      <h3 className="font-semibold text-[#C9A961]">Importar certificado digital</h3>
      <Label htmlFor="arquivo-certificado">Arquivo A1 (.pfx ou .p12)</Label><Input id="arquivo-certificado" name="certificado" type="file" accept=".pfx,.p12,application/x-pkcs12" required disabled={ocupado} />
      <Label htmlFor="senha-importacao">Senha do certificado</Label><Input id="senha-importacao" name="senha" type="password" autoComplete="off" required disabled={ocupado} />
      <Button type="submit" disabled={ocupado}>{ocupado ? "Processando…" : "Importar certificado"}</Button>
    </form>}
  </div>;
  return documento ? <Dialog open onOpenChange={v => { if (!v && !ocupado) fechar(); }}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Assinar digitalmente</DialogTitle></DialogHeader>{conteudo}</DialogContent></Dialog> : <section className="space-y-4 rounded-lg bg-[#2C3E50] p-5"><h2 className="text-xl font-bold text-[#C9A961]">Certificados digitais</h2>{conteudo}</section>;
}
