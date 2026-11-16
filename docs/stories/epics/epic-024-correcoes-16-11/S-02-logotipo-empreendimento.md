# S-02 — Logotipo por empreendimento

Status: Done (publicada em 16/11/2026)
Epic: EPIC-024 (Fase 2) — correção 02 do dono (16/11/2026)
Paridade: Incorporação existe nos dois sistemas — pendência de porte para o Grupo Santa Fé no ROADMAP (Santa Fé em espera).
Tamanho estimado: M
Dependência: nenhuma. Migração: `drizzle/0119_logotipo_empreendimento.sql` (aditiva, idempotente; NÃO aplicada).

## Problema

Os empreendimentos da Incorporação não têm identidade visual própria: nem em Dados Gerais nem nos cartões da listagem.

## Critérios de aceite
- [x] AC1: em Dados Gerais, "Enviar logotipo" (PNG, JPG, JPEG, SVG, PDF) com pré-visualização, aprovação, troca e exclusão.
- [x] AC2: "Gerar logotipo com IA" usa o nome (e cidade/UF/tipo) do empreendimento para propor uma identidade; a proposta
      só é gravada depois de aprovada.
- [x] AC3: logotipo vinculado ao id do estudo, armazenamento persistente, nunca compartilhado entre empreendimentos.
- [x] AC4: PDF (1ª página) e SVG convertidos em PNG de exibição no navegador; os cartões recebem só esse PNG.
- [x] AC5: logotipo em cada cartão da listagem, mantendo a proporção (`object-contain`) e responsivo.
- [x] AC6: só recursos de IA já existentes, sem ativar a integração Anthropic; sem gerador configurado a tela diz qual
      provedor/chave falta — nunca finge uma geração.
- [x] AC7: tipo conferido pelos bytes iniciais (não pela extensão nem pelo tipo do navegador).
- [x] AC8: respeita o limite de ~4,5 MB da Vercel (original em partes de 1 MiB; PNG de exibição até 1,5 MB no pedido final).

## Tarefas
- [x] T1: migração 0119 (`incorporation_study_logos`, FK com CASCADE para a exclusão definitiva do estudo) + schema
      Drizzle em arquivo próprio (`drizzle/schema-incorporacao-logos.ts`, incluído no `drizzle.config.ts`).
- [x] T2: `shared/incorporacao/logotipo.ts` — tipos, limites, `tipoDoLogo` (bytes), `promptLogotipo`.
- [x] T3: `server/incorporacao-logo-router.ts` (`incorporacao.logo.*`: obter, versoes, salvar, excluir, iaDisponivel, gerarIa).
- [x] T4: rota Express `server/routes/incorporacao-logo.ts` (PNG com ETag/cache privado; original só como anexo),
      registrada no servidor local e na Vercel (`api/index.ts`).
- [x] T5: `generateImageBytes` e `faltandoParaGerarImagem` em `server/_core/imageGeneration.ts` (Manus Forge).
- [x] T6: tela — `LogotipoEmpreendimento` em Dados Gerais e miniatura nos cartões.
- [x] T7: testes.

## Dev Notes
- Nunca na linha do estudo: `getAllIncorporationStudies` lê todas as colunas e o gatilho de versões copia cada UPDATE
  para `incorporation_study_versions`. A listagem só recebe `logo.versoes` (estudo + hash do PNG + tamanho), sem bytes.
- Troca: grava o novo e marca `deleted_at` nos anteriores do mesmo estudo; `obter` pega o ativo mais novo. Excluir =
  marcar `deleted_at` (o arquivo fica para auditoria; some de vez com a exclusão definitiva do estudo, por CASCADE).
- [AUTO-DECISION] Gerador de imagem: o único código existente é o Manus Forge (`BUILT_IN_FORGE_API_URL` e
  `BUILT_IN_FORGE_API_KEY`), sem uso até hoje. O botão consulta o servidor; sem as duas variáveis, mostra
  "Geração de imagem não configurada: o Manus Forge precisa de … no servidor". Anthropic e Gemini não são chamados.
  **Dependência pendente:** cadastrar as variáveis do Forge na Vercel (ou escolher outro provedor de imagem) — só o dono.
- Correção de quebra latente: `imageGeneration.ts` importava `"server/storage"` (só resolve pelo `baseUrl` do tsc;
  no bundle do esbuild viraria pacote externo inexistente). Passou a `../storage.js`.
- `desenharPaginaPdf` extraído de `client/src/components/maquete-3d/fundo-pdf.ts` (mesmo comportamento na maquete) e
  reaproveitado para o PDF do logotipo; SVG é desenhado por `<img>` (não executa scripts) num canvas.
- Original baixado com `Content-Disposition: attachment`, `nosniff` e `CSP: sandbox` (SVG nunca abre como página).
- `usuarioDaIncorporacao` (checagem de sessão + módulo) passou a ser exportado de `server/routes/camadas-terreno.ts`.

## Testes
- Automáticos: `server/incorporacao-logotipo.test.ts` (11 testes, PGlite com a 0119 aplicada duas vezes) — passando:
  tipo pelos bytes; envio/troca/um ativo por estudo; A nunca devolvido para B; conteúdo × extensão; exibição só PNG;
  estudo inexistente; versões sem bytes e estudo sem coluna de logotipo; rota de imagem (PNG, ETag, 304, original como
  anexo, 404, 403); exclusão; permissão do módulo; IA "não configurada" sem nenhuma chamada de rede; IA com gerador
  falso devolve proposta sem gravar; gerador fora do ar.
- `server/api-rotas-producao.test.ts` e `server/aiox-migrations.test.ts` — passando. `npx tsc --noEmit` — sem erros.
- Manuais: enviar PNG, JPG, SVG e PDF reais; conferir os cartões no celular, tablet e computador.
- Pendente em produção: aplicar a 0119 no Neon; geração por IA depende das variáveis do Forge.

## File List
- `drizzle/0119_logotipo_empreendimento.sql` (novo)
- `drizzle/schema-incorporacao-logos.ts` (novo)
- `drizzle.config.ts`
- `shared/incorporacao/logotipo.ts` (novo)
- `server/incorporacao-logo-router.ts` (novo)
- `server/routes/incorporacao-logo.ts` (novo)
- `server/routes/camadas-terreno.ts` (só `export` no helper de sessão)
- `server/_core/imageGeneration.ts`
- `server/_core/index.ts`, `api/index.ts` (registro da rota)
- `server/routers.ts` (montagem de `incorporacao.logo` e um import)
- `client/src/components/incorporacao/LogotipoEmpreendimento.tsx` (novo)
- `client/src/components/maquete-3d/fundo-pdf.ts` (`desenharPaginaPdf`)
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `client/src/pages/admin/AdminIncorporacao.tsx`
- `server/incorporacao-logotipo.test.ts` (novo)
- `docs/stories/epics/epic-024-correcoes-16-11/S-02-logotipo-empreendimento.md` (esta story)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO); Ready for Review |
