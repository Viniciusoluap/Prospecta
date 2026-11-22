# Dolores — fuso horário no teste de avisos

- Concluído. Os registros sintéticos agora usam horários UTC explícitos, com a sessão do banco de teste em America/Fortaleza. Antes, os registros às 12h eram interpretados como horário local e a espera esperada de 48h virava 45h. O cálculo de períodos completos de 24 horas do sistema produzia o resultado correto para os dados que recebia.
- Central de Vendas arquivada por orientação do dono. A correção altera apenas o cenário de testes da Dolores e não exige migração.
- Testes automáticos. Cenário que falhava passou isoladamente, incluindo nota de obra e conta bancária. Arquivo completo em execução com rede externa bloqueada.
- Verificação manual. Horários da consulta e dos registros comparados. Nenhuma mensagem real enviada. Não há mudança no código de produção.
- Próximo passo. Confirmar o arquivo completo de testes, aguardar a revisão do PR e verificar a publicação.
