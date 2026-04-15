import { APP_TITLE } from "@/const";
import { Link } from "wouter";

export default function PoliticaDePrivacidade() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {/* Header */}
      <div className="bg-[#1A2332]/80 backdrop-blur-sm border-b border-[#C9A961]/20 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Link href="/">
            <a className="text-[#C9A961] hover:text-[#B8935A] transition-colors">
              ← Voltar para Home
            </a>
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto bg-[#1A2332]/60 backdrop-blur-sm border border-[#C9A961]/20 rounded-lg p-8">
          <h1 className="text-4xl font-bold text-[#C9A961] mb-6">
            Política de Privacidade
          </h1>
          <p className="text-gray-400 mb-8">
            Última atualização: {new Date().toLocaleDateString("pt-BR")}
          </p>

          <div className="space-y-8 text-gray-300">
            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                1. Introdução
              </h2>
              <p>
                A <strong>EFFICAZ PROMOÇÃO DE VENDAS</strong>, CNPJ
                41.865.900/0001-89, valoriza a privacidade de seus usuários e
                está comprometida em proteger seus dados pessoais. Esta Política
                de Privacidade descreve como coletamos, usamos, armazenamos e
                compartilhamos suas informações quando você utiliza a plataforma{" "}
                {APP_TITLE}.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                2. Dados Coletados
              </h2>
              <p className="mb-4">
                <strong>2.1. Dados Fornecidos por Você:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Nome completo</li>
                <li>Endereço de e-mail</li>
                <li>Número de telefone</li>
                <li>CPF (quando necessário para transações)</li>
                <li>Endereço de entrega/cobrança</li>
                <li>
                  Informações de pagamento (processadas por terceiros seguros)
                </li>
              </ul>
              <p className="mb-4">
                <strong>2.2. Dados Coletados Automaticamente:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Endereço IP</li>
                <li>Tipo de navegador e dispositivo</li>
                <li>Páginas visitadas e tempo de navegação</li>
                <li>Cookies e tecnologias similares</li>
                <li>Localização geográfica aproximada</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                3. Uso dos Dados
              </h2>
              <p className="mb-4">Utilizamos seus dados pessoais para:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Processar transações e gerenciar sua conta</li>
                <li>Enviar confirmações de compra e atualizações de pedidos</li>
                <li>Realizar sorteios e distribuir prêmios</li>
                <li>Melhorar nossos serviços e experiência do usuário</li>
                <li>
                  Enviar comunicações de marketing (com seu consentimento)
                </li>
                <li>Cumprir obrigações legais e regulatórias</li>
                <li>Prevenir fraudes e garantir a segurança da plataforma</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                4. Compartilhamento de Dados
              </h2>
              <p className="mb-4">
                <strong>4.1.</strong> Não vendemos seus dados pessoais a
                terceiros.
              </p>
              <p className="mb-4">
                <strong>4.2.</strong> Podemos compartilhar seus dados com:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>
                  <strong>Processadores de Pagamento:</strong> Para processar
                  transações (ex: Stripe, PayPal)
                </li>
                <li>
                  <strong>Provedores de Serviços:</strong> Para hospedagem,
                  análise de dados e suporte técnico
                </li>
                <li>
                  <strong>Autoridades Legais:</strong> Quando exigido por lei ou
                  para proteger nossos direitos
                </li>
                <li>
                  <strong>Empresas do Grupo Efficaz:</strong> Para fornecer
                  serviços integrados
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                5. Cookies e Tecnologias Similares
              </h2>
              <p className="mb-4">
                <strong>5.1.</strong> Utilizamos cookies para melhorar sua
                experiência na plataforma.
              </p>
              <p className="mb-4">
                <strong>5.2.</strong> Tipos de cookies utilizados:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>
                  <strong>Essenciais:</strong> Necessários para o funcionamento
                  da plataforma
                </li>
                <li>
                  <strong>Funcionais:</strong> Lembram suas preferências
                </li>
                <li>
                  <strong>Analíticos:</strong> Ajudam a entender como você usa a
                  plataforma
                </li>
                <li>
                  <strong>Marketing:</strong> Personalizam anúncios e ofertas
                </li>
              </ul>
              <p>
                <strong>5.3.</strong> Você pode gerenciar cookies através das
                configurações do seu navegador.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                6. Segurança dos Dados
              </h2>
              <p className="mb-4">
                <strong>6.1.</strong> Implementamos medidas técnicas e
                organizacionais para proteger seus dados:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Criptografia SSL/TLS para transmissão de dados</li>
                <li>Armazenamento seguro em servidores protegidos</li>
                <li>Controle de acesso restrito a dados pessoais</li>
                <li>Monitoramento contínuo de segurança</li>
              </ul>
              <p>
                <strong>6.2.</strong> Nenhum sistema é 100% seguro. Você também
                deve tomar precauções para proteger suas informações.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                7. Seus Direitos (LGPD)
              </h2>
              <p className="mb-4">
                De acordo com a Lei Geral de Proteção de Dados (LGPD), você tem
                direito a:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>
                  <strong>Acesso:</strong> Solicitar cópia dos seus dados
                  pessoais
                </li>
                <li>
                  <strong>Correção:</strong> Atualizar dados incompletos ou
                  incorretos
                </li>
                <li>
                  <strong>Exclusão:</strong> Solicitar a remoção de seus dados
                  (com exceções legais)
                </li>
                <li>
                  <strong>Portabilidade:</strong> Receber seus dados em formato
                  estruturado
                </li>
                <li>
                  <strong>Revogação de Consentimento:</strong> Retirar
                  consentimento a qualquer momento
                </li>
                <li>
                  <strong>Oposição:</strong> Opor-se ao tratamento de seus dados
                  em certas situações
                </li>
                <li>
                  <strong>Informação:</strong> Saber com quem compartilhamos
                  seus dados
                </li>
              </ul>
              <p className="mt-4">
                Para exercer seus direitos, entre em contato:{" "}
                <a
                  href="mailto:privacidade@grupoefficaz.com.br"
                  className="text-[#C9A961] hover:underline"
                >
                  privacidade@grupoefficaz.com.br
                </a>
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                8. Retenção de Dados
              </h2>
              <p>
                Mantemos seus dados pessoais apenas pelo tempo necessário para
                cumprir as finalidades descritas nesta Política ou conforme
                exigido por lei. Após esse período, os dados serão excluídos ou
                anonimizados.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                9. Dados de Menores
              </h2>
              <p>
                Nossa plataforma não é destinada a menores de 18 anos. Não
                coletamos intencionalmente dados de menores. Se tomarmos
                conhecimento de que coletamos dados de um menor, tomaremos
                medidas para excluí-los.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                10. Alterações nesta Política
              </h2>
              <p>
                Podemos atualizar esta Política de Privacidade periodicamente.
                Notificaremos você sobre mudanças significativas através da
                plataforma ou por e-mail. Recomendamos revisar esta página
                regularmente.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">
                11. Contato
              </h2>
              <p className="mb-4">
                Para dúvidas sobre esta Política de Privacidade ou sobre o
                tratamento de seus dados:
              </p>
              <ul className="list-none ml-4 space-y-2">
                <li>
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:privacidade@grupoefficaz.com.br"
                    className="text-[#C9A961] hover:underline"
                  >
                    privacidade@grupoefficaz.com.br
                  </a>
                </li>
                <li>
                  <strong>Telefone:</strong> (99) 98139-2210 | (94) 99304-4689
                </li>
                <li>
                  <strong>Endereço:</strong> Imperatriz - MA
                </li>
              </ul>
            </section>

            <section className="border-t border-[#C9A961]/20 pt-6 mt-8">
              <p className="text-sm text-gray-400">
                Esta Política de Privacidade está em conformidade com a Lei
                Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018) e outras
                legislações aplicáveis de proteção de dados no Brasil.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
