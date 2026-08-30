import type { Metadata } from "next";
import { ProspectaHome } from "@/components/marketing/prospecta-home";

export const metadata: Metadata = {
  title: "Início",
  description:
    "Prospecta Construções: financiamento do terreno à construção, projetos, imóveis e Ecossistema VFX Capital com sorteios e UTEFs.",
  keywords: [
    "construção civil",
    "financiamento imobiliário",
    "projetos arquitetônicos",
    "sorteios",
    "UTEF",
    "Imperatriz MA",
    "Prospecta Construções",
  ],
};

export default function HomePage() {
  return <ProspectaHome />;
}
