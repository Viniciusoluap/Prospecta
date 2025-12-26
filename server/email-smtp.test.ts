import { describe, it, expect } from 'vitest';
import { sendEmail, budgetConfirmationTemplate } from './_core/email-smtp';

describe('Email SMTP Integration', () => {
  it('should send budget confirmation email successfully', async () => {
    const template = budgetConfirmationTemplate({
      name: 'João Silva',
      projectType: 'Casa 47m²',
      city: 'Imperatriz - MA',
    });

    const result = await sendEmail({
      to: 'atendimento@prospectaconstrucoes.com', // Enviando para o próprio email para teste
      subject: template.subject,
      html: template.html,
      recipientName: 'João Silva',
      templateType: 'budget_confirmation',
      metadata: {
        projectType: 'Casa 47m²',
        city: 'Imperatriz - MA',
        budgetId: 999,
      },
    });

    expect(result).toBe(true);
  }, 30000); // Timeout de 30s para envio de email
});
