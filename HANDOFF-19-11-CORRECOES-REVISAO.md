# HANDOFF 19/11 — paridade das 3 correções da revisão automática do PR #263 do Grupo Santa Fé

Branch: `claude/paridade17-correcoes-revisao` (nos dois repositórios). Sem merge, sem PR, sem deploy, sem migração.
O código do PR #263 do Santa Fé veio daqui; os três defeitos foram confirmados também na Prospecta e corrigidos com a
mesma regra. Santa Fé: commit `6d0c744` na mesma branch (handoff de mesmo nome na raiz de lá).

## Concluído

1. **Viabilidade sem premissas gravadas não salvava** (confirmado: mesmo `useSalvamento`/`salvarFila`)
   - `client/src/components/incorporacao/estudo/compat/fila-salvamento.ts`: campo opcional `registrado` e parâmetro
     `forcar` (com `registrado === false` e `forcar`, grava sem alteração; o JSON inicial vale como "anterior").
   - `compat/salvamento.tsx`: opção `{ semRegistro: true }`; `salvo` falso até a primeira gravação; `salvar` (botão) força;
     o automático só grava depois de uma alteração. A falha da primeira gravação aparece no aviso do estudo
     (`AvisoSalvamento`, "Tentar novamente"). Sem a opção, os outros 20 usos do gancho não mudam.
   - `viabilidade-tab.tsx`: `{ semRegistro: !salvo }` e o aviso "Premissas ainda não gravadas — clique em Salvar premissas
     para registrá-las."
2. **Proposta do terreno: e-mail podia anexar PDF diferente da prévia** (confirmado em `server/incorporacao-proposta-router.ts`, EPIC-024 S-06)
   - `enviar` recebe `pdfSha256`; `conferirPdfDaPrevia` recusa (TRPC `CONFLICT`) com "A proposta mudou desde a prévia;
     gere a prévia de novo." se o hash estiver ausente, malformado ou diferente do PDF gerado agora. Nada é enviado nem
     registrado (padrão das outras validações).
   - `compat/proposta-terreno.ts` (`enviarProposta(..., pdfSha256)`, `AVISO_PROPOSTA_MUDOU`) e `proposta-terreno-envio.tsx`
     (manda o hash da prévia; nesse erro o botão vira "Gerar a prévia de novo").
3. **Mapa operacional: marcadores de agrupamento velhos** (confirmado em `client/src/pages/admin/AdminMapa.tsx`, commit 2cb1fd2)
   - `shared/mapa-alfinetes.ts`: `chaveDoMarcador(propriedades, geracao)`.
   - `AdminMapa.tsx`: geração sobe e cache de marcadores é limpo a cada `setData`.

Testes novos/ajustados (nenhum apagado nem pulado): `server/incorporacao-autosalvamento.test.ts` (+6),
`server/incorporacao-proposta-terreno.test.ts` (+1; chamadas existentes passam o hash), `server/mapa-alfinetes.test.ts` (+2).

## Testes

(a) Automáticos (rodados nesta sessão):
- `npx tsc --noEmit -p .` → sem erros.
- `npx vitest run` → 261 arquivos e 2847 testes passaram (0 falhas, 0 pulados).
- `npx vite build` → concluído ("built in 28.88s"; só o aviso de tamanho de chunk, que já existia).

(b) Manuais: nenhum (sem navegador nesta sessão).

(c) Pendente de validação em produção (depois do merge autorizado): Viabilidade de estudo sem premissas (aviso, botão
grava, Relatório deixa de pedir), proposta alterada depois da prévia (recusa e nova prévia) e filtro/busca no Mapa
operacional (grupos e clique do conjunto novo).

## Próximo passo

Revisão/QA e merge na `main` só com autorização do dono. Nenhuma migração foi criada.
