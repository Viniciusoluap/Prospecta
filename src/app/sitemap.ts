import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://prospectaconstrucoes.com").replace(/\/$/, "");

const publicRoutes = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/simulador", changeFrequency: "monthly", priority: 0.9 },
  { path: "/projetos-orcamentos", changeFrequency: "monthly", priority: 0.9 },
  { path: "/imoveis", changeFrequency: "daily", priority: 0.9 },
  { path: "/mercado", changeFrequency: "daily", priority: 0.8 },
  { path: "/sorteios", changeFrequency: "daily", priority: 0.8 },
  { path: "/utef", changeFrequency: "daily", priority: 0.8 },
  { path: "/produtos", changeFrequency: "weekly", priority: 0.8 },
  { path: "/instituto", changeFrequency: "monthly", priority: 0.7 },
  { path: "/servicos", changeFrequency: "monthly", priority: 0.7 },
  { path: "/como-funciona", changeFrequency: "monthly", priority: 0.7 },
  { path: "/sobre", changeFrequency: "monthly", priority: 0.6 },
  { path: "/cursos", changeFrequency: "monthly", priority: 0.6 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contato", changeFrequency: "monthly", priority: 0.6 },
  { path: "/regulamento", changeFrequency: "yearly", priority: 0.4 },
  { path: "/politica-de-privacidade", changeFrequency: "yearly", priority: 0.3 },
  { path: "/termos-de-uso", changeFrequency: "yearly", priority: 0.3 },
] as const satisfies ReadonlyArray<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}>;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map(({ path, changeFrequency, priority }) => ({
    url: `${siteUrl}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
