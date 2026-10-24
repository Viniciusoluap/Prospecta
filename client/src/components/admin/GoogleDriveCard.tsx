import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CheckCircle2, CloudUpload, HardDrive, Link2, Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Configurações → Google Drive: o dono envia o JSON do cliente OAuth ("Aplicativo
 * da Web") e conecta a própria conta Google. Os arquivos do sistema passam a ir
 * para a pasta "Prospecta — Documentos do sistema" no Drive dele.
 */
export function GoogleDriveCard() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.googleDrive.status.useQuery();
  const [aviso, setAviso] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const salvar = trpc.googleDrive.salvarCredencial.useMutation({
    onSuccess: (r) => {
      toast.success("Credencial do Google salva. Agora clique em \"Conectar Google Drive\".");
      setAviso(r.uriCadastrada ? null : `Atenção: o endereço ${r.callback} não está nos "URIs de redirecionamento autorizados" desse cliente no Google. Adicione-o antes de conectar.`);
      void utils.googleDrive.status.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const desconectar = trpc.googleDrive.desconectar.useMutation({ onSuccess: () => { toast.success("Google Drive desconectado."); void utils.googleDrive.status.invalidate(); }, onError: (e) => toast.error(e.message) });
  const testar = trpc.googleDrive.testar.useMutation({ onError: (e) => toast.error(e.message) });

  // Resultado da volta do Google (/admin/configuracoes?drive=ok|erro&motivo=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const drive = params.get("drive");
    if (!drive) return;
    if (drive === "ok") toast.success("Google Drive conectado! Os próximos arquivos vão para o seu Drive.");
    else toast.error(params.get("motivo") ?? "Não foi possível conectar o Google Drive.", { duration: 15000 });
    window.history.replaceState(null, "", window.location.pathname);
    void utils.googleDrive.status.invalidate();
  }, [utils]);

  async function enviar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (file.size > 20_000) { toast.error("Arquivo grande demais para ser o JSON do cliente OAuth."); return; }
    salvar.mutate({ json: await file.text() });
  }

  const r = testar.data;
  return <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100"><CardContent className="space-y-4 pt-6 text-white">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><HardDrive className="text-[#C9A961]" /><div>
        <h2 className="text-lg font-bold">Google Drive</h2>
        <p className="text-sm text-gray-300">Documentos do sistema guardados no Google Drive da sua conta.</p>
      </div></div>
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : status?.conectado
        ? <span className="flex items-center gap-1 text-sm text-green-400"><CheckCircle2 className="h-4 w-4" /> Conectado{status.email ? ` como ${status.email}` : ""}</span>
        : <span className="text-sm text-amber-300">{status?.credencial ? "Credencial enviada — falta conectar" : "Não conectado (arquivos ficam no banco)"}</span>}
    </div>
    <ol className="space-y-3 text-sm">
      <li className="rounded-lg bg-[#1A2332] p-3"><p className="font-semibold">1. Envie o JSON do cliente OAuth</p>
        <p className="text-xs text-gray-400">Google Auth Platform → Clientes → cliente "Aplicativo da Web" → baixar JSON (começa com {"{\"web\":"}). O arquivo fica guardado criptografado e nunca é exibido.</p>
        <input ref={arquivo} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void enviar(e)} />
        <Button type="button" variant="outline" className="mt-2" disabled={salvar.isPending} onClick={() => arquivo.current?.click()}>
          {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}{status?.credencial ? "Trocar JSON" : "Enviar JSON"}
        </Button>
        {status && <p className="mt-2 break-all text-xs text-gray-400">URI de redirecionamento a cadastrar no Google: <code className="text-[#E8C879]">{status.callback}</code></p>}
        {aviso && <p role="alert" className="mt-2 text-xs text-amber-300">{aviso}</p>}
      </li>
      <li className="rounded-lg bg-[#1A2332] p-3"><p className="font-semibold">2. Conecte a sua conta Google</p>
        <p className="text-xs text-gray-400">Você será levado ao Google para autorizar. O sistema só acessa os arquivos que ele mesmo criar.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" disabled={!status?.credencial} onClick={() => { window.location.href = "/api/google-drive/conectar"; }} className="bg-[#C9A961] font-bold text-[#1A2332]">
            <Link2 className="mr-2 h-4 w-4" />{status?.conectado ? "Reconectar" : "Conectar Google Drive"}
          </Button>
          <Button type="button" variant="outline" disabled={testar.isPending} onClick={() => testar.mutate()}>
            {testar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Testar Google Drive
          </Button>
          {status?.conectado && <Button type="button" variant="outline" disabled={desconectar.isPending}
            onClick={() => { if (window.confirm("Desconectar o Google Drive? Os novos arquivos voltam a ficar no banco do sistema.")) desconectar.mutate(); }}>
            <Unplug className="mr-2 h-4 w-4" /> Desconectar
          </Button>}
        </div>
      </li>
    </ol>
    {r && <div role="status" className={`rounded-lg border p-3 text-sm ${r.ok ? "border-green-500/40 bg-green-500/10 text-green-200" : "border-amber-500/40 bg-amber-500/10 text-amber-100"}`}>
      <p>{r.ok ? "Google Drive funcionando: os próximos arquivos serão gravados no Drive." : "Google Drive indisponível. Os arquivos continuam guardados com segurança no banco do sistema."}</p>
      {r.etapas.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{r.etapas.map((e) => <li key={e.etapa}>{e.etapa}: ok</li>)}</ul>}
      {r.explicacao && <p className="mt-1 text-xs">{r.explicacao}</p>}
    </div>}
  </CardContent></Card>;
}
