# EPIC-008: Incorporação

**Epic Owner:** A dividir entre Claude e Codex (backlog)
**Status:** Backlog

## Problem Statement

Módulo mais denso do Grupo Santa Fé (`admin/incorporacao`): terreno, topografia, massa, urbanismo, mercado, pesquisa primária, quadro de áreas, orçamento parametrizado/preliminar/obra, negociação de terreno, business plan, projetistas, aprovação de projeto, registro de incorporação, planejamento de lançamento, fornecedores, material publicitário, lançamento imobiliário, projetos executivos, cronograma de obra, atendimento a clientes, viewer 3D.

Deixado por último de propósito dado o tamanho. Modelo Prisma de referência: `EstudoIncorporacao` (dezenas de campos JSON por etapa).

**Atualização (06/09/2026):** já existe em produção (Neon, projeto SiteProspecta) a tabela `incorporation_studies`, vazia (0 linhas), sem nenhum código associado. A estrutura bate quase campo-a-campo com `EstudoIncorporacao` do Santa Fé (um campo `*_json` por etapa: terreno/topografia, urbanismo, mercado, pesquisa primária, massa/cenários, quadro de áreas, orçamento parametrizado/preliminar/obra, negociação de terreno, business plan, projetistas, aprovação de projeto, registro de incorporação, lançamento, fornecedores, material publicitário, projetos executivos, cronograma, atendimento a clientes, viabilidade). O dono do produto decidiu **reaproveitar** essa tabela em vez de recriar do zero.

## Stories

_A detalhar quando os épicos anteriores fecharem — provável divisão em sub-épicos por etapa do funil de incorporação, todos escrevendo em colunas `*_json` da mesma tabela `incorporation_studies` já existente._
