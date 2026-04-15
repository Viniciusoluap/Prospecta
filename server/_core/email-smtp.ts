import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { emailLogs, InsertEmailLog } from "../../drizzle/schema";

/**
 * Configuração SMTP do Titan Email (Hostgator)
 * Email: atendimento@prospectaconstrucoes.com
 */
const transporter = nodemailer.createTransport({
  host: "smtp.titan.email",
  port: 465,
  secure: true, // SSL/TLS
  auth: {
    user: "atendimento@prospectaconstrucoes.com",
    pass: "Efficaz2010",
  },
});

/**
 * Envia email real via SMTP e registra no banco
 */
export async function sendEmail(data: {
  to: string;
  subject: string;
  html: string;
  recipientName?: string;
  templateType: InsertEmailLog["templateType"];
  metadata?: Record<string, any>;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error("[Email] Database not available");
    return false;
  }

  try {
    // Registrar no banco
    const emailLog: InsertEmailLog = {
      recipientEmail: data.to,
      recipientName: data.recipientName,
      subject: data.subject,
      templateType: data.templateType,
      htmlContent: data.html,
      status: "pending",
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    };

    const result = await db.insert(emailLogs).values(emailLog);
    const emailId = Number(result[0].insertId);

    // Enviar via SMTP
    const info = await transporter.sendMail({
      from: '"Prospecta Empreendimentos" <atendimento@prospectaconstrucoes.com>',
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.html.replace(/<[^>]*>/g, ""), // Fallback texto puro
    });

    console.log(
      "[Email] Enviado com sucesso:",
      info.messageId,
      "para",
      data.to
    );

    // Atualizar status no banco
    await db
      .update(emailLogs)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(emailLogs.id, emailId));

    return true;
  } catch (error) {
    console.error("[Email] Erro ao enviar para", data.to, ":", error);

    // Tentar atualizar status para failed
    try {
      const failedLog = await db
        .select()
        .from(emailLogs)
        .where(eq(emailLogs.recipientEmail, data.to))
        .orderBy(eq(emailLogs.createdAt, new Date()))
        .limit(1);

      if (failedLog[0]) {
        await db
          .update(emailLogs)
          .set({ status: "failed" })
          .where(eq(emailLogs.id, failedLog[0].id));
      }
    } catch (updateError) {
      console.error("[Email] Erro ao atualizar status:", updateError);
    }

    return false;
  }
}

/**
 * Template de email de confirmação de orçamento
 */
export function budgetConfirmationTemplate(data: {
  name: string;
  projectType?: string;
  city?: string;
}) {
  return {
    subject: "🏗️ Orçamento Recebido - Prospecta Empreendimentos",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1A2332 0%, #C9A961 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #C9A961; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Orçamento Recebido!</h1>
          </div>
          <div class="content">
            <p>Olá <strong>${data.name}</strong>,</p>
            
            <p>Recebemos sua solicitação de orçamento e estamos muito felizes em poder ajudá-lo a realizar o sonho da casa própria!</p>
            
            ${data.projectType ? `<p><strong>Tipo de Projeto:</strong> ${data.projectType}</p>` : ""}
            ${data.city ? `<p><strong>Cidade:</strong> ${data.city}</p>` : ""}
            
            <p>Nossa equipe está analisando sua solicitação e em breve entraremos em contato com uma proposta personalizada.</p>
            
            <p><strong>Próximos passos:</strong></p>
            <ul>
              <li>Análise da sua solicitação (até 24h)</li>
              <li>Contato da nossa equipe via WhatsApp ou email</li>
              <li>Apresentação da proposta personalizada</li>
              <li>Visita técnica (se necessário)</li>
            </ul>
            
            <p>Enquanto isso, conheça mais sobre nossos projetos:</p>
            <a href="https://prospectaconstrucoes.com/projetos-orcamentos" class="button">Ver Projetos</a>
            
            <p style="margin-top: 30px;">
              <strong>Dúvidas?</strong><br>
              WhatsApp: (99) 98139-2210 | (94) 99304-4689<br>
              Email: atendimento@prospectaconstrucoes.com
            </p>
          </div>
          <div class="footer">
            <p>© 2025 Prospecta Empreendimentos - Grupo Efficaz</p>
            <p>Construindo sonhos, transformando vidas</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

/**
 * Template de email de confirmação de pagamento
 */
export function paymentConfirmedTemplate(data: {
  name: string;
  amount: number;
  type: "bilhete" | "utef";
  quantity?: number;
}) {
  return {
    subject: "✅ Pagamento Confirmado - Prospecta Empreendimentos",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1A2332 0%, #C9A961 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .success-box { background: #d4edda; border: 2px solid #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
          .button { display: inline-block; background: #C9A961; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Pagamento Confirmado!</h1>
          </div>
          <div class="content">
            <p>Olá <strong>${data.name}</strong>,</p>
            
            <div class="success-box">
              <h2 style="margin: 0; color: #28a745;">✅ Pagamento Aprovado</h2>
              <p style="font-size: 24px; margin: 10px 0;"><strong>R$ ${(data.amount / 100).toFixed(2)}</strong></p>
            </div>
            
            <p>Seu pagamento foi confirmado com sucesso!</p>
            
            ${
              data.type === "bilhete"
                ? `<p>Você recebeu <strong>${data.quantity} bilhete(s)</strong> para o sorteio. Boa sorte!</p>`
                : `<p>Você recebeu <strong>${data.quantity} UTEF(s)</strong> na sua carteira digital.</p>`
            }
            
            <p>Acesse sua conta para ver seus ${data.type === "bilhete" ? "bilhetes" : "UTEFs"}:</p>
            <a href="https://prospectaconstrucoes.com/meu-saldo" class="button">Acessar Minha Conta</a>
            
            <p style="margin-top: 30px;">
              <strong>Dúvidas?</strong><br>
              WhatsApp: (99) 98139-2210 | (94) 99304-4689<br>
              Email: atendimento@prospectaconstrucoes.com
            </p>
          </div>
          <div class="footer">
            <p>© 2025 Prospecta Empreendimentos - Grupo Efficaz</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}
