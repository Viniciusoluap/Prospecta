# S-02 — Banco, permissões e router

Status: Done (14/11/2026) — migração **não aplicada** em banco real.

## Critérios de aceite
- [x] Migração aditiva e idempotente (`maquetes_3d`, `maquete_3d_config`), sem tocar tabela existente.
- [x] Módulo `maquete3d` nas permissões do colaborador.
- [x] Projeto: pedido nasce "aguardando pagamento" com o preço padrão da faixa; valor diferente só admin.
- [x] Incorporação: sem preço; nasce "aguardando autorização"; só admin autoriza.
- [x] Liberação manual de projeto (pagamento confirmado fora do sistema) só admin, com nota obrigatória.
      A cobrança pelo Asaas com liberação automática é da etapa 3.
- [x] Só PDFs ativos do próprio projeto/estudo podem ser escolhidos.
- [x] Recusar e excluir só admin; revisão com controle de versão (duas pessoas não se sobrescrevem).

## Arquivos
- `drizzle/0111_maquete_3d.sql`, `drizzle/schema-maquete-3d.ts`, `drizzle.config.ts`
- `server/maquete-3d/base.ts`, `server/maquete-3d/router.ts`, `server/routers.ts`, `server/_core/trpc.ts`
- `shared/admin-permissions.ts`
