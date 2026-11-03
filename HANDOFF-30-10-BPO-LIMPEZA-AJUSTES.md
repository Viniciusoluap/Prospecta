# Limpeza temporária do BPO — 30/10/2026

## Etapa 1 — auditoria e plano
- Branch `codex/bpo-limpeza-ajustes-20261030`, a partir da main publicada; histórico anterior preservado.
- Pedido: permitir limpeza de cobranças e despesas durante ajustes, inclusive registros pagos e importados, sem alterar serviços externos.
- Causa confirmada: o classificador atual protege todos os lançamentos com baixa, origem de extrato ou referência do provedor.
- A exclusão normal continua protegida. A solução usará um modo explícito de ajustes, restrito ao administrador, com prévia, confirmação, backup e restauração.
- Auditoria de integridade em andamento: vínculos de recebimentos, movimentos de obra, regularizações, combinações e sincronização precisam ser preservados; não basta retirar validações do DELETE.
- Nenhuma limpeza de dados de produção foi executada nesta solicitação.

## Verificação
(a) Automáticos: levantamento de código e relações; implementação pendente.
(b) Manuais: leitura dos fluxos e prints, sem alterar dados.
(c) Produção: pendente de implementação, revisão e publicação.

## Próximo passo
Fechar desenho transacional com orquestração, implementar com paridade, testar exclusão/restauração em banco isolado e publicar com os gates existentes.

## Etapa 2 — implementação Prospecta em andamento
- ADAPT: modo explícito de limpeza de ajustes no modal, com confirmação e prévia assinada; exclusão normal mantém as proteções anteriores.
- ADAPT: marcador nullable `exclusao_lote_backup_id` mantém lançamentos e vínculos em armazenamento e os retira das listagens, somatórios e novas alocações do BPO.
- ADAPT: backups de ajustes identificados no snapshot; restauração reativa somente as linhas ainda vinculadas ao mesmo backup, sem recriar chaves externas ou recebimentos.
- ADAPT: guardas de edição, baixa e combinação; sincronizações preservam marcadores e chaves para não reimportar registros removidos.
- CREATE: migração aditiva 0099 e gatilhos específicos para impedir novas alocações de lançamentos arquivados.
(a) Automáticos: TypeScript passou na primeira rodada parcial; testes de integridade e regressão ainda pendentes.
(b) Manuais: revisão direta em andamento; navegador publicado pendente.
(c) Produção: nenhuma limpeza executada; migração e publicação ainda pendentes.
- Próximo passo: completar cobertura de sincronização tardia, testes em banco isolado, revisão QA e publicação com a implementação espelhada.

## Checkpoint de retomada — implementação parcial
- Código em andamento preservado na branch de trabalho, sem PR nem merge de produção nesta etapa.
- Verificações finais de integridade, regressão e escala ainda pendentes; não tratar este checkpoint como entrega concluída.
- Próximo passo: concluir testes e revisão independente, aplicar a migração aditiva sob a orquestração e publicar somente após os gates. Nenhuma limpeza de dados de produção executada.
