// EPIC-024 S-12 (17/11/2026) — termo de consentimento aceito ao criar a senha do primeiro acesso.
// Arquivo ÚNICO do termo: para trocar o texto, edite aqui e suba `VERSAO_DO_TERMO` (aceites antigos continuam válidos;
// pedir novo aceite depende da opção CONSENTIMENTO_PEDIR_NO_LOGIN, desligada — ver server/consentimento.ts).
// Texto provisório, escrito em linguagem simples: precisa ser revisado pelo jurídico antes de ser tratado como final.
// Dados que o sistema não tem ficam marcados com "[A PREENCHER PELO JURÍDICO: …]". Não afirma conformidade legal.

/** Versão vigente do termo. Mude sempre que o texto mudar (ex.: "2026-11-17.1" → "2026-12-01.1"). */
export const VERSAO_DO_TERMO = "2026-11-17.1";

/** Frase curta que aparece ao lado da caixa de seleção, na tela de criar a senha. */
export const FRASE_CURTA_DO_TERMO =
  "Li e concordo com o tratamento dos meus dados pela Prospecta, inclusive por ferramentas de inteligência artificial usadas no atendimento.";

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
      "Endereço completo: [A PREENCHER PELO JURÍDICO: endereço da sede].",
      "Responsável pelos dados pessoais (encarregado): [A PREENCHER PELO JURÍDICO: nome e contato do encarregado].",
    ],
  },
  {
    titulo: "2. Quais dados",
    paragrafos: [
      "Os dados que você ou a equipe informam no sistema: nome, CPF ou CNPJ, telefone, e-mail, endereço, documentos enviados, dados do imóvel, da obra, do financiamento e dos pagamentos, e as mensagens trocadas com a equipe.",
      "Também registramos dados de uso do sistema, como data e hora de acesso.",
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
      "A equipe da Prospecta usa uma assistente de inteligência artificial para consultar informações do sistema e montar respostas. Para isso, partes dos dados (por exemplo: nome, CPF, telefone, e-mail e o andamento dos serviços) podem ser enviadas a um prestador de serviço de inteligência artificial (atualmente a Anthropic), que processa os dados para gerar a resposta à equipe.",
      "Esse prestador pode ficar fora do Brasil. As respostas da assistente servem de apoio à equipe da Prospecta.",
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
      "Enquanto você tiver conta ou relação com a Prospecta, e depois pelo tempo exigido por lei ou necessário para defender direitos. Prazo específico: [A PREENCHER PELO JURÍDICO: prazo de guarda dos dados após o fim da relação].",
    ],
  },
  {
    titulo: "7. Seus direitos e como pedir",
    paragrafos: [
      "Você pode pedir: acesso aos seus dados, correção, informações sobre com quem foram compartilhados, e a retirada deste consentimento (a retirada não desfaz o que já foi feito antes dela e pode impedir parte do atendimento pelo sistema).",
      "Para pedir, escreva para atendimento@prospectaconstrucoes.com ou fale com a equipe pelo telefone (99) 98139-2210. Prazo de resposta: [A PREENCHER PELO JURÍDICO: prazo de resposta aos pedidos do titular].",
    ],
  },
  {
    titulo: "8. Mudanças neste termo",
    paragrafos: [
      "Se este termo mudar, a nova versão ficará nesta mesma página. O sistema guarda qual versão você aceitou e quando.",
    ],
  },
];

/** Marcadores ainda pendentes no texto (para conferir antes de tirar o "texto provisório"). */
export function marcadoresPendentes(): string[] {
  const todos = SECOES_DO_TERMO.flatMap(s => s.paragrafos.join(" ").match(/\[A PREENCHER PELO JURÍDICO:[^\]]*\]/g) ?? []);
  return Array.from(new Set(todos));
}

/** Canais (telas) em que o aceite pode ser registrado. */
export const CANAIS_DO_CONSENTIMENTO = ["definir_senha", "login"] as const;
export type CanalDoConsentimento = (typeof CANAIS_DO_CONSENTIMENTO)[number];
