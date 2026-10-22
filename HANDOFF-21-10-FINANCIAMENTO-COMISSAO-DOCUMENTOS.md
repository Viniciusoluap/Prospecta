# Handoff — 21/10/2026 — financiamento, comissão e documentos

Branch: `codex/fin-crm-bidirecional-20261021`, a partir de `main` a41f388327daf45eb43f6ed7aff8517579835029. Paridade com `Viniciusoluap/Grupo-Santa-Fe` na branch homônima.

## Pedido e implementação
- `leads.simulationValue` é **VGV simulado** e `leads.approvedValue` é **Valor financiado aprovado**. Financiamentos vinculados herdam e exibem os valores do CRM. Edições no financiamento sincronizam CRM e processos irmãos em transação; edições no CRM atualizam financiamentos. As telas foram renomeadas.
- Comissão automática de obra usa `simulationValue` para admin, equipe e corretor, incluindo resumo, formulário, listagem e base de comissões avulsas. `constructionProjects.vgv` permanece ligado ao aprovado para os demais cálculos. Alterações de valores no CRM ou financiamento recalculam a comissão persistida.
- Documentos CRM e checklist do financiamento aceitam até 20 MiB com 20 partes de 1 MiB autenticadas, vinculadas ao item e usuário, tabela temporária `drizzle/0064_document_upload_chunks.sql` e expiração de 30 minutos. O arquivo é enviado ao Google Drive somente após validação. Consultas de documentos são paginadas em partes de 1 MiB para respeitar o limite de resposta Vercel.

## Verificação
- Sintaxe TypeScript dos arquivos alterados verificada via `transpileModule`, sem diagnósticos sintáticos; `git diff --check` passou.
- O pacote local de dependências da Prospecta não está instalado; `pnpm install --offline` foi bloqueado pela ausência de metadados no cache. Validar build pelo CI/Vercel.

## Continuidade
- Conferir build Vercel e corrigir qualquer erro de compilação antes de encerrar. Confirmar merge e deploy em ambos os projetos.
- Exercitar upload/download real de ~15 MiB e comissão com aprovado diferente do simulado em conta de teste; limpar os dados de teste depois.
