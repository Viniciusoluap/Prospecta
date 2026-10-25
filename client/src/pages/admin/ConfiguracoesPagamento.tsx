// LOTE B (25/10): a chave do Asaas (e a da Pluggy) agora ficam só em Configurações › Integrações.
// Esta rota antiga (/admin/configuracoes-pagamento, "API Contas") continua existindo como atalho.
import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function ConfiguracoesPagamento() {
  return <LegacyRedirect to="/admin/integracoes" />;
}
