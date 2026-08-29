import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { emailLogs, InsertEmailLog } from "../../drizzle/schema";
import { ENV } from "./env";

type EmailData = {
  to: string;
  subject: string;
  html: string;
  recipientName?: string;
  templateType: InsertEmailLog["templateType"];
  metadata?: Record<string, unknown>;
};

type EmailDependencies = {
  db: ReturnType<typeof getDb>;
  transport: Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail">;
};

function defaultDependencies(): EmailDependencies {
  if (!ENV.smtpHost || !ENV.smtpUser || !ENV.smtpPassword) {
    throw new Error("Configuração SMTP ausente");
  }
  return {
    db: getDb(),
    transport: nodemailer.createTransport({
      host: ENV.smtpHost,
      port: ENV.smtpPort,
      secure: ENV.smtpPort === 465,
      auth: { user: ENV.smtpUser, pass: ENV.smtpPassword },
    }),
  };
}

/** Envia email e registra o resultado. Dependências são injetáveis para testes locais. */
export async function sendEmail(
  data: EmailData,
  dependencies?: EmailDependencies
): Promise<boolean> {
  let deps: EmailDependencies;
  try {
    deps = dependencies ?? defaultDependencies();
  } catch {
    return false;
  }

  let emailId: number | undefined;
  try {
    const emailLog: InsertEmailLog = {
      recipientEmail: data.to,
      recipientName: data.recipientName,
      subject: data.subject,
      templateType: data.templateType,
      htmlContent: data.html,
      status: "pending",
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    };
    const result = await deps.db.insert(emailLogs).values(emailLog).returning();
    emailId = result[0]?.id;
    if (!emailId) return false;

    await deps.transport.sendMail({
      from: `"Prospecta Empreendimentos" <${ENV.smtpUser || "no-reply@prospecta.local"}>`,
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.html.replace(/<[^>]*>/g, ""),
    });
    await deps.db
      .update(emailLogs)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(emailLogs.id, emailId));
    return true;
  } catch {
    if (emailId) {
      try {
        await deps.db
          .update(emailLogs)
          .set({ status: "failed" })
          .where(eq(emailLogs.id, emailId));
      } catch {
        // O erro de auditoria não deve ocultar a falha original do envio.
      }
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

export async function sendBudgetUpdateEmail(data: {
  name: string;
  email: string;
  status: string;
  notes?: string;
  budgetId: number;
}): Promise<boolean> {
  return sendEmail({
    to: data.email,
    subject: `📋 Atualização do seu Orçamento - Prospecta Empreendimentos`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1A2332 0%, #C9A961 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .status-badge { display: inline-block; background: #C9A961; color: white; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 16px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>📋 Atualização do seu Orçamento</h1></div>
          <div class="content">
            <p>Olá <strong>${data.name}</strong>,</p>
            <p>Seu orçamento foi atualizado:</p>
            <p><span class="status-badge">${data.status}</span></p>
            ${data.notes ? `<p><strong>Observações:</strong><br>${data.notes}</p>` : ""}
            <p>Dúvidas? WhatsApp: (99) 98139-2210 | (94) 99304-4689</p>
          </div>
          <div class="footer"><p>© 2025 Prospecta Empreendimentos - Grupo Efficaz</p></div>
        </div>
      </body>
      </html>
    `,
    recipientName: data.name,
    templateType: "budget_update",
    metadata: { budgetId: data.budgetId, status: data.status },
  });
}
