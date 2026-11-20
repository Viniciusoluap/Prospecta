# EPIC-025 — Operação Dolores (funcionária digital de operações)

Status: InProgress
Origem: "Operação Dolores — Prompt Mestre" (16/11/2026). Substitui o prompt do Projeto SOL.
Regra de execução: `CLAUDE.md`, seção "EPIC-024 … e EPIC-025 (Dolores)". O dono autorizou em 16/11 o ritmo contínuo,
com migração e publicação a cada etapa — o que substitui a exigência do prompt de pedir autorização a cada merge.

## Etapas (uma PR por etapa; só avança com o teste de aceite)
- [x] 1. Leitura (PR #240, migração `0123` aplicada) — ponte, usuário Dolores, consultas de todos os módulos, auditoria (`dolores_acoes`)
- [x] 2. WhatsApp (PR #243, migração `0124` aplicada; IA desligada por padrão) — conexão própria pela Central, comando e resposta pelo número do dono
- [x] 3. Ações (PR #245, migração `0125` aplicada; fila de aprovação) — tarefas, acompanhamentos, cobranças preparadas, geradores, fila de aprovação
- [x] 4. Grupos de clientes (PR #248, migrações `0126` e `0130` aplicadas; tudo desligado por padrão) — leitura dos grupos cadastrados, card, classificação e Drive
- [x] 4b. Resposta no grupo só quando marcada (PR #251, migração `0129` aplicada; desligada por padrão, geral e por grupo)
- [x] 5. Notas de obra (PR #250, migração `0128` aplicada; tudo desligado por padrão) — leitura da nota, rascunho, confirmação do empreiteiro, conciliação com o BPO
- [x] 6. Operação contínua (PR #252, migração `0131` aplicada; tudo desligado por padrão) — eventos, rondas, relatório diário, tela com pausa e gasto
- [x] 7. (PR #259, migração `0133` aplicada) Grupos automáticos, por tipo (regra do dono de 19/11; story `E7-grupos-automaticos.md`, migração `0133`) — grupo entra sozinho, tipo pelo nome, aviso e comando do dono, escopo por tipo
- [x] 9. Conexão única do WhatsApp, atendimento e campanhas (PR #261, migração `0135` aplicada; regra do dono de 20/11; story `E9-conexao-unica-e-atendimento.md`) — tudo novo desligado, exceto avisos de ligação/áudio (com teto)

## Suposições em vigor até o dono responder (seção 9 do prompt)
1. Só operação interna (não atende cliente). 2. Um grupo de WhatsApp por cliente. 3. A IA pode abrir os documentos.
4. O empreiteiro confirma a nota respondendo no grupo. 5. Responsável dos 32 processos de regularização: "a confirmar".

## Depende só do dono (bloqueios a registrar no HANDOFF quando chegarem)
Créditos no Claude Console e o agente criado lá; número e QR code da Dolores; inclusão dela nos grupos; token da
ponte na Vercel. Mensagem a cliente ou terceiro só depois de ele liberar as categorias.

## Limites fixos
Nunca excluir registro, editar lançamento confirmado, pagar, mexer em usuários/credenciais, assinar documento técnico
ou inventar dado. Teto de custo: R$ 1.621 por mês, tudo incluído. Migrações só aditivas.
