# S-10 — Anthropic — Inteligência Artificial (cadastro, sem ativar)

Status: Done (publicada em 16/11/2026)
Epic: EPIC-024 (Fase 5) — correção 10 do dono (16/11/2026)
Paridade: Admin › Integrações existe nos dois sistemas — porte para o Grupo Santa Fé fica como pendência no ROADMAP
(Santa Fé em espera por decisão do dono).
Tamanho estimado: M
Dependência: nenhuma. S-03 (PDF só imagem) vai optar EXPLICITAMENTE por esta chave depois.

## Problema

O dono quer cadastrar a chave da Anthropic na tela de Integrações, no mesmo padrão das outras, e escolher o modelo
preferencial entre os que a conta realmente tem — sem ativar a IA agora. Armadilha: `ENV.anthropicApiKey` já é lida
pela avaliação por IA, pelo mercado da incorporação, pela base da maquete e pela Central de Vendas; copiar
`segredos-mercado.ts` (que escreve a chave do banco em `ENV`) ligaria em silêncio a IA paga nessas funções.

## Critérios de aceite
- [x] AC1: painel "Anthropic — Inteligência Artificial" em Admin › Integrações, no padrão visual dos demais: campo de
      chave protegido, salvar, testar conexão, trocar, remover e indicador de configurado.
- [x] AC2: a chave fica criptografada (AES-256-GCM) em `dashboard_settings["segredo.anthropic_painel_api_key"]`; nenhuma
      rota devolve a chave (só os 4 últimos caracteres); erros mascaram `sk-ant-…`; só admin.
- [x] AC3: a chave é validada na Anthropic antes de salvar; o teste de conexão só roda quando o admin clica.
- [x] AC4: "Modelo de IA preferencial" lista os modelos que a chave tem, consultando a API (`client.models.list()`),
      com nome e id oficiais, agrupados por família (Opus, Sonnet, Haiku e Fable quando a API devolver); a preferência
      é validada contra os ids listados e pode ser trocada depois.
- [x] AC5: nada é ativado: a chave do painel nunca é escrita em `ENV`; o modelo preferencial não altera os modelos da
      maquete, da Central de Vendas nem `INCORPORACAO_IA_MODELO`; nenhuma chamada automática, nenhum token consumido.
- [x] AC6: uma única função exportada (`configuracaoAnthropicPainel`) devolve chave + modelo para uso futuro explícito,
      documentada como "ainda não usada por nenhuma função".

## Tarefas
- [x] T1: `server/_core/anthropic-painel.ts` — acessor isolado (ler/gravar, validar, listar modelos, mascarar).
- [x] T2: rotas admin em `integracoes-router.ts` (`statusAnthropic`, `testarAnthropic`, `salvarAnthropic`,
      `removerAnthropic`, `modelosAnthropic`, `salvarModeloAnthropic`), dependências injetáveis.
- [x] T3: `AnthropicCard.tsx` na página de Integrações.
- [x] T4: testes (cliente da Anthropic simulado), `tsc --noEmit`, `vite build`.

## Dev Notes (16/11/2026)
- SDK instalado `@anthropic-ai/sdk` 0.106.0: `models.list()` devolve `PagePromise` iterável (`for await` pagina sozinho);
  `ModelInfo` traz `id`, `display_name`, `created_at`. Listar modelos não consome tokens.
- [AUTO-DECISION] Teste de conexão e lista de modelos como mutações (só rodam no clique), ao contrário do Mapbox, que
  testa ao abrir — pedido "teste disparado pelo admin".
- [AUTO-DECISION] Modelo preferencial guardado em `segredo.anthropic_painel_modelo` (prefixo `segredo.` para não
  aparecer na listagem geral de `dashboard_settings`). Sem migração: reutiliza `dashboard_settings`.
- [AUTO-DECISION] Trocar a chave mantém a preferência; se o modelo salvo não aparecer na lista da chave nova, a tela avisa.
- Família deduzida do id/nome devolvido pela API ("opus", "sonnet", "haiku", "fable"; o resto em "Outros") — sem lista fixa.
- Guarda: teste varre `server/**/*.ts` (fora testes) e falha se algum arquivo além do router e do acessor citar
  `anthropic-painel`.

## Correções do portão de QA (16/11, CONCERNS)
- [x] Q1 (MEDIUM): guarda reforçada — procura também `anthropic_painel` (chave do banco), `configuracaoAnthropicPainel` e
      as constantes, em `server/`, `api/`, `shared/`, `scripts/`, `client/` e `drizzle/`; no router, confere que só
      `statusAnthropic`, `testarAnthropic`, `salvarAnthropic`, `removerAnthropic`, `modelosAnthropic` e
      `salvarModeloAnthropic` usam o acessor.
- [x] Q2 (LOW): chave salva que não decifra (JWT_SECRET trocado) → status `ilegivel` com "não pode ser lida — cadastre de
      novo" (a tela mostra o aviso e deixa remover); valor `plain:` é recriptografado na primeira leitura.
- [x] Q3 (LOW): ao trocar a chave, o modelo preferencial é revalidado na lista da chave nova e limpo, com aviso, se não for
      oferecido.

## Testes
- Automáticos: `server/integracoes-anthropic.test.ts` — 12 testes (chave nunca devolvida, gravada criptografada,
  validação antes de salvar, troca, remoção, teste sem chave não chama a API, erro mascarado, lista de modelos com
  cliente falso, preferência validada e trocável, não admin barrado, `ENV.anthropicApiKey` e `incorporacaoIaModelo`
  inalterados, nenhum código operacional importa o acessor). `server/integracoes.test.ts` continua passando.
- Manuais: abrir Admin › Integrações, adicionar chave, testar, escolher modelo, remover.
- Pendente em produção: chave real do dono e a lista real de modelos da conta.

## File List
- `server/_core/anthropic-painel.ts` (novo) — acessor isolado da chave e do modelo do painel.
- `server/integracoes-router.ts` — rotas admin da Anthropic.
- `server/integracoes-anthropic.test.ts` (novo) — 12 testes.
- `client/src/components/admin/AnthropicCard.tsx` (novo) — painel.
- `client/src/pages/admin/AdminIntegracoes.tsx` — inclui o painel.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e Draft → InProgress (YOLO, regra de execução contínua do EPIC-024) |
| 16/11/2026 | @dev (Dex) | InProgress → Ready for Review: painel, acessor isolado, 12 testes |
| 16/11/2026 | @qa | Portão: CONCERNS (Q1 MEDIUM, Q2/Q3 LOW) |
| 16/11/2026 | @dev (Dex) | Q1–Q3 corrigidos; 16 testes no arquivo |
