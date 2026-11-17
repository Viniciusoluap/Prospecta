// EPIC-024 S-12 (17/11/2026) — termo de consentimento aceito ao criar a senha do primeiro acesso.
// Arquivo ÚNICO do termo: para trocar o texto, edite aqui e suba `VERSAO_DO_TERMO` (aceites antigos continuam válidos;
// pedir novo aceite depende da opção CONSENTIMENTO_PEDIR_NO_LOGIN, desligada — ver server/consentimento.ts).
// Texto provisório, escrito em linguagem simples: precisa ser revisado pelo jurídico antes de ser tratado como final.
// O texto mostrado ao público só tem frases neutras e verdadeiras; o que falta o jurídico definir fica em
// PENDENCIAS_DO_JURIDICO, mostrada SÓ ao administrador (QA S-12, achado 2). Não afirma conformidade legal.
import { ENDERECO_DA_SEDE } from "./empresa.js";

/** Versão vigente do termo. Mude sempre que o texto mudar (ex.: "2026-11-17.2" → "2026-12-01.1"). */
// Histórico: "2026-11-17.1" (primeiro texto, nunca aceito em produção) → "2026-11-17.2" (QA S-12: seção de IA com o
// atendimento automático pelo WhatsApp e a leitura de documentos; textos neutros no lugar dos marcadores do jurídico).
export const VERSAO_DO_TERMO = "2026-11-17.2";

/** Frase curta que aparece ao lado da caixa de seleção, na tela de criar a senha. */
export const FRASE_CURTA_DO_TERMO =
  "Li e concordo com o tratamento dos meus dados pela Prospecta, inclusive por inteligência artificial no atendimento pelo WhatsApp e na leitura de documentos.";

/** Aviso que aparece quando a pessoa tenta salvar sem marcar a caixa. */
export const AVISO_SEM_ACEITE = "Para criar a senha, marque a caixa de concordância com o termo.";

/** Rota pública com o termo completo. */
export const ROTA_DO_TERMO = "/termo-de-consentimento";

export const TITULO_DO_TERMO = "Termo de consentimento para uso dos seus dados";

/** Aviso mostrado só ao administrador, na tela de consulta. */
export const AVISO_TEXTO_PROVISORIO = "Texto provisório — revisar com o jurídico.";

export type SecaoDoTermo = { titulo: string; paragrafos: string[] };

export const SECOES_DO_TERMO: readonly SecaoDoTermo[] = [
  {
    titulo: "1. Quem cuida dos seus dados",
    paragrafos: [
      "PROSPECTA CONSTRUÇÕES E AVALIAÇÃO IMOBILIÁRIA LTDA, CNPJ 41.865.900/0001-89, de Imperatriz (MA), aqui chamada de \"Prospecta\".",
      `Endereço: ${ENDERECO_DA_SEDE}.`,
      "Para falar sobre seus dados pessoais, use os contatos do item 7.",
    ],
  },
  {
    titulo: "2. Quais dados",
    paragrafos: [
      "Os dados que você ou a equipe informam no sistema: nome, CPF ou CNPJ, telefone, e-mail, endereço, documentos enviados, dados do imóvel, da obra, do financiamento e dos pagamentos, e as mensagens trocadas com a Prospecta (inclusive pelo WhatsApp).",
      "Também registramos a data e a hora em que você aceita este termo, a versão aceita e o tipo de aparelho usado (celular, tablet ou computador).",
    ],
  },
  {
    titulo: "3. Para que usamos",
    paragrafos: [
      "Para fazer o seu cadastro e o seu acesso; para o atendimento; para acompanhar processos, regularizações, financiamentos e obras; para cobrança e pagamentos; e para falar com você (WhatsApp, e-mail ou telefone).",
    ],
  },
  {
    titulo: "4. Inteligência artificial",
    paragrafos: [
      "A Prospecta usa inteligência artificial de três formas:",
      "Primeiro atendimento pelo WhatsApp: quando você fala com a Prospecta pelo WhatsApp, as primeiras respostas podem ser dadas por uma assistente automática, que tira dúvidas iniciais e anota o que você procura. Se você pedir para falar com uma pessoa, ou se a assistente não conseguir ajudar, a conversa passa para alguém da equipe.",
      "Leitura de documentos e projetos: documentos, plantas e projetos enviados ao sistema podem ser lidos por inteligência artificial, para ajudar a equipe a fazer avaliações de imóveis e maquetes.",
      "Apoio à equipe: a equipe usa uma assistente de inteligência artificial para consultar informações do sistema e preparar respostas.",
      "Nesses usos, partes dos seus dados (por exemplo: nome, CPF, telefone, e-mail, as mensagens trocadas, os documentos enviados e o andamento dos serviços) são enviadas a um prestador de serviço de inteligência artificial, atualmente a Anthropic, que processa os dados para gerar a resposta. Esse prestador pode ficar fora do Brasil.",
      "A inteligência artificial pode errar. Propostas, valores e contratos são decididos pela equipe da Prospecta.",
    ],
  },
  {
    titulo: "5. Com quem compartilhamos",
    paragrafos: [
      "Com prestadores de serviço de tecnologia que fazem o sistema funcionar (por exemplo: hospedagem, banco de dados, armazenamento de arquivos, envio de e-mail e de mensagens, cobrança e o serviço de inteligência artificial citado acima), e com órgãos públicos, cartórios e bancos quando isso for necessário para o serviço que você contratou ou exigido por lei.",
    ],
  },
  {
    titulo: "6. Por quanto tempo",
    paragrafos: [
      "Enquanto você tiver conta ou relação com a Prospecta, e depois pelo tempo exigido por lei ou necessário para defender direitos.",
    ],
  },
  {
    titulo: "7. Seus direitos e como pedir",
    paragrafos: [
      "Você pode pedir: acesso aos seus dados, correção, informações sobre com quem foram compartilhados, e a retirada deste consentimento (a retirada não desfaz o que já foi feito antes dela e pode impedir parte do atendimento pelo sistema).",
      "Para pedir, escreva para atendimento@prospectaconstrucoes.com ou fale com a equipe pelo telefone (99) 98139-2210. Responderemos no prazo previsto em lei.",
      "Para retirar este consentimento, use esses mesmos contatos (e-mail ou telefone) e diga que quer retirá-lo; a equipe da Prospecta cuida do pedido.",
    ],
  },
  {
    titulo: "8. Mudanças neste termo",
    paragrafos: [
      "Se este termo mudar, a nova versão ficará nesta mesma página. O sistema guarda qual versão você aceitou e quando.",
    ],
  },
];

/**
 * Pontos que o jurídico ainda precisa revisar. Mostrados SÓ na janela do administrador ("Usuários e acesso" › Termo de
 * consentimento), junto com AVISO_TEXTO_PROVISORIO — nunca na página pública nem na caixa.
 */
export const PENDENCIAS_DO_JURIDICO: readonly string[] = [
  "Item 1 — endereço: hoje é o endereço do site; confirmar se é o endereço oficial da sede.",
  "Item 1 — encarregado pelos dados pessoais: definir nome e contato (hoje o texto manda usar os contatos do item 7).",
  "Item 6 — prazo de guarda dos dados depois do fim da relação (hoje: \"pelo tempo exigido por lei\").",
  "Item 7 — prazo de resposta aos pedidos do titular (hoje: \"no prazo previsto em lei\").",
  "Item 7 — retirada do consentimento: hoje é só pelos contatos (e-mail ou telefone); o sistema não registra a retirada nem tem botão para isso.",
];

/** Canais (telas) em que o aceite pode ser registrado. */
export const CANAIS_DO_CONSENTIMENTO = ["definir_senha", "login"] as const;
export type CanalDoConsentimento = (typeof CANAIS_DO_CONSENTIMENTO)[number];
