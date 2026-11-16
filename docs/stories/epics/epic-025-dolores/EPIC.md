# EPIC-025 — Operação Dolores (funcionária digital de operações)

Status: Ready (começa depois do EPIC-024)
Origem: "Operação Dolores — Prompt Mestre" (16/11/2026). Substitui o prompt do Projeto SOL.
Regra de execução: `CLAUDE.md`, seção "EPIC-024 … e EPIC-025 (Dolores)". O dono autorizou em 16/11 o ritmo contínuo,
com migração e publicação a cada etapa — o que substitui a exigência do prompt de pedir autorização a cada merge.

## Etapas (uma PR por etapa; só avança com o teste de aceite)
- [ ] 1. Leitura — ponte, usuário Dolores, consultas de todos os módulos, auditoria (`dolores_acoes`)
- [ ] 2. WhatsApp — conexão própria pela Central, comando e resposta pelo número do dono
- [ ] 3. Ações — tarefas, acompanhamentos, cobranças preparadas, geradores, fila de aprovação
- [ ] 4. Grupos de clientes — leitura dos grupos cadastrados, card, classificação e Drive
- [ ] 5. Notas de obra — leitura da nota, rascunho, confirmação do empreiteiro, conciliação com o BPO
- [ ] 6. Operação contínua — eventos, rondas, relatório diário, tela com pausa e gasto

## Suposições em vigor até o dono responder (seção 9 do prompt)
1. Só operação interna (não atende cliente). 2. Um grupo de WhatsApp por cliente. 3. A IA pode abrir os documentos.
4. O empreiteiro confirma a nota respondendo no grupo. 5. Responsável dos 32 processos de regularização: "a confirmar".

## Depende só do dono (bloqueios a registrar no HANDOFF quando chegarem)
Créditos no Claude Console e o agente criado lá; número e QR code da Dolores; inclusão dela nos grupos; token da
ponte na Vercel. Mensagem a cliente ou terceiro só depois de ele liberar as categorias.

## Limites fixos
Nunca excluir registro, editar lançamento confirmado, pagar, mexer em usuários/credenciais, assinar documento técnico
ou inventar dado. Teto de custo: R$ 1.621 por mês, tudo incluído. Migrações só aditivas.
