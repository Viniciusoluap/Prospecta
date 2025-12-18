import { APP_TITLE } from "@/const";
import { Link } from "wouter";

export default function Regulamento() {
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
          <h1 className="text-4xl font-bold text-[#C9A961] mb-6">Regulamento do Sorteio</h1>
          <p className="text-gray-400 mb-8">Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>

          <div className="space-y-8 text-gray-300">
            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">1. Organizador</h2>
              <p>
                O sorteio é promovido por <strong>EFFICAZ PROMOÇÃO DE VENDAS</strong>, CNPJ 41.865.900/0001-89, 
                com sede em Imperatriz - MA, denominado simplesmente como "Organizador".
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">2. Objetivo</h2>
              <p>
                O sorteio tem como objetivo promover a venda de bilhetes para arrecadação de fundos, 
                com premiação em UTEFs (Unidades de Troca do Ecossistema Efficaz), que podem ser convertidos 
                em produtos e serviços oferecidos pelo Grupo Efficaz.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">3. Participação</h2>
              <p className="mb-4">
                <strong>3.1.</strong> Podem participar do sorteio todas as pessoas físicas maiores de 18 anos, 
                residentes no território nacional, que adquirirem bilhetes através da plataforma {APP_TITLE}.
              </p>
              <p className="mb-4">
                <strong>3.2.</strong> Cada bilhete adquirido gera um número único de participação no sorteio.
              </p>
              <p>
                <strong>3.3.</strong> Não há limite de bilhetes por participante.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">4. Mecânica do Sorteio</h2>
              <p className="mb-4">
                <strong>4.1.</strong> O sorteio será realizado com base no resultado da <strong>Loteria Federal</strong>, 
                conforme data divulgada na plataforma.
              </p>
              <p className="mb-4">
                <strong>4.2.</strong> O número sorteado será determinado pelos <strong>5 últimos dígitos do 1º prêmio</strong> 
                da Loteria Federal.
              </p>
              <p className="mb-4">
                <strong>4.3.</strong> O participante cujo número de bilhete corresponder ao resultado será declarado vencedor.
              </p>
              <p>
                <strong>4.4.</strong> Em caso de não haver bilhete correspondente ao número sorteado, será considerado 
                vencedor o bilhete com numeração imediatamente anterior ao número sorteado.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">5. Premiação</h2>
              <p className="mb-4">
                <strong>5.1.</strong> O prêmio será creditado em <strong>UTEFs (Unidades de Troca do Ecossistema Efficaz)</strong>, 
                conforme valor divulgado na campanha do sorteio.
              </p>
              <p className="mb-4">
                <strong>5.2.</strong> <strong>1 UTEF = R$ 1,00</strong> para conversão em produtos e serviços.
              </p>
              <p className="mb-4">
                <strong>5.3.</strong> Os UTEFs podem ser utilizados para adquirir:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-2 mb-4">
                <li>Imóveis (casas, terrenos)</li>
                <li>Serviços de construção civil</li>
                <li>Produtos náuticos (lanchas, jet skis, aeronaves)</li>
                <li>Crédito financeiro</li>
              </ul>
              <p>
                <strong>5.4.</strong> O prêmio não pode ser convertido em dinheiro, apenas em produtos/serviços do ecossistema.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">6. Divulgação do Resultado</h2>
              <p className="mb-4">
                <strong>6.1.</strong> O resultado será divulgado na plataforma {APP_TITLE} em até 24 horas após a realização do sorteio.
              </p>
              <p className="mb-4">
                <strong>6.2.</strong> O vencedor será notificado por e-mail e/ou telefone cadastrado.
              </p>
              <p>
                <strong>6.3.</strong> O vencedor terá 30 dias para reivindicar o prêmio, sob pena de perda do direito.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">7. Responsabilidades</h2>
              <p className="mb-4">
                <strong>7.1.</strong> O Organizador não se responsabiliza por problemas técnicos que impeçam a participação.
              </p>
              <p className="mb-4">
                <strong>7.2.</strong> O Organizador reserva-se o direito de cancelar ou adiar o sorteio em caso de força maior.
              </p>
              <p>
                <strong>7.3.</strong> Casos omissos serão resolvidos pelo Organizador.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">8. Disposições Finais</h2>
              <p className="mb-4">
                <strong>8.1.</strong> A participação no sorteio implica na aceitação integral deste regulamento.
              </p>
              <p className="mb-4">
                <strong>8.2.</strong> O Organizador poderá alterar este regulamento a qualquer momento, mediante divulgação prévia.
              </p>
              <p>
                <strong>8.3.</strong> Dúvidas podem ser esclarecidas através do e-mail: <a href="mailto:contato@grupoefficaz.com.br" className="text-[#C9A961] hover:underline">contato@grupoefficaz.com.br</a>
              </p>
            </section>

            <section className="border-t border-[#C9A961]/20 pt-6 mt-8">
              <p className="text-sm text-gray-400">
                Este regulamento está em conformidade com a legislação brasileira vigente e pode ser alterado 
                sem aviso prévio. Recomendamos a leitura atenta antes de participar.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
