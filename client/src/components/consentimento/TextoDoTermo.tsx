// EPIC-024 S-12: texto completo do termo (fonte única em shared/termo-consentimento.ts).
import { SECOES_DO_TERMO, TITULO_DO_TERMO, VERSAO_DO_TERMO } from "../../../../shared/termo-consentimento";

export function TextoDoTermo({ comTitulo = true }: { comTitulo?: boolean }) {
  return (
    <article className="space-y-5 text-[15px] leading-relaxed text-gray-100">
      {comTitulo && <h1 className="text-2xl font-bold text-[#C9A961]">{TITULO_DO_TERMO}</h1>}
      <p className="text-sm text-gray-300">Versão {VERSAO_DO_TERMO}</p>
      {SECOES_DO_TERMO.map(secao => (
        <section key={secao.titulo} className="space-y-2">
          <h2 className="text-lg font-semibold text-[#C9A961]">{secao.titulo}</h2>
          {secao.paragrafos.map(p => <p key={p} className="break-words">{p}</p>)}
        </section>
      ))}
    </article>
  );
}
