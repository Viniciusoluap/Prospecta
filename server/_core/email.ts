import { getDb } from "../db";
import { emailLogs, InsertEmailLog } from "../../drizzle/schema";

/**
 * Templates de email em HTML
 */
export const emailTemplates = {
  welcome: (name: string) => ({
    subject: `Bem-vindo ao Ecossistema Efficaz, ${name}!`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1A2332 0%, #2C3E50 100%); color: #C9A961; padding: 30px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .button { display: inline-block; background: #C9A961; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bem-vindo ao Ecossistema Efficaz!</h1>
            </div>
            <div class="content">
              <p>Olá, <strong>${name}</strong>!</p>
              <p>É um prazer tê-lo(a) conosco. O Ecossistema Efficaz oferece:</p>
              <ul>
                <li>🎁 <strong>Sorteios</strong> com prêmios em UTEFs</li>
                <li>🏠 <strong>Produtos</strong> exclusivos (imóveis, serviços, embarcações)</li>
                <li>💰 <strong>UTEFs</strong> - nossa moeda interna conversível</li>
                <li>🏗️ <strong>Projetos e Obras</strong> personalizados</li>
              </ul>
              <p style="text-align: center;">
                <a href="https://efficazorbit.com" class="button">Explorar Plataforma</a>
              </p>
            </div>
            <div class="footer">
              <p>Prospecta Empreendimentos - CNPJ: 41.865.900/0001-89</p>
              <p>Leôncio Pires Dourado, 840A - Bacuri - Imperatriz - MA</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }),

  budgetConfirmation: (name: string, projectType: string, city: string) => ({
    subject: `Orçamento Recebido - ${projectType}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1A2332 0%, #2C3E50 100%); color: #C9A961; padding: 30px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .info-box { background: white; border-left: 4px solid #C9A961; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Orçamento Recebido!</h1>
            </div>
            <div class="content">
              <p>Olá, <strong>${name}</strong>!</p>
              <p>Recebemos sua solicitação de orçamento com sucesso.</p>
              <div class="info-box">
                <p><strong>Tipo de Projeto:</strong> ${projectType}</p>
                <p><strong>Cidade:</strong> ${city}</p>
              </div>
              <p>Nossa equipe entrará em contato em breve para discutir os detalhes do seu projeto.</p>
              <p><strong>Próximos passos:</strong></p>
              <ol>
                <li>Análise da sua solicitação (1-2 dias úteis)</li>
                <li>Contato via telefone ou email</li>
                <li>Apresentação de proposta personalizada</li>
              </ol>
              <p>Dúvidas? Entre em contato: <a href="tel:+5599981392210">(99) 98139-2210</a></p>
            </div>
            <div class="footer">
              <p>Prospecta Empreendimentos - CNPJ: 41.865.900/0001-89</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }),

  budgetUpdate: (name: string, status: string, notes: string) => ({
    subject: `Atualização do seu Orçamento`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1A2332 0%, #2C3E50 100%); color: #C9A961; padding: 30px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .status-badge { display: inline-block; background: #C9A961; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 Atualização do Orçamento</h1>
            </div>
            <div class="content">
              <p>Olá, <strong>${name}</strong>!</p>
              <p>Há uma atualização sobre o seu orçamento:</p>
              <p><span class="status-badge">${status}</span></p>
              ${notes ? `<p><strong>Observações:</strong><br>${notes}</p>` : ""}
              <p>Para mais informações, entre em contato conosco.</p>
            </div>
            <div class="footer">
              <p>Prospecta Empreendimentos</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }),

  drawWinner: (name: string, drawTitle: string, prizeAmount: number) => ({
    subject: `🎉 Parabéns! Você ganhou ${prizeAmount} UTEFs!`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #00FF00 0%, #C9A961 100%); color: white; padding: 40px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; text-align: center; }
            .prize { font-size: 48px; color: #C9A961; font-weight: bold; margin: 20px 0; }
            .button { display: inline-block; background: #C9A961; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-size: 18px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 PARABÉNS, VOCÊ GANHOU! 🎉</h1>
            </div>
            <div class="content">
              <p>Olá, <strong>${name}</strong>!</p>
              <p>Você foi sorteado(a) no sorteio:</p>
              <h2>${drawTitle}</h2>
              <div class="prize">${prizeAmount.toLocaleString("pt-BR")} UTEFs</div>
              <p>Seu saldo já foi creditado e você pode convertê-lo em produtos incríveis!</p>
              <a href="https://efficazorbit.com/produtos" class="button">Ver Produtos Disponíveis</a>
              <p style="margin-top: 30px; font-size: 14px; color: #666;">
                1 UTEF = R$ 1,00<br>
                Confira o regulamento completo em nosso site.
              </p>
            </div>
            <div class="footer">
              <p>Prospecta Empreendimentos</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }),

  promotionalCampaign: (subject: string, content: string) => ({
    subject,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1A2332 0%, #2C3E50 100%); color: #C9A961; padding: 30px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Ecossistema Efficaz</h1>
            </div>
            <div class="content">
              ${content}
            </div>
            <div class="footer">
              <p>Prospecta Empreendimentos</p>
              <p><a href="#">Cancelar inscrição</a></p>
            </div>
          </div>
        </body>
      </html>
    `,
  }),
};

/**
 * Registra um email no banco de dados
 * (Em produção, aqui seria feito o envio real via SMTP)
 */
export async function logEmail(data: {
  recipientEmail: string;
  recipientName?: string;
  templateType: InsertEmailLog["templateType"];
  subject: string;
  htmlContent: string;
  metadata?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) {
    console.error("[Email] Database not available");
    return null;
  }

  try {
    const emailLog: InsertEmailLog = {
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      subject: data.subject,
      templateType: data.templateType,
      htmlContent: data.htmlContent,
      status: "pending", // Em produção: "sent" após envio bem-sucedido
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    };

    const result = await db.insert(emailLogs).values(emailLog);

    console.log(
      `[Email] Logged email to ${data.recipientEmail}: ${data.subject}`
    );

    return result[0].insertId;
  } catch (error) {
    console.error("[Email] Failed to log email:", error);
    return null;
  }
}

/**
 * Envia email de confirmação de orçamento
 */
export async function sendBudgetConfirmationEmail(data: {
  name: string;
  email: string;
  projectType: string;
  city: string;
  budgetId: number;
}) {
  const template = emailTemplates.budgetConfirmation(
    data.name,
    data.projectType,
    data.city
  );

  return logEmail({
    recipientEmail: data.email,
    recipientName: data.name,
    templateType: "budget_confirmation",
    subject: template.subject,
    htmlContent: template.html,
    metadata: { budgetId: data.budgetId },
  });
}

/**
 * Envia email de atualização de orçamento
 */
export async function sendBudgetUpdateEmail(data: {
  name: string;
  email: string;
  status: string;
  notes?: string;
  budgetId: number;
}) {
  const template = emailTemplates.budgetUpdate(
    data.name,
    data.status,
    data.notes || ""
  );

  return logEmail({
    recipientEmail: data.email,
    recipientName: data.name,
    templateType: "budget_update",
    subject: template.subject,
    htmlContent: template.html,
    metadata: { budgetId: data.budgetId, status: data.status },
  });
}

/**
 * Envia email para vencedor de sorteio
 */
export async function sendDrawWinnerEmail(data: {
  name: string;
  email: string;
  drawTitle: string;
  prizeAmount: number;
  drawId: number;
}) {
  const template = emailTemplates.drawWinner(
    data.name,
    data.drawTitle,
    data.prizeAmount
  );

  return logEmail({
    recipientEmail: data.email,
    recipientName: data.name,
    templateType: "draw_winner",
    subject: template.subject,
    htmlContent: template.html,
    metadata: { drawId: data.drawId, prizeAmount: data.prizeAmount },
  });
}
