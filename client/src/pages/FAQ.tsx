import { APP_TITLE } from "@/const";
import { Link } from "wouter";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface FAQItemProps {
  question: string;
  answer: string;
}

function FAQItem({ question, answer }: FAQItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-[#C9A961]/20 rounded-lg overflow-hidden bg-[#1A2332]/40">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#C9A961]/10 transition-colors"
      >
        <span className="text-[#C9A961] font-semibold pr-4">{question}</span>
        {isOpen ? (
          <ChevronUp className="h-5 w-5 text-[#C9A961] flex-shrink-0" />
        ) : (
          <ChevronDown className="h-5 w-5 text-[#C9A961] flex-shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="px-6 pb-4 text-gray-300">
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  const faqs = [
    {
      question: "O que é o Ecossistema Efficaz?",
      answer: "O Ecossistema Efficaz é uma plataforma integrada que conecta serviços de construção civil (Prospecta), produtos náuticos (Exclusive Clubitz) e serviços financeiros (Efficaz Financeira) através de uma moeda digital interna chamada UTEF."
    },
    {
      question: "O que são UTEFs?",
      answer: "UTEFs (Unidades de Troca do Ecossistema Efficaz) são créditos digitais internos da plataforma. 1 UTEF equivale a R$ 1,00 para conversão em produtos e serviços do ecossistema. UTEFs não podem ser convertidos em dinheiro, apenas em produtos/serviços."
    },
    {
      question: "Como posso adquirir UTEFs?",
      answer: "Você pode adquirir UTEFs de três formas: 1) Compra direta na plataforma através de PIX ou cartão de crédito; 2) Participando de sorteios e ganhando prêmios em UTEFs; 3) Através de promoções e bônus (ex: 10% extra em compras acima de 1000 UTEFs)."
    },
    {
      question: "Como funciona o sorteio?",
      answer: "O sorteio é baseado no resultado da Loteria Federal. Os 5 últimos dígitos do 1º prêmio determinam o número vencedor. Se não houver bilhete correspondente, vence o bilhete com numeração imediatamente anterior. O vencedor recebe o prêmio em UTEFs."
    },
    {
      question: "Posso converter UTEFs em dinheiro?",
      answer: "Não. UTEFs são créditos exclusivos para uso dentro do ecossistema Efficaz. Você pode utilizá-los para adquirir imóveis, serviços de construção, produtos náuticos (lanchas, jet skis), crédito financeiro e outros produtos/serviços oferecidos pelo Grupo Efficaz."
    },
    {
      question: "Quais produtos posso adquirir com UTEFs?",
      answer: "Com UTEFs você pode adquirir: Casas e terrenos (Prospecta Construções), serviços de construção civil, lanchas e jet skis (Exclusive Clubitz), aeronaves, crédito financeiro e outros produtos disponíveis na vitrine da plataforma."
    },
    {
      question: "Como funciona o bônus de 10%?",
      answer: "Ao comprar 1000 UTEFs ou mais em uma única transação, você recebe automaticamente 10% de bônus. Por exemplo: comprando 1000 UTEFs, você recebe 1100 UTEFs no total (1000 + 100 de bônus)."
    },
    {
      question: "Posso cancelar uma compra de UTEFs?",
      answer: "Todas as transações são finais e não reembolsáveis, exceto conforme exigido por lei. Recomendamos revisar cuidadosamente sua compra antes de confirmar."
    },
    {
      question: "Como sei se ganhei o sorteio?",
      answer: "O resultado é divulgado na plataforma em até 24 horas após o sorteio. O vencedor é notificado por e-mail e/ou telefone cadastrado. Você também pode verificar o status dos seus bilhetes na página 'Meus Bilhetes'."
    },
    {
      question: "Quanto tempo tenho para reivindicar o prêmio?",
      answer: "O vencedor tem 30 dias corridos para reivindicar o prêmio após a divulgação do resultado. Após esse prazo, o direito ao prêmio é perdido."
    },
    {
      question: "Posso comprar quantos bilhetes quiser?",
      answer: "Sim, não há limite de bilhetes por participante. Quanto mais bilhetes você comprar, maiores são suas chances de ganhar."
    },
    {
      question: "Como funciona o pagamento?",
      answer: "Aceitamos pagamentos via PIX (instantâneo) e cartão de crédito (através do Stripe). Para PIX, basta escanear o QR Code ou copiar o código. Para cartão, você será redirecionado para uma página segura de pagamento."
    },
    {
      question: "Meus dados estão seguros?",
      answer: "Sim. Utilizamos criptografia SSL/TLS, armazenamento seguro e seguimos as diretrizes da LGPD (Lei Geral de Proteção de Dados). Não compartilhamos seus dados com terceiros sem seu consentimento, exceto quando necessário para processar transações."
    },
    {
      question: "Como funciona a construção de casas pela Prospecta?",
      answer: "A Prospecta oferece financiamento desde o terreno até a construção completa. Você pode usar UTEFs para pagar parte ou todo o valor da obra. Entre em contato através da página 'Projetos e Orçamentos' para receber uma proposta personalizada."
    },
    {
      question: "Posso acompanhar o andamento da minha obra?",
      answer: "Sim! Clientes da Prospecta têm acesso a um painel exclusivo onde podem acompanhar o progresso da obra, ver fotos atualizadas, valores gastos e etapas concluídas em tempo real."
    },
    {
      question: "Como entro em contato com o suporte?",
      answer: "Você pode entrar em contato através do e-mail contato@grupoefficaz.com.br ou pelos telefones (99) 98139-2210 e (94) 99304-4689. Também temos o botão 'Fale Conosco' disponível em todas as páginas."
    },
    {
      question: "O Grupo Efficaz tem lojas físicas?",
      answer: "Sim, temos escritórios em Imperatriz - MA. Para visitas presenciais ou reuniões, entre em contato previamente para agendar."
    },
    {
      question: "Posso usar UTEFs para dar entrada em um imóvel?",
      answer: "Sim! UTEFs podem ser utilizados como entrada para financiamento de imóveis ou para pagamento integral, dependendo do saldo disponível e do valor do imóvel escolhido."
    }
  ];

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
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-[#C9A961] mb-4">Perguntas Frequentes</h1>
            <p className="text-gray-400 text-lg">
              Encontre respostas para as dúvidas mais comuns sobre o {APP_TITLE}
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <FAQItem key={index} question={faq.question} answer={faq.answer} />
            ))}
          </div>

          {/* Contato */}
          <div className="mt-12 bg-[#1A2332]/60 backdrop-blur-sm border border-[#C9A961]/20 rounded-lg p-8 text-center">
            <h2 className="text-2xl font-semibold text-[#C9A961] mb-4">Não encontrou sua resposta?</h2>
            <p className="text-gray-300 mb-6">
              Nossa equipe está pronta para ajudar! Entre em contato conosco.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <a
                href="mailto:contato@grupoefficaz.com.br"
                className="px-6 py-3 bg-[#C9A961] hover:bg-[#B8935A] text-[#1A2332] font-semibold rounded-lg transition-colors"
              >
                Enviar E-mail
              </a>
              <div className="text-gray-400">
                <p>Ou ligue: (99) 98139-2210 | (94) 99304-4689</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
