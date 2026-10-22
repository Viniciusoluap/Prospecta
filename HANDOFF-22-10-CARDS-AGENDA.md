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
(c) O schema de produção foi confirmado no Neon; CRON_SECRET de produção foi configurado na Vercel. A execução agendada e a entrega real de email/notificação ainda dependem de homologação. Nenhum email foi disparado nesta sessão.

Branch publicada no GitHub via conector em `fa36e72`; a prévia Vercel `EtqrUcJjUY7Dy3j6EcbF8inn7F3M` ficou READY. PR #146 integrado em `main` pelo squash `73c9a2777324298b9143127e1440809ecd80b1bb`. Deploy de produção `dpl_ENeHMRfHLL6FBttmZ36w2rN2z58W` READY; domínio www.prospectaconstrucoes.com respondeu 200. Nenhum erro nos logs de produção consultados após o deploy.

## Pendências e próximo passo
- Homologar com sessão autenticada a edição individual, a ordenação, tarefas e calendário. Verificar o primeiro resumo diário às 08h de Imperatriz; o acesso sem autorização à rota cron não foi testado conclusivamente pela ferramenta de fetch da Vercel.
- Schema aditivo tem migration SQL e inicialização idempotente no handler Vercel. Desenvolvimento fora desse handler exige aplicar migration.
- Um card adicionado após o resumo diário será incluído no próximo dia. Reenvio de um vencimento já avisado é suprimido; reprogramar para outra data cria novo evento.
- Falha abrupta entre envio SMTP e registro ainda tem a janela inerente de duplicidade; não prometer entrega exatamente uma vez.
- Pedido novo da Logyca permanece apenas em análise: HTTP Request nativo sem custo de consumo informado; R$500 se equipe deles configurar envio. Validar operações de retorno para documentos faltantes e follow-up aprovado antes de implementar.
