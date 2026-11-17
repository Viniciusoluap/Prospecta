// EPIC-024 S-12: termo de consentimento ao entrar numa área logada (modal que não fecha sem aceitar; dá para sair).
// Aparece quando o servidor (consentimento.minhaSituacao) diz `pedir: true`:
//   - conta criada a partir de 17/11/2026 sem nenhum aceite — é o caso de quem recebeu a senha pronta do admin
//     (portal.admin.provisionAccess, /api/auth/setup-admin) e não passou pela tela de criar senha (QA S-12, achado 1);
//   - qualquer conta sem o aceite da versão vigente, só se CONSENTIMENTO_PEDIR_NO_LOGIN=1 (item 4, desligado).
// Consulta só nas áreas logadas (nunca na parte pública do site). O modal é a trava: o servidor não bloqueia as demais
// rotas de quem ainda não aceitou (limitação registrada na story).
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AVISO_SEM_ACEITE, TITULO_DO_TERMO } from "../../../../shared/termo-consentimento";
import { CaixaDoTermo } from "./CaixaDoTermo";

/** Prefixos das áreas logadas: painel, portal do cliente, área do corretor, empreiteiro e páginas da conta. */
export const AREAS_LOGADAS = [
  "/admin", "/portal", "/corretor", "/empreiteiro", "/perfil", "/notificacoes", "/converter-produto",
  "/meus-bilhetes", "/meu-saldo", "/minhas-conversoes", "/obras",
];

export function ehAreaLogada(local: string): boolean {
  return AREAS_LOGADAS.some(a => local === a || local.startsWith(`${a}/`));
}

export function ConsentimentoNoLogin() {
  const [local] = useLocation();
  const areaLogada = ehAreaLogada(local);
  const { data } = trpc.consentimento.minhaSituacao.useQuery(undefined, { enabled: areaLogada, staleTime: Infinity, retry: false });
  if (!areaLogada || !data?.pedir) return null;
  return <ModalDoTermo versao={data.versao} />;
}

function ModalDoTermo({ versao }: { versao: string }) {
  const utils = trpc.useUtils();
  const { logout } = useAuth();
  const [marcado, setMarcado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const aceitar = trpc.consentimento.aceitar.useMutation({
    onSuccess: () => utils.consentimento.minhaSituacao.invalidate(),
    onError: e => setAviso(e.message),
  });
  async function sair() {
    setSaindo(true);
    try { await logout(); } finally { window.location.assign("/login"); }
  }
  return (
    <Dialog open>
      <DialogContent
        className="max-h-[90vh] max-w-lg overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white [&>button]:hidden"
        onEscapeKeyDown={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-[#C9A961]">{TITULO_DO_TERMO}</DialogTitle>
          <DialogDescription className="text-gray-300">Antes de continuar, leia e confirme. É uma vez só.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={e => {
          e.preventDefault();
          if (!marcado) {
            setAviso(AVISO_SEM_ACEITE.replace("criar a senha", "continuar"));
            document.getElementById("aceite-termo")?.focus();
            return;
          }
          aceitar.mutate({ aceitouTermo: true, versaoDoTermo: versao });
        }}>
          <CaixaDoTermo marcado={marcado} onChange={v => { setMarcado(v); if (v) setAviso(null); }} aviso={aviso} />
          <Button type="submit" disabled={aceitar.isPending || saindo} className="w-full bg-[#C9A961] font-bold text-[#1A2332]">Continuar</Button>
          <Button type="button" variant="ghost" disabled={saindo} onClick={sair} className="w-full text-gray-300 hover:bg-white/5 hover:text-white">
            Sair
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
