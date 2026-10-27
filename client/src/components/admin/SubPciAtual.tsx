// Lote 2, correção 03 (AD-06): Integrações › "Sub PCI atual" — envio da versão
// atualizada do modelo oficial da PCI (CAIXA), versionado. Só admin (a página de
// Integrações e o router `pciModelos` são do admin). Gêmeo em
// Grupo-Santa-Fe/web/src/components/admin/sub-pci-atual.tsx.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { blobParaDataUrl, enviarJsonComProgresso, mensagemErroEnvio } from "@/lib/comprimir-imagem";
import { baixarArquivoEmPartes } from "@/lib/pci-gerador-arquivos";
import { LIMITE_MODELO_PCI_BYTES } from "@shared/pci-gerador";
import { PARTE_PCI_BYTES } from "@shared/pci-upload";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.ceil(b / 1024)} KB`);

export function SubPciAtual() {
  const utils = trpc.useUtils();
  const modelos = trpc.pciModelos.listar.useQuery();
  const definirAtual = trpc.pciModelos.definirAtual.useMutation({
    onSuccess: async () => { toast.success("Modelo atual alterado."); await utils.pciModelos.listar.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [observacao, setObservacao] = useState("");

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (!/\.(xls|xlsm|xlsb)$/i.test(arquivo.name)) return toast.error("Envie o modelo em .xls, .xlsm ou .xlsb.");
    if (arquivo.size > LIMITE_MODELO_PCI_BYTES) return toast.error("Envie um modelo de até 8 MB.");
    setEnviando(true);
    try {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(arquivo.size / PARTE_PCI_BYTES);
      if (!totalChunks) throw new Error("Arquivo vazio.");
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const dataUrl = await blobParaDataUrl(arquivo.slice(chunkIndex * PARTE_PCI_BYTES, (chunkIndex + 1) * PARTE_PCI_BYTES));
        const r = await enviarJsonComProgresso("/api/pci-modelos", { nome: arquivo.name, uploadId, chunkIndex, totalChunks, chunk: dataUrl.split(",")[1] });
        if (r.status < 200 || r.status >= 300) throw new Error(mensagemErroEnvio(r.status, r.dados));
      }
      const fim = await enviarJsonComProgresso("/api/pci-modelos", { uploadId, finalizar: true, observacao });
      if (fim.status < 200 || fim.status >= 300) throw new Error(mensagemErroEnvio(fim.status, fim.dados));
      const d = fim.dados as { versao: number; repetido: boolean; aviso: string | null };
      toast.success(d.repetido ? `Este arquivo já era a versão ${d.versao}; ela voltou a ser a atual.` : `Modelo enviado: versão ${d.versao} (atual).`);
      if (d.aviso) toast.warning(d.aviso, { duration: 10000 });
      setObservacao("");
      await utils.pciModelos.listar.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  const lista = modelos.data ?? [];
  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><FileSpreadsheet className="h-5 w-5" /> PCI da CAIXA — modelo oficial</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-300">
          O Gerador de PCI (Editar Obra) preenche o modelo marcado como atual. Envie aqui cada nova versão da planilha oficial
          (.xls ou .xlsm; .xlsb fica guardado, mas só é lido — para gerar, envie também a versão .xls/.xlsm). O arquivo não é reconstruído:
          só os campos de digitação são preenchidos. O envio de PCI das obras continua igual.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={entrada} type="file" accept=".xls,.xlsm,.xlsb" className="hidden" onChange={(e) => void enviar(e.target.files?.[0])} />
          <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} placeholder="Observação da versão (opcional)"
            className="max-w-xs bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500" />
          <Button size="sm" disabled={enviando} onClick={() => entrada.current?.click()} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">
            {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Sub PCI atual
          </Button>
        </div>
        {modelos.isLoading ? <p className="text-sm text-gray-300">Carregando versões…</p>
          : modelos.error ? <p className="text-sm text-red-300">{modelos.error.message}</p>
          : !lista.length ? <p className="text-sm text-yellow-200">Nenhum modelo enviado ainda.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400"><th className="p-1">Versão</th><th className="p-1">Arquivo</th><th className="p-1">Enviado</th><th className="p-1">Autor</th><th className="p-1" /></tr></thead>
                <tbody>
                  {lista.map((m) => (
                    <tr key={m.id} className="border-t border-white/10">
                      <td className="p-1 font-semibold">v{m.versao}{m.atual && <span className="ml-2 rounded bg-green-700/60 px-1.5 py-0.5 text-xs">atual</span>}</td>
                      <td className="p-1 break-all">{m.arquivo} <span className="text-xs text-gray-400">(.{m.formato}, {tamanho(m.tamanho)})</span>{m.observacao && <span className="block text-xs text-gray-400">{m.observacao}</span>}</td>
                      <td className="p-1 whitespace-nowrap">{new Date(m.enviadoEm).toLocaleString("pt-BR")}</td>
                      <td className="p-1">{m.autor ?? "—"}</td>
                      <td className="p-1">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="outline" className={botaoSec} aria-label={`Baixar original da versão ${m.versao}`}
                            onClick={() => baixarArquivoEmPartes(`/api/pci-modelos/${m.id}/arquivo`, m.arquivo).catch((e) => toast.error(e.message))}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {!m.atual && (
                            <Button size="sm" variant="outline" className={botaoSec} disabled={definirAtual.isPending}
                              onClick={() => { if (confirm(`Usar a versão ${m.versao} como modelo atual?`)) definirAtual.mutate({ id: m.id }); }}>
                              Tornar atual
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
