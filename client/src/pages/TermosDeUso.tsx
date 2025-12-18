import { APP_TITLE } from "@/const";
import { Link } from "wouter";

export default function TermosDeUso() {
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
          <h1 className="text-4xl font-bold text-[#C9A961] mb-6">Termos de Uso</h1>
          <p className="text-gray-400 mb-8">Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>

          <div className="space-y-8 text-gray-300">
            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">1. Aceitação dos Termos</h2>
              <p>
                Ao acessar e utilizar a plataforma <strong>{APP_TITLE}</strong>, você concorda em cumprir e estar 
                vinculado aos seguintes Termos de Uso. Se você não concordar com qualquer parte destes termos, 
                não deverá utilizar nossos serviços.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">2. Definições</h2>
              <p className="mb-4">
                <strong>2.1. Plataforma:</strong> Refere-se ao website {APP_TITLE} e todos os seus serviços associados.
              </p>
              <p className="mb-4">
                <strong>2.2. Usuário:</strong> Qualquer pessoa que acesse ou utilize a Plataforma.
              </p>
              <p className="mb-4">
                <strong>2.3. UTEF:</strong> Unidade de Troca do Ecossistema Efficaz, moeda digital interna da plataforma.
              </p>
              <p>
                <strong>2.4. Grupo Efficaz:</strong> Conjunto de empresas que compõem o ecossistema (Prospecta Construções, 
                Exclusive Clubitz, Efficaz Financeira).
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">3. Cadastro e Conta de Usuário</h2>
              <p className="mb-4">
                <strong>3.1.</strong> Para utilizar determinados recursos da Plataforma, você deve criar uma conta fornecendo 
                informações precisas, atuais e completas.
              </p>
              <p className="mb-4">
                <strong>3.2.</strong> Você é responsável por manter a confidencialidade de sua senha e por todas as atividades 
                que ocorram em sua conta.
              </p>
              <p className="mb-4">
                <strong>3.3.</strong> Você concorda em notificar imediatamente o Grupo Efficaz sobre qualquer uso não autorizado 
                de sua conta.
              </p>
              <p>
                <strong>3.4.</strong> O Grupo Efficaz reserva-se o direito de suspender ou encerrar contas que violem estes Termos.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">4. Uso da Plataforma</h2>
              <p className="mb-4">
                <strong>4.1.</strong> Você concorda em usar a Plataforma apenas para fins legais e de acordo com estes Termos.
              </p>
              <p className="mb-4">
                <strong>4.2.</strong> É proibido:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Usar a Plataforma de maneira fraudulenta ou enganosa</li>
                <li>Transmitir vírus, malware ou qualquer código malicioso</li>
                <li>Violar direitos de propriedade intelectual</li>
                <li>Coletar dados de outros usuários sem consentimento</li>
                <li>Interferir no funcionamento da Plataforma</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">5. UTEFs e Transações</h2>
              <p className="mb-4">
                <strong>5.1.</strong> UTEFs são créditos digitais internos da Plataforma, onde <strong>1 UTEF = R$ 1,00</strong> 
                para conversão em produtos e serviços.
              </p>
              <p className="mb-4">
                <strong>5.2.</strong> UTEFs podem ser adquiridos através de:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Compra direta na plataforma</li>
                <li>Participação em sorteios</li>
                <li>Promoções e bônus</li>
              </ul>
              <p className="mb-4">
                <strong>5.3.</strong> UTEFs <strong>não podem ser convertidos em dinheiro</strong>, apenas em produtos e serviços 
                do ecossistema Efficaz.
              </p>
              <p className="mb-4">
                <strong>5.4.</strong> Todas as transações são finais e não reembolsáveis, exceto conforme exigido por lei.
              </p>
              <p>
                <strong>5.5.</strong> O Grupo Efficaz reserva-se o direito de modificar o valor de conversão dos UTEFs mediante 
                aviso prévio de 30 dias.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">6. Propriedade Intelectual</h2>
              <p className="mb-4">
                <strong>6.1.</strong> Todo o conteúdo da Plataforma, incluindo textos, gráficos, logos, ícones, imagens e software, 
                é propriedade do Grupo Efficaz ou de seus licenciadores.
              </p>
              <p>
                <strong>6.2.</strong> É proibida a reprodução, distribuição ou modificação de qualquer conteúdo sem autorização prévia.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">7. Limitação de Responsabilidade</h2>
              <p className="mb-4">
                <strong>7.1.</strong> A Plataforma é fornecida "como está" e "conforme disponível", sem garantias de qualquer tipo.
              </p>
              <p className="mb-4">
                <strong>7.2.</strong> O Grupo Efficaz não se responsabiliza por:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Interrupções ou erros no funcionamento da Plataforma</li>
                <li>Perda de dados ou informações</li>
                <li>Danos indiretos, incidentais ou consequenciais</li>
                <li>Ações de terceiros</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">8. Modificações dos Termos</h2>
              <p>
                O Grupo Efficaz reserva-se o direito de modificar estes Termos a qualquer momento. As alterações 
                entrarão em vigor imediatamente após a publicação na Plataforma. O uso continuado da Plataforma 
                após as modificações constitui aceitação dos novos Termos.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">9. Lei Aplicável e Foro</h2>
              <p>
                Estes Termos serão regidos e interpretados de acordo com as leis do Brasil. Qualquer disputa 
                relacionada a estes Termos será resolvida no foro da comarca de Imperatriz - MA.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">10. Contato</h2>
              <p>
                Para dúvidas ou questões sobre estes Termos, entre em contato:
              </p>
              <ul className="list-none ml-4 mt-4 space-y-2">
                <li><strong>Email:</strong> <a href="mailto:contato@grupoefficaz.com.br" className="text-[#C9A961] hover:underline">contato@grupoefficaz.com.br</a></li>
                <li><strong>Telefone:</strong> (99) 98139-2210 | (94) 99304-4689</li>
                <li><strong>Endereço:</strong> Imperatriz - MA</li>
              </ul>
            </section>

            <section className="border-t border-[#C9A961]/20 pt-6 mt-8">
              <p className="text-sm text-gray-400">
                Ao utilizar a plataforma {APP_TITLE}, você declara ter lido, compreendido e concordado com estes 
                Termos de Uso em sua totalidade.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
