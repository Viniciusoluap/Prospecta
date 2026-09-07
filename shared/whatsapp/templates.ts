// Templates fixos de mensagem para a Central WhatsApp — portados 1:1 do Grupo
// Santa Fé (admin/whatsapp/_components/whatsapp-client.tsx). Dados estáticos,
// não lógica de negócio: apenas os textos padrão oferecidos no composer.

export interface WhatsappTemplate {
  id: string;
  name: string;
  category: string;
  body: string;
}

export const WHATSAPP_TEMPLATES: WhatsappTemplate[] = [
  { id: "t1", name: "Boas-vindas ao lead", category: "Captação", body: "Olá {{nome}}! Sou {{corretor}} da Prospecta. Recebemos seu contato sobre {{servico}}. Podemos conversar?" },
  { id: "t2", name: "Follow-up 48h", category: "Acompanhamento", body: "Olá {{nome}}, tudo bem? Estou entrando em contato sobre {{servico}}. Tenho opções que podem te interessar! 😊" },
  { id: "t3", name: "Confirmação de visita", category: "Agenda", body: "Olá {{nome}}! Confirmo nossa visita às {{horario}} no endereço {{endereco}}. Qualquer dúvida me chame! ✅" },
  { id: "t4", name: "Envio de proposta", category: "Negociação", body: "Olá {{nome}}! Preparei uma proposta sobre {{imovel}}. Podemos agendar para apresentar os detalhes?" },
  { id: "t5", name: "Atualização do financiamento", category: "Financiamento", body: "Olá {{nome}}! O banco {{banco}} aprovou sua análise de crédito! Vamos conversar?" },
  { id: "t6", name: "Lembrete de documentos", category: "Documentação", body: "Olá {{nome}}! Ainda precisamos dos documentos: {{documentos}}. Pode nos enviar? 📄" },
];
