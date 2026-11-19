// EPIC-024 S-12 (17/11/2026) — termo de consentimento aceito ao criar a senha do primeiro acesso.
// Arquivo ÚNICO do termo: para trocar o texto, edite aqui e suba `VERSAO_DO_TERMO` (aceites antigos continuam válidos;
// pedir novo aceite depende da opção CONSENTIMENTO_PEDIR_NO_LOGIN, desligada — ver server/consentimento.ts).
// Texto definitivo (ordem do dono em 17/11/2026: "faça você mesmo o termo"), escrito em linguagem simples com base na
// LGPD (Lei 13.709/2018). Só afirma o que o sistema faz de verdade; a retirada do consentimento é registrada no sistema
// (tabela `consentimentos`, linha de tipo "revogacao" — migração 0132). Gêmeo no Grupo Santa Fé:
// web/src/lib/termo-consentimento.ts (mesma estrutura; dados da empresa e seção de IA de cada sistema).
import { ENDERECO_DA_SEDE } from "./empresa.js";

/** Versão vigente do termo. Mude sempre que o texto mudar (ex.: "2026-11-17.3" → "2026-12-01.1"). */
export const VERSAO_DO_TERMO = "2026-11-17.3";

/** Histórico das versões (a mais nova primeiro). Aceites antigos continuam valendo para a versão aceita. */
export const HISTORICO_DO_TERMO: readonly { versao: string; resumo: string }[] = [
  { versao: "2026-11-17.3", resumo: "Texto definitivo: encarregado (canal de atendimento ao titular), prazos de guarda, prazo de resposta de 15 dias, lista de direitos e retirada do consentimento registrada no sistema." },
  { versao: "2026-11-17.2", resumo: "Seção de IA com o atendimento automático pelo WhatsApp e a leitura de documentos; frases neutras no lugar dos pontos ainda abertos." },
  { versao: "2026-11-17.1", resumo: "Primeiro texto (nunca aceito em produção)." },
];

/** Frase curta que aparece ao lado da caixa de seleção, na tela de criar a senha. */
export const FRASE_CURTA_DO_TERMO =
  "Li e concordo com o tratamento dos meus dados pela Prospecta, inclusive por inteligência artificial no atendimento pelo WhatsApp e na leitura de documentos.";

/** Aviso que aparece quando a pessoa tenta salvar sem marcar a caixa. */
export const AVISO_SEM_ACEITE = "Para criar a senha, marque a caixa de concordância com o termo.";

/** Rota pública com o termo completo. */
export const ROTA_DO_TERMO = "/termo-de-consentimento";

export const TITULO_DO_TERMO = "Termo de consentimento para uso dos seus dados";

/** Canal de atendimento ao titular, que faz o papel de encarregado (LGPD, art. 41). */
export const CANAL_DO_TITULAR = { email: "atendimento@prospectaconstrucoes.com", telefone: "(99) 98139-2210" } as const;

/** Prazo da declaração completa pedida pelo titular (LGPD, art. 19, II). */
export const PRAZO_DE_RESPOSTA_DIAS = 15;

export type SecaoDoTermo = { titulo: string; paragrafos: string[] };

export const SECOES_DO_TERMO: readonly SecaoDoTermo[] = [
  {
    titulo: "1. Quem cuida dos seus dados",
    paragrafos: [
      "PROSPECTA CONSTRUÇÕES E AVALIAÇÃO IMOBILIÁRIA LTDA, CNPJ 41.865.900/0001-89, de Imperatriz (MA), aqui chamada de \"Prospecta\", é a controladora dos seus dados pessoais.",
      `Endereço: ${ENDERECO_DA_SEDE}.`,
      `Encarregado pelo tratamento de dados pessoais (LGPD, art. 41): o canal de atendimento ao titular da Prospecta, pelo e-mail ${CANAL_DO_TITULAR.email} ou pelo telefone ${CANAL_DO_TITULAR.telefone}.`,
    ],
  },
  {
    titulo: "2. Quais dados",
    paragrafos: [
      "Os dados que você ou a equipe informam no sistema: nome, CPF ou CNPJ, telefone, e-mail, endereço, documentos enviados, dados do imóvel, da obra, do financiamento e dos pagamentos, e as mensagens trocadas com a Prospecta (inclusive pelo WhatsApp).",
      "Também registramos a data e a hora em que você aceita este termo, a versão aceita e o tipo de aparelho usado (celular, tablet ou computador). Se você retirar o consentimento, registramos a data e a hora da retirada e quem a registrou.",
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
      "Enquanto você tiver conta ou relação com a Prospecta (cadastro, atendimento, contrato, obra, financiamento ou cobrança em andamento).",
      "Depois que a relação termina, guardamos só o que a lei manda ou permite guardar, pelos prazos legais: por exemplo, 5 anos para documentos fiscais e contábeis, e o prazo de prescrição que se aplicar para defender direitos em processos judiciais, administrativos ou arbitrais.",
      "Passados esses prazos, a Prospecta elimina os dados ou os anonimiza (tira deles o que identifica você). Você também pode pedir a eliminação antes, pelos contatos do item 7; guardamos só o que a lei obrigar.",
      "O registro do aceite e da retirada deste termo é guardado como prova pelo mesmo tempo.",
    ],
  },
  {
    titulo: "7. Seus direitos e como pedir",
    paragrafos: [
      "Você pode pedir a qualquer momento: a confirmação de que tratamos seus dados; o acesso a eles; a correção de dados incompletos, errados ou desatualizados; a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desacordo com a lei; a portabilidade dos seus dados; a eliminação dos dados tratados com o seu consentimento; a informação sobre com quem compartilhamos seus dados; a informação sobre a possibilidade de não consentir e o que acontece se você não consentir; e a retirada deste consentimento.",
      `Para pedir, escreva para ${CANAL_DO_TITULAR.email} ou ligue para ${CANAL_DO_TITULAR.telefone}. A confirmação simples é respondida assim que recebermos o pedido; a declaração completa (origem dos dados, critérios usados e finalidade do tratamento) é entregue em até ${PRAZO_DE_RESPOSTA_DIAS} dias a partir do pedido (LGPD, art. 19, II).`,
      "Retirada do consentimento: se você tem acesso ao sistema, use o botão \"Retirar consentimento\" na página Meu perfil; ou peça pelos mesmos contatos (e-mail ou telefone) e a equipe da Prospecta registra a retirada no sistema. A retirada fica registrada com a data, a hora e quem a registrou.",
      "A retirada vale a partir do registro: não desfaz o que foi feito antes dela, e o sistema volta a pedir o aceite na próxima vez que você entrar (sem ele, a área logada não fica disponível). Os dados que a lei manda guardar, ou que são necessários para cumprir um contrato com você, continuam guardados pelo tempo do item 6.",
      "Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).",
    ],
  },
  {
    titulo: "8. Mudanças neste termo",
    paragrafos: [
      "Se este termo mudar, a nova versão ficará nesta mesma página. O sistema guarda qual versão você aceitou e quando.",
    ],
  },
];

/** Canais (telas) em que um registro do termo é gravado: aceite (definir_senha, login) e retirada (admin, conta). */
export const CANAIS_DO_CONSENTIMENTO = ["definir_senha", "login", "admin", "conta"] as const;
export type CanalDoConsentimento = (typeof CANAIS_DO_CONSENTIMENTO)[number];

/** Tipo do registro: aceite do termo ou retirada (revogação) do consentimento. */
export const TIPOS_DO_CONSENTIMENTO = ["aceite", "revogacao"] as const;
export type TipoDoConsentimento = (typeof TIPOS_DO_CONSENTIMENTO)[number];

export const MENSAGEM_SEM_CONSENTIMENTO_ATIVO = "Não há consentimento ativo para retirar.";
