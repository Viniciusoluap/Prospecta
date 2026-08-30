import { BudgetRequestForm } from "@/components/marketing/budget-request-form";

export default function ProjetosOrcamentosPage() {
  return <div className="bg-gray-50 py-14"><div className="max-w-4xl mx-auto px-4"><span className="text-xs uppercase tracking-widest font-bold text-[var(--brand-yellow-dark)]">Do terreno às chaves</span><h1 className="text-4xl md:text-5xl font-black text-[var(--brand-dark)] mt-2">Projetos e orçamentos</h1><p className="text-gray-500 my-6 max-w-2xl">Solicite um estudo personalizado para construção, reforma, projeto de engenharia, financiamento ou avaliação imobiliária.</p><BudgetRequestForm /></div></div>;
}
