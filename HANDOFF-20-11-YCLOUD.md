# HANDOFF 20/11 — EPIC-027 C7: integração YCloud (API oficial do WhatsApp)

Ramo: `epic027-y` (commits locais; push/merge com o coordenador). Story: `docs/stories/epics/epic-027-correcoes-20-11-noite/C7-integracao-ycloud.md`.

## Concluído
- Migração `drizzle/0141_ycloud.sql` (NÃO aplicada) + `drizzle/schema-ycloud.ts`.
- Servidor: `server/_core/ycloud.ts`, `server/ycloud/{config,conta,campanhas,webhook,router}.ts`; rota `POST /api/ycloud/webhook`
  (corpo bruto) em `api/index.ts` e `server/_core/index.ts`; router `whatsappOficial` (só admin por papel).
- Telas: `YcloudCard` (Integrações), `CampanhaApiOficial` / `PainelCampanhasApiOficial` / `ModelosApiOficial` (Central).

## Testes
- (a) automáticos: `server/ycloud/ycloud.test.ts` 24/24; WhatsApp afetados 54/54; `tsc` 0 erros; `vite build` ok.
- (b) manuais: nenhum.
- (c) pendentes em produção: aplicar 0141; chave, Testar, Ativar avisos, ligar; campanha de 1 destinatário (celular de teste).

## Pendências
- QA de segurança (@qa) antes da `main`.
- Eco em coexistência: ligar `ehEcoDeCampanhaOficial` em `server/dolores/roteamento.ts` (`tratarPropria`) — frente da Dolores.
- Preço oficial por mensagem (conferir no painel); criar modelo pela tela (não feito).
- Porte ao Grupo Santa Fé (ROADMAP).

## Próximo passo exato
@qa revisar o ramo `epic027-y`; depois aplicar 0141 no Neon, publicar e seguir o passo a passo do dono (na story/relatório).
