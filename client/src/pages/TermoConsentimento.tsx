// EPIC-024 S-12: termo completo em página própria (aberta pelo link "Ler o termo completo"), legível no celular.
import { TextoDoTermo } from "@/components/consentimento/TextoDoTermo";

export default function TermoConsentimento() {
  return (
    // pt-20: o botão global "Voltar" (fixo, top-4, 40 px) não cobre o cabeçalho no celular (QA S-12, achado 7).
    <div className="min-h-screen bg-[#1A2332] px-4 pb-8 pt-20 text-gray-100">
      <main className="mx-auto w-full max-w-2xl rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] p-5 md:p-8">
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-gray-300">Prospecta Empreendimentos</p>
        <TextoDoTermo />
      </main>
    </div>
  );
}
