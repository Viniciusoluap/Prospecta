# S-05 — P0: Financiamentos, Jurídico e Configurações/RBAC

**Status:** Done  
**Etapa:** 3

## Financiamentos

- criação, listagem, filtros, indicadores, detalhe e exclusão;
- etapas de crédito e checklist documental;
- edição integral do processo;
- vínculos opcionais com lead, imóvel e corretor;
- validação compartilhada entre cliente e servidor.

## Jurídico

- módulo global em `/admin/juridico`;
- contratos com partes, documentos, valor, vencimento, descrição e cláusulas;
- vínculos com lead e imóvel;
- status contratual e status de assinatura;
- anexos PDF de até 10 MiB, incluindo contrato gerado e assinado;
- reaproveitamento das tabelas do Portal do Cliente, sem duplicar contratos;
- chat global de atendimento integrado às mensagens do Portal.

## Configurações e RBAC

- módulo `/admin/configuracoes`, exclusivo de administradores;
- criação, edição, ativação, desativação e exclusão de usuários;
- redefinição de senha e gestão de papel/CRECI/telefone;
- catálogo único de permissões por módulo;
- proteção contra autoexclusão, autorremoção de admin e ausência de administrador ativo;
- central `/admin/acesso` para corretores e colaboradores;
- autorização duplicada na rota React e no middleware tRPC para Financiamentos, Jurídico e rotas administrativas do Portal/CRM;
- sessões de usuários desativados são recusadas imediatamente.

Os endpoints administrativos legados que ainda usam apenas `STAFF_ROLES` permanecem mapeados para endurecimento na Etapa 6; esta história não declara a migração integral desses endpoints.

## Dados

Migration `0014_eager_hobgoblin` exclusivamente aditiva:

- `users.active`, `users.permissions`, `users.creci`;
- campos jurídicos completos em `portal_contracts`;
- vínculo opcional `portal_contracts.property_id → imoveis.id`.

## Gates

- TypeScript sem erros;
- testes automatizados, incluindo contratos, PDF e autorização granular;
- build Vite e bundle do servidor;
- migration confrontada com o schema Drizzle;
- aplicação e verificação em produção registradas no checkpoint da Etapa 3.
