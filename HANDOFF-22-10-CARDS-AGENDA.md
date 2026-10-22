# Cards e agenda — 22/10/2026

## Concluído no código
- Vencimento opcional individual por lead, edição no card e no detalhe; ordenação por vencimento em cada coluna, sem data por último.
- Nenhuma alteração de vencimento propaga para outros cards, tarefas ou visitas.
- Tarefas e Agenda cria tarefa real e materializa demandas antigas idempotentemente; excluir o serviço remove a tarefa.
- Calendário exibe vencimentos dos leads, tarefas e agendamentos.
- Cron às 11 UTC (08h Imperatriz): resumo por destinatário, admin recebe todos e colaborador recebe seus cards. Registro por lead/data/canal e trava diária evitam repetição na operação normal. Atrasados sem aviso são recuperados.
- Paridade implementada na branch homônima do Grupo Santa Fé.

## Testes
(a) pnpm check passou; vitest focal de datas passou 2/2; git diff --check passou.
(b) Validação manual de interface ainda não executada.
(c) Migração, configuração existente de CRON_SECRET/SMTP, execução do cron e entrega real de email/notificação pendem de homologação. Nenhum email foi disparado nesta sessão.

Branch publicada no GitHub via conector em `fa36e72`; a prévia Vercel `EtqrUcJjUY7Dy3j6EcbF8inn7F3M` ficou READY. Produção continua sem merge/deploy.

## Pendências e próximo passo
- Revisar e homologar fluxo completo antes de merge/deploy. Não publicado em produção.
- Schema aditivo tem migration SQL e inicialização idempotente no handler Vercel. Desenvolvimento fora desse handler exige aplicar migration.
- Um card adicionado após o resumo diário será incluído no próximo dia. Reenvio de um vencimento já avisado é suprimido; reprogramar para outra data cria novo evento.
- Falha abrupta entre envio SMTP e registro ainda tem a janela inerente de duplicidade; não prometer entrega exatamente uma vez.
- Pedido novo da Logyca permanece apenas em análise: HTTP Request nativo sem custo de consumo informado; R$500 se equipe deles configurar envio. Validar operações de retorno para documentos faltantes e follow-up aprovado antes de implementar.
