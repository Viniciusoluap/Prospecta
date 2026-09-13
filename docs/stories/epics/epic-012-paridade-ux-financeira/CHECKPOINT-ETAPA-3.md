# Checkpoint — Etapa 3: lacunas P0

**Data:** 13/09/2026  
**Status:** Em validação final; só será concluída após merge, migration e deploy  
**Escopo:** Financiamentos, Jurídico e Configurações/RBAC

## Entregas

| Frente | Resultado |
|---|---|
| Financiamentos | Edição completa, vínculos com lead/imóvel/corretor, checklist, etapas e validação |
| Jurídico | Contratos globais, documentos PDF, assinatura, vínculos e chat do Portal |
| Configurações | Usuários, papéis, ativação, senha, CRECI e permissões por módulo |
| RBAC | Central do colaborador, bloqueio de rota e autorização tRPC nos módulos da Etapa 3 |
| Sessão | Usuário desativado não autentica e sessões existentes deixam de ser aceitas |
| Dados | Migration Drizzle `0014_eager_hobgoblin`, aditiva e sem remoção de dados |

## Segurança preservada

- Configurações continua exclusiva de administradores.
- Um administrador não consegue excluir a própria conta nem remover o próprio acesso.
- O último administrador ativo não pode ser desativado, rebaixado ou excluído.
- Permissões desconhecidas são descartadas pelo catálogo compartilhado.
- Upload jurídico aceita somente PDF válido de até 10 MiB.
- Contratos do Jurídico e do Portal usam a mesma fonte de dados.
- Endpoints administrativos do Portal também exigem a permissão de CRM.

## Situação após a Etapa 3

- 12 dos 22 domínios auditados possuem núcleo equivalente;
- 10 permanecem parciais;
- nenhum domínio permanece totalmente ausente;
- a Etapa 4 deve tratar Agenda, Corretores/Comissões, Projetos e Mapa;
- UAT completo por papel/dispositivo pertence à Etapa 6;
- credenciais e integrações reais pertencem à Etapa 7.
- a migração dos endpoints administrativos legados do controle por papel para permissão granular deve ser concluída na Etapa 6.

## Evidências de encerramento

Os resultados finais de testes, merge, migration de produção e deploy Vercel devem ser preenchidos na PR e confirmados antes de considerar este checkpoint efetivamente encerrado.
