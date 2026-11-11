# Handoff — CRM sem vencimento em Finalizado

## Concluído

- O Pipeline e a ficha ocultam a data e o editor de vencimento em Finalizado, inclusive em cartões legados. O cadastro e a edição ocultam o campo ao escolher essa etapa.
- A mudança para Finalizado limpa `card_due_date` junto com a mudança de estágio e a gravação do histórico. Edições de vencimento isoladas respeitam o estágio atual do banco. Reabrir aceita uma nova data e descarta o prazo legado se nenhuma data nova for informada.
- As outras etapas seguem aceitando vencimento. Agenda e avisos de vencimento já excluíam Finalizado.

## Testes

- (a) Checagem TypeScript, build Vite e 20 testes passaram. O teste de transição executou o SQL em PostgreSQL embarcado, incluindo lead legado, finalização e reabertura.
- (b) O Pipeline e a ficha foram renderizados com dados de teste. A data apareceu nos seis estágios ativos e sumiu no Finalizado.
- (c) Confirmar o deploy e a resposta da API. A edição autenticada de cartões reais não faz parte da validação técnica.

## Próximo passo

- Portar a mesma regra ao Grupo Santa Fé. A implementação local desse sistema ainda exibe vencimento no Kanban de Finalizado.
