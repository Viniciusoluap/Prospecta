// Texto definitivo do termo (17/11/2026): o próprio usuário pode retirar o consentimento em Meu perfil.
// A retirada é registrada no servidor (consentimento.retirar: linha nova de tipo "revogacao", canal "conta"); depois
// dela o modal ConsentimentoNoLogin volta a pedir o aceite (aceitar de novo ou sair).
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROTA_DO_TERMO } from "../../../../shared/termo-consentimento";

export function MeuConsentimento() {
  const utils = trpc.useUtils();
  const { data } = trpc.consentimento.meuConsentimento.useQuery(undefined, { retry: false });
  const [confirmando, setConfirmando] = useState(false);
  const retirar = trpc.consentimento.retirar.useMutation({
    onSuccess: async () => {
      toast.success("Consentimento retirado. A retirada ficou registrada.");
      setConfirmando(false);
      await Promise.all([utils.consentimento.meuConsentimento.invalidate(), utils.consentimento.minhaSituacao.invalidate()]);
    },
    onError: e => toast.error(e.message),
  });
  if (!data) return null;
  return (
    <Card className="mt-6 bg-[#1e2a3a] border-[#2a3a4a]">
      <CardHeader>
        <CardTitle className="text-white">Termo de consentimento</CardTitle>
        <CardDescription className="text-gray-400">
          {data.ativo ? "Você aceitou o termo de consentimento para uso dos seus dados." : data.retirado ? "Você retirou o consentimento." : "Não há aceite do termo registrado nesta conta."}{" "}
          <a href={ROTA_DO_TERMO} target="_blank" rel="noopener noreferrer" className="text-[#C9A961] underline underline-offset-2">Ler o termo</a>
        </CardDescription>
      </CardHeader>
      {data.ativo && <CardContent className="space-y-3">
        {!confirmando ? (
          <Button type="button" variant="outline" onClick={() => setConfirmando(true)} className="border-red-400/50 bg-transparent text-red-300 hover:bg-red-400/10">
            Retirar consentimento
          </Button>
        ) : (
          <div role="alertdialog" aria-label="Confirmar retirada" className="space-y-3 rounded-md border border-red-400/40 bg-red-400/5 p-3 text-sm text-gray-100">
            <p>A retirada fica registrada e vale a partir de agora. Ela não desfaz o que foi feito antes, e o sistema vai pedir o aceite de novo para você continuar usando a área logada.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" disabled={retirar.isPending} onClick={() => retirar.mutate({ confirmar: true })}>Confirmar retirada</Button>
              <Button type="button" variant="ghost" disabled={retirar.isPending} onClick={() => setConfirmando(false)} className="text-gray-300">Cancelar</Button>
            </div>
          </div>
        )}
      </CardContent>}
    </Card>
  );
}
