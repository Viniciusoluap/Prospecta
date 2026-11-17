// EPIC-024 S-12: uma linha, um toque — caixa DESMARCADA, frase curta e link para o termo completo.
import { FRASE_CURTA_DO_TERMO, ROTA_DO_TERMO } from "../../../../shared/termo-consentimento";

export function CaixaDoTermo({ marcado, onChange, aviso, opcional = false }: {
  marcado: boolean; onChange: (v: boolean) => void; aviso?: string | null; opcional?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3 rounded-md border border-[#C9A961]/30 bg-[#1A2332] p-3">
        <input
          id="aceite-termo"
          type="checkbox"
          checked={marcado}
          onChange={e => onChange(e.target.checked)}
          aria-describedby={aviso ? "aviso-termo" : undefined}
          aria-invalid={aviso ? true : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#C9A961] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A961]"
        />
        <p className="text-sm leading-snug text-gray-100">
          <label htmlFor="aceite-termo" className="cursor-pointer">
            {FRASE_CURTA_DO_TERMO}{opcional ? " (opcional)" : ""}
          </label>{" "}
          <a href={ROTA_DO_TERMO} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#C9A961] underline underline-offset-2">
            Ler o termo completo
          </a>
        </p>
      </div>
      {aviso && <p id="aviso-termo" role="alert" className="text-sm font-medium text-red-300">{aviso}</p>}
    </div>
  );
}
