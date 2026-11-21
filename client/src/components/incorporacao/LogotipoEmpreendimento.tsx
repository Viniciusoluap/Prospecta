// EPIC-024 S-02 — logotipo do empreendimento em Dados Gerais: enviar (PNG, JPG, SVG, PDF) ou gerar com IA,
// pré-visualizar, aprovar, trocar e excluir. PDF e SVG viram PNG aqui no navegador; o servidor guarda as duas versões.
// EPIC-027 C8: a IA (chave de Configurações › Integrações › Anthropic) devolve um SVG já limpo pelo servidor, que segue
// o MESMO caminho do SVG enviado (vira PNG aqui, pré-visualização, aprovar ou gerar outra).
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, ImageIcon, Sparkles, Trash2, Upload, X } from "lucide-react";
import { enviarPartes } from "@/lib/documentos-partes";
import { blobParaDataUrl } from "@/lib/comprimir-imagem";
import { desenharPaginaPdf } from "@/components/maquete-3d/fundo-pdf";
import { ACCEPT_LOGO, LADO_EXIBICAO, LIMITE_LOGO_BYTES, tipoDoLogo, tipoPelaExtensao } from "@shared/incorporacao/logotipo";

export const urlLogoEstudo = (studyId: number, versao: string) => `/api/incorporacao/logo/${studyId}?v=${versao.slice(0, 16)}`;

type Previa = { arquivo: File; origem: "envio" | "ia"; url: string; png: Blob; largura: number; altura: number };

async function canvasParaPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Falha ao gerar a imagem de exibição.");
  return blob;
}

/** Imagem de exibição: PNG com o maior lado em até 512 px, proporção mantida (PDF: 1ª página). */
async function gerarExibicao(arquivo: File): Promise<{ png: Blob; largura: number; altura: number }> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoDoLogo(bytes);
  if (!tipo) throw new Error("O arquivo não é PNG, JPG, SVG ou PDF válido.");
  const esperado = tipoPelaExtensao(arquivo.name);
  if (esperado && esperado !== tipo) throw new Error("O conteúdo do arquivo não corresponde à extensão.");
  let canvas: HTMLCanvasElement;
  if (tipo === "application/pdf") {
    canvas = await desenharPaginaPdf(bytes, 1, LADO_EXIBICAO, true);
  } else {
    // <img> não executa scripts do SVG
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    try {
      const img = await new Promise<HTMLImageElement>((ok, falha) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => falha(new Error("Não foi possível abrir a imagem."));
        i.src = url;
      });
      const w0 = img.naturalWidth || LADO_EXIBICAO, h0 = img.naturalHeight || LADO_EXIBICAO;
      const escala = Math.min(1, LADO_EXIBICAO / Math.max(w0, h0));
      const fator = tipo === "image/svg+xml" ? LADO_EXIBICAO / Math.max(w0, h0) : escala; // SVG é vetorial: usa o lado todo
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w0 * fator));
      canvas.height = Math.max(1, Math.round(h0 * fator));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { png: await canvasParaPng(canvas), largura: canvas.width, altura: canvas.height };
}

export function LogotipoEmpreendimento({ studyId }: { studyId: number }) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: logo } = trpc.incorporacao.logo.obter.useQuery({ studyId });
  const { data: ia } = trpc.incorporacao.logo.iaDisponivel.useQuery();
  const salvar = trpc.incorporacao.logo.salvar.useMutation();
  const excluir = trpc.incorporacao.logo.excluir.useMutation();
  const gerarIa = trpc.incorporacao.logo.gerarIa.useMutation();
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoIa, setAvisoIa] = useState<string | null>(null);

  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa.url); }, [previa]);

  const recarregar = () => Promise.all([utils.incorporacao.logo.obter.invalidate({ studyId }), utils.incorporacao.logo.versoes.invalidate()]);

  async function preparar(arquivo: File, origem: "envio" | "ia") {
    setErro(null);
    if (!arquivo.size) return setErro("O arquivo está vazio.");
    if (arquivo.size > LIMITE_LOGO_BYTES) return setErro("Logotipo acima de 10 MB.");
    if (origem === "envio" && !tipoPelaExtensao(arquivo.name)) return setErro("Envie PNG, JPG, JPEG, SVG ou PDF.");
    setOcupado("Preparando a pré-visualização...");
    try {
      const { png, largura, altura } = await gerarExibicao(arquivo);
      setPrevia({ arquivo, origem, png, largura, altura, url: URL.createObjectURL(png) });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setOcupado(null);
    }
  }

  async function aprovar() {
    if (!previa) return;
    setOcupado("Salvando o logotipo...");
    setErro(null);
    try {
      const uploadId = await enviarPartes(previa.arquivo, `incorporacao-logo:${studyId}`);
      const exibicaoBase64 = (await blobParaDataUrl(previa.png)).split(",")[1] ?? "";
      await salvar.mutateAsync({ studyId, uploadId, nome: previa.arquivo.name, origem: previa.origem, exibicaoBase64, largura: previa.largura, altura: previa.altura });
      setPrevia(null);
      await recarregar();
      toast.success("Logotipo salvo.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o logotipo.");
    } finally {
      setOcupado(null);
    }
  }

  async function gerar() {
    setErro(null);
    setAvisoIa(null);
    setOcupado("Gerando o logotipo… (pode levar até 40 segundos)");
    try {
      const r = await gerarIa.mutateAsync({ studyId });
      if (!r.ok) { setAvisoIa(r.motivo); return; }
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      if (previa) setPrevia(null);
      await preparar(new File([bytes], "logotipo-ia.svg", { type: r.mime }), "ia");
      if (r.restantes <= 1) setAvisoIa(r.restantes === 1 ? "Resta 1 proposta pela IA hoje." : "Esta foi a última proposta pela IA de hoje.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o logotipo.");
    } finally {
      setOcupado(null);
    }
  }

  async function remover() {
    if (!window.confirm("Excluir o logotipo deste empreendimento?")) return;
    try {
      await excluir.mutateAsync({ studyId });
      await recarregar();
      toast.success("Logotipo excluído.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir o logotipo.");
    }
  }

  const imagem = previa?.url ?? (logo ? urlLogoEstudo(studyId, logo.versao) : null);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-300">Logotipo do empreendimento</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#C9A961]/30 bg-white p-2 sm:w-40">
          {imagem
            ? <img src={imagem} alt="Logotipo do empreendimento" className="max-h-full max-w-full object-contain" />
            : <ImageIcon className="h-10 w-10 text-gray-300" aria-label="Sem logotipo" />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input ref={inputRef} type="file" accept={ACCEPT_LOGO} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void preparar(f, "envio"); }} />
          {previa ? (
            <>
              <p className="text-xs text-gray-300">
                Pré-visualização {previa.origem === "ia" ? "da proposta da IA" : `de “${previa.arquivo.name}”`}. Aprove para usar neste empreendimento.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={aprovar} disabled={!!ocupado} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                  Aprovar e salvar
                </Button>
                {previa.origem === "ia" && (
                  <Button type="button" variant="outline" onClick={gerar} disabled={!!ocupado} className="border-[#C9A961]/40 bg-transparent text-white hover:bg-white/10">
                    <Sparkles className="h-4 w-4 mr-1" /> Gerar outra
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => setPrevia(null)} disabled={!!ocupado} className="border-[#C9A961]/40 bg-transparent text-white hover:bg-white/10">
                  <X className="h-4 w-4 mr-1" /> Cancelar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => inputRef.current?.click()} disabled={!!ocupado} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Upload className="h-4 w-4 mr-1" /> {logo ? "Trocar logotipo" : "Enviar logotipo"}
              </Button>
              <Button type="button" variant="outline" onClick={gerar} disabled={!!ocupado || ia?.disponivel === false} className="border-[#C9A961]/40 bg-transparent text-white hover:bg-white/10">
                <Sparkles className="h-4 w-4 mr-1" /> Gerar logotipo com IA
              </Button>
              {logo && (
                <>
                  <Button asChild type="button" variant="ghost" className="text-gray-300 hover:text-white">
                    <a href={`/api/incorporacao/logo/${studyId}/original`} download><Download className="h-4 w-4 mr-1" /> Baixar original</a>
                  </Button>
                  <Button type="button" variant="ghost" onClick={remover} disabled={!!ocupado} className="text-red-300 hover:text-red-200">
                    <Trash2 className="h-4 w-4 mr-1" /> Excluir
                  </Button>
                </>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400">PNG, JPG, JPEG, SVG ou PDF, até 10 MB. PDF e SVG são convertidos em imagem para a exibição.</p>
          {ia && !ia.disponivel && !avisoIa && ia.motivo && (
            <p className="text-xs text-amber-200">{ia.motivo}</p>
          )}
          {ocupado && <p role="status" aria-live="polite" className="text-xs text-gray-300">{ocupado}</p>}
          {avisoIa && <p role="status" className="rounded border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-100">{avisoIa}</p>}
          {erro && <p role="alert" className="text-xs text-red-300">{erro}</p>}
        </div>
      </div>
    </div>
  );
}
