# Handoff — Due Diligence: reordenar tarefas/documentos e botão Anexar (11/11)

## Pedido do dono
1. Mover para cima/baixo também as TAREFAS e os DOCUMENTOS (como já existe nas etapas).
2. "Anexar" não abria nada.

## Diagnóstico do Anexar
O campo de arquivo ficava `disabled` sempre que havia alterações não salvas na tela ("Há alterações não salvas").
O clique no "Anexar" não abria o seletor e nenhuma mensagem aparecia. Também no iPad: arquivos às vezes chegam
sem tipo (rejeitados como "não PDF"), e abrir o arquivo anexado usava `window.open` depois de esperar o servidor
(o Safari bloqueia).

## Concluído
- `client/src/components/incorporacao/estudo/due-diligence-tab.tsx`: setas ↑ ↓ em cada tarefa e documento; o
  "Anexar" abre sempre o seletor; com alterações pendentes, salva automaticamente antes de enviar (o item precisa
  existir no servidor); mostra "Enviando..."; `accept` só com os tipos aceitos (PDF/JPG/PNG).
- `shared/incorporacao/due-diligence.ts`: `moverItem` (usado por etapas, tarefas e documentos). Mover documento não
  perde o anexo (o anexo é ligado ao id do documento, não à posição).
- `compat/acoes.ts`: tipo do arquivo deduzido pela extensão quando o navegador não informa; a aba do anexo é aberta
  no próprio clique (vale também para Registro de Incorporação e Topografia, que usam a mesma função).

## Testes
- (a) `server/incorporacao-due-diligence.test.ts` (+ reordenar); suíte completa 188 arquivos / 1572 testes, typecheck e build OK.
- (b) Chromium com servidor simulado: setas reordenam tarefas e documentos; com alterações não salvas o seletor de
  arquivo abre, o sistema chama salvar e depois enviar, e o aviso de alterações some.
- (c) Produção: pendente (conferir no iPad após o deploy). Limite de 3 MiB por arquivo continua.

## Merge e deploy (autorizados pelo dono em 11/11)
PR #197 mergeado em `main` (3bf73e9), revisão Codex sem apontamentos; deploy de produção
`dpl_3RYiEyRE8pD75domi54R3QvnfWg4` READY (prospectaconstrucoes.com), sem erros de runtime.

## Próximo passo
Conferir no iPad: Due Diligence → setas ↑ ↓ nas tarefas/documentos e "Anexar" (mesmo com alterações não salvas). Paridade com o Santa Fé registrada no ROADMAP.
