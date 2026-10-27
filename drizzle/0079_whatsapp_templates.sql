-- Templates editáveis do WhatsApp. Migração aditiva e idempotente.
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id" serial PRIMARY KEY,
  "slug" varchar(80) NOT NULL UNIQUE,
  "nome" varchar(120) NOT NULL,
  "categoria" varchar(80) NOT NULL,
  "conteudo" text NOT NULL,
  "ativo" boolean NOT NULL DEFAULT true,
  "criado_por_id" integer,
  "atualizado_por_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

INSERT INTO "whatsapp_templates" ("slug", "nome", "categoria", "conteudo") VALUES
('captacao','Boas-vindas ao lead','Captação',E'Olá, {{nome}}! Tudo bem?\n\nSou {{corretor}}, da Prospecta.\n\nRecebemos seu contato e será um prazer ajudar você a encontrar a melhor solução para seu objetivo. Nosso atendimento é personalizado, e quero entender melhor sua necessidade para apresentar as possibilidades mais adequadas e orientar você durante todo o processo.\n\nPodemos começar com algumas perguntas rápidas?'),
('followup48h','Follow-up 48h','Acompanhamento','Olá, {{nome}}! Tudo bem? Estou retomando nosso atendimento sobre {{servicos}}. Separei algumas possibilidades que podem fazer sentido para você. Podemos conversar por alguns minutos para avançarmos?'),
('visita','Confirmação de visita','Agenda','Olá, {{nome}}! Sua visita está confirmada para o dia {{dia}}, às {{horario}}. Qualquer dúvida, estou à disposição!'),
('proposta','Envio de proposta','Negociação','Olá, {{nome}}! Preparei a proposta referente a {{imovel}}, com as condições alinhadas para sua análise. Posso enviar os detalhes e esclarecer os próximos passos com você?'),
('financiamento','Atualização do financiamento','Financiamento','Olá, {{nome}}! Temos uma atualização sobre seu financiamento junto ao {{banco}}. Quero explicar o status e orientar você sobre a próxima etapa. Qual é o melhor horário para conversarmos?'),
('documentos','Lembrete de documentos','Documentação','Olá, {{nome}}! Para continuarmos seu atendimento, ainda precisamos destes documentos: {{documentos}}. Assim que você enviar, conseguiremos avançar para a próxima etapa. Se precisar de ajuda, estou à disposição.')
ON CONFLICT ("slug") DO NOTHING;
