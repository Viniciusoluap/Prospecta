import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "./ui/button";

/**
 * Páginas que já fornecem um retorno contextual no próprio cabeçalho.
 * O botão global fica reservado para as demais rotas, evitando duplicidade.
 */
export function hasPageBackButton(location: string) {
  return [
    "/sorteios",
    "/comprar-bilhete/",
    "/produtos",
    "/imoveis",
    "/imoveis/",
    "/servicos",
    "/sobre",
    "/contato",
    "/mercado",
    "/cursos",
    "/instituto",
    "/meus-bilhetes",
    "/meu-saldo",
    "/perfil",
    "/converter-produto/",
    "/como-funciona",
    "/comprar-utef",
    "/projetos-orcamentos",
    "/obras",
    "/obras/",
    "/admin/obras",
    "/admin/obras/editar/",
    "/admin/obras/",
    "/admin",
    "/admin/corretores",
    "/admin/comissoes",
    "/admin/projetos",
    "/admin/mapa",
    "/admin/dashboard",
    "/admin/emails",
    "/admin/configuracoes-pagamento",
    "/admin/crm",
    "/admin/crm/",
    "/admin/tarefas",
    "/admin/agenda",
    "/admin/tarefas-agenda",
    "/admin/whatsapp",
    "/admin/bpo",
    "/admin/contabilidade",
    "/admin/financeiro",
    "/admin/relatorios",
    "/admin/regularizacoes",
    "/admin/agregador",
    "/admin/imoveis",
    "/admin/imoveis/",
    "/admin/incorporacao",
    "/admin/incorporacao/",
    "/admin/avaliacoes",
    "/admin/avaliacoes/",
    "/admin/financiamentos",
    "/admin/juridico",
    "/admin/configuracoes",
    "/regulamento",
    "/termos-de-uso",
    "/politica-de-privacidade",
    "/faq",
    "/simulador",
  ].some(route =>
    route.endsWith("/") ? location.startsWith(route) : location === route
  );
}

/**
 * Retorno único no canto superior esquerdo para rotas que não têm retorno
 * próprio. Mantém a navegação pelo histórico; em acesso direto usa a área pai.
 */
export function GlobalBackButton() {
  const [location, setLocation] = useLocation();

  if (location === "/" || location === "/login" || hasPageBackButton(location)) {
    return null;
  }

  const fallback = location.startsWith("/admin")
    ? "/admin"
    : location.startsWith("/portal")
      ? "/portal"
      : "/";

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation(fallback);
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={goBack}
      aria-label="Voltar à página anterior"
      className="fixed left-4 top-4 z-50 h-10 gap-2 border-[#C9A961]/70 bg-[#1A2332]/95 px-3 text-[#C9A961] shadow-lg backdrop-blur hover:bg-[#2C3E50] hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      <span>Voltar</span>
    </Button>
  );
}
