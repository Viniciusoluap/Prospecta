// EPIC-029 S-1 — aviso abaixo do campo de CNPJ/CEP: consultando, preenchido, alerta da situação na Receita e o botão
// "Usar dados da Receita" quando há campos já digitados com outro valor (nunca sobrescreve em silêncio).
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EstadoConsulta } from "@/hooks/useAutoPreenchimentoCadastral";

const ROTULOS_PADRAO: Record<string, string> = {
  razaoSocial: "Razão social", nome: "Nome", companyName: "Nome da empresa", name: "Nome",
  logradouro: "Logradouro", bairro: "Bairro", cidade: "Cidade", uf: "UF", address: "Endereço", city: "Cidade", state: "UF",
};

export function AvisoConsultaCadastral({ estado, textoBotao = "Usar dados da Receita", rotulos = {} }: {
  estado: EstadoConsulta<unknown>;
  /** CNPJ: "Usar dados da Receita"; CEP: "Usar endereço do CEP". */
  textoBotao?: string;
  rotulos?: Record<string, string>;
}) {
  if (estado.situacao === "ocioso") return null;
  const conflitos = Object.entries(estado.conflitos);
  return (
    <div className="mt-1 space-y-1 text-xs" aria-live="polite">
      {estado.situacao === "consultando" && (
        <p className="flex items-center gap-1 text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> Consultando…</p>
      )}
      {estado.alerta && (
        <p role="alert" className="flex items-start gap-1 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {estado.alerta}
        </p>
      )}
      {estado.mensagem && <p className={estado.situacao === "erro" ? "text-red-300" : "text-gray-400"}>{estado.mensagem}</p>}
      {conflitos.length > 0 && (
        <div className="rounded border border-[#C9A961]/30 p-2 text-gray-300">
          <p>A consulta trouxe dados diferentes do que já foi digitado:</p>
          <ul className="ml-4 list-disc">
            {conflitos.map(([k, v]) => <li key={k}><span className="text-gray-400">{rotulos[k] ?? ROTULOS_PADRAO[k] ?? k}:</span> {v}</li>)}
          </ul>
          <div className="mt-1 flex gap-2">
            <Button type="button" size="sm" className="h-7 bg-[#C9A961] text-[#1A2332] hover:bg-[#C9A961]/90" onClick={estado.usarDados}>
              {textoBotao}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-gray-300" onClick={estado.descartar}>Manter o que digitei</Button>
          </div>
        </div>
      )}
    </div>
  );
}
