# Checkpoint — Etapa 4: operação P1

Data: 13/09/2026. Base: `CHECKPOINT-ETAPA-2.md`, texto original do proprietário e modelos/actions do Grupo Santa Fé. Implementação incremental na Prospecta; nenhuma reescrita Next.js e nenhuma alteração no Santa Fé.

## Entrega técnica

- `/admin/agenda`: calendário mensal, lista, filtros por dia/status/corretor, cadastro/edição/exclusão, tipos operacionais e cliente avulso ou lead. Compartilha `portal_visits` com o Portal; o cliente continua vendo somente visitas do próprio lead.
- `/admin/corretores`: cadastro, perfil/edição, CRECI, contato, especialidades, foto por URL, ativação e exclusão exclusiva do administrador. Reutiliza usuários do tipo corretor, sem duplicar identidade. Cadastro não concede senha nem permissões; Configurações permanece responsável pelo acesso. E-mail de login é imutável neste módulo.
- `/admin/comissoes`: beneficiário empresa/corretor, negócio, percentual, valor, vencimento, aprovação/pagamento/cancelamento, filtros, totais e edição/exclusão. Pagamento registra data; reabertura limpa a data. O histórico de quatro parcelas permanece somente leitura, fora dos novos totais, sem migração financeira automática. Endpoints legados rejeitam gravações: antes confundiam datas com valores pagos.
- `/admin/projetos`: ciclo orçamento/solicitado/elaboração/revisão/aprovação/entrega/cancelamento; cliente/lead, engenheiro, tipos, valores, prazo, checklist e documentos por links HTTPS. Central liga também orçamentos, obras e incorporação, sem misturar suas entidades.
- `/admin/mapa`: mapa global Leaflet/OpenStreetMap, busca e filtro, imóveis disponíveis/reservados, coordenadas ausentes explícitas, exclusão de vendidos/alugados. Popups usam texto, não HTML vindo do banco. Lista permanece utilizável se as imagens do mapa falharem.
- Permissões específicas para Agenda, Corretores, Comissões, Projetos e Mapa, verificadas no frontend e no tRPC. Novos acessos disponíveis no painel e central do colaborador.

## Dados e validação

- Migration Drizzle `0015_etapa4_operacional.sql`: três tabelas novas e ampliação de visitas; nenhuma tabela ou linha removida. A remoção de lead agora preserva a visita, removendo somente o vínculo.
- Migração ensaiada na branch Neon `br-morning-moon-anmimcag`, já utilizada para validação da etapa anterior. Cenário SQL de corretor, visita sem lead, comissão/pagamento/estorno e projeto executado com rollback dos dados sintéticos.
- A migração 0014 estava aplicada, mas não registrada em `drizzle.__drizzle_migrations`. Suas 12 colunas e FK foram conferidas e seu hash registrado junto da 0015; o DDL da 0014 não foi reaplicado.
- A 0015 foi aplicada em produção (`br-steep-leaf-anxdjv1p`) em uma única transação, incluindo o registro das migrations. Hash 0015: `c5280f9bc9c78372b9748ce9398354e6603de137a5cafea57ef54e0eebcc9587`.
- Gates aprovados: TypeScript; Vitest 46 arquivos / 310 testes (33 novos); build Vite e esbuild; `git diff --check`. Os novos testes cobrem validações, isolamento de permissões, bloqueio antes do banco e persistência dos procedures.
- A publicação deve ocorrer somente após gates aprovados e migração em produção. SHA de merge e deployment READY devem constar no relato final/PR.

## Limites e pendências deliberadas

- Não equivale a declaração de operação 100%: UAT autenticado por papel/dispositivo continua na Etapa 6 e integrações reais na Etapa 7.
- Documentos de projetos usam links HTTPS; upload binário integrado, vinculação direta de comissão a contrato e consolidação financeira do legado ficam explicitamente para acabamento da Etapa 5. Não converter valores antigos em datas nem duplicar saldos.
- Nenhuma transferência automática de dados comerciais entre as empresas.
- Verificar requisitos de acesso privado/expiração dos documentos; o storage legado do Jurídico depende do proxy Forge e precisa de validação operacional.
- Bundle principal permanece grande; paginação, concorrência e regressão ampliada pertencem à Etapa 6.

## Iniciativa antiga abandonada

A PR #7 está fechada e marcada no GitHub como encerrada definitivamente, não integrar. Não faz parte das etapas futuras. Sua branch Git `codex/nextjs-santa-fe-unification` não pôde ser excluída por falta de autenticação Git nesta sessão; existe também o preview Neon `br-orange-heart-an3z3xn1`. Não foram apagados, não devem ser retomados, e a limpeza exige acesso apropriado e confirmação para excluir os dados do preview. O registro histórico da PR não é apagável por fechamento normal.

## Próximas etapas

5. Relatórios/exportações, Feeds/Agregador, Avaliações e acabamento das lacunas declaradas acima.
6. UAT, regressão, RBAC legado, responsividade, segurança, desempenho e observabilidade.
7. Credenciais e operação real de Asaas, Pluggy, Meta WhatsApp, Anthropic e armazenamento; evidências e rollback.

Cada etapa termina com checkpoint, testes, PR, merge e confirmação de deploy. Não retomar a tentativa abandonada.
