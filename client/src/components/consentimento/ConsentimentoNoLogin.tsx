// EPIC-024 S-12, item 4: "pedir o aceite uma vez no próximo login" — pronto, mas DESLIGADO por padrão.
// Só aparece quando o servidor tem CONSENTIMENTO_PEDIR_NO_LOGIN=1 e a pessoa logada ainda não aceitou a versão vigente.
// Consulta só nas áreas logadas (nunca na parte pública do site).
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AVISO_SEM_ACEITE, TITULO_DO_TERMO } from "../../../../shared/termo-consentimento";
import { CaixaDoTermo } from "./CaixaDoTermo";

const AREAS_LOGADAS = ["/admin", "/portal", "/corretor", "/empreiteiro", "/perfil"];

export function ConsentimentoNoLogin() {
  const [local] = useLocation();
  const areaLogada = AREAS_LOGADAS.some(a => local === a || local.startsWith(`${a}/`));
  const { data } = trpc.consentimento.minhaSituacao.useQuery(undefined, { enabled: areaLogada, staleTime: Infinity, retry: false });
  const utils = trpc.useUtils();
  const [marcado, setMarcado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const aceitar = trpc.consentimento.aceitar.useMutation({
    onSuccess: () => utils.consentimento.minhaSituacao.invalidate(),
    onError: e => setAviso(e.message),
  });
  if (!areaLogada || !data?.pedir) return null;
  return (
    <Dialog open>
      <DialogContent className="max-w-lg border-[#C9A961]/30 bg-[#1A2332] text-white [&>button]:hidden" onEscapeKeyDown={e => e.preventDefault()} onPointerDownOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-[#C9A961]">{TITULO_DO_TERMO}</DialogTitle>
          <DialogDescription className="text-gray-300">Antes de continuar, leia e confirme. É uma vez só.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={e => {
          e.preventDefault();
          if (!marcado) { setAviso(AVISO_SEM_ACEITE.replace("criar a senha", "continuar")); return; }
          aceitar.mutate({ aceitouTermo: true, versaoDoTermo: data.versao });
        }}>
          <CaixaDoTermo marcado={marcado} onChange={v => { setMarcado(v); if (v) setAviso(null); }} aviso={aviso} />
          <Button type="submit" disabled={aceitar.isPending} className="w-full bg-[#C9A961] font-bold text-[#1A2332]">Continuar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
