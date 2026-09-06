# EPIC-008: Incorporação

**Epic Owner:** Claude
**Status:** In Progress (S-01 a S-05 Done)

**Atualização (06/09/2026, S-03):** a S-03 originalmente descrita como "Estudo urbanístico e de mercado" foi re-escopada para "Estudo de Mercado" apenas — os campos `urban_parameters_json`/`potential_json`/`urbanistic_opinion` (parâmetros urbanísticos e potencial construtivo) não têm aba própria no Santa Fé; são consumidos dentro da aba de Massa/Quadro de Áreas, então passam a fazer parte da S-04. Ver `S-03-estudo-mercado.md` para o raciocínio completo.

## Problem Statement

Módulo mais denso do Grupo Santa Fé (`admin/incorporacao`): terreno, topografia, massa, urbanismo, mercado, pesquisa primária, quadro de áreas, orçamento parametrizado/preliminar/obra, negociação de terreno, business plan, projetistas, aprovação de projeto, registro de incorporação, planejamento de lançamento, fornecedores, material publicitário, lançamento imobiliário, projetos executivos, cronograma de obra, atendimento a clientes, viewer 3D.

Deixado por último de propósito dado o tamanho. Modelo Prisma de referência: `EstudoIncorporacao` (dezenas de campos JSON por etapa).

**Atualização (06/09/2026):** já existe em produção (Neon, projeto SiteProspecta) a tabela `incorporation_studies`, vazia (0 linhas), sem nenhum código associado. A estrutura bate quase campo-a-campo com `EstudoIncorporacao` do Santa Fé (um campo `*_json` por etapa: terreno/topografia, urbanismo, mercado, pesquisa primária, massa/cenários, quadro de áreas, orçamento parametrizado/preliminar/obra, negociação de terreno, business plan, projetistas, aprovação de projeto, registro de incorporação, lançamento, fornecedores, material publicitário, projetos executivos, cronograma, atendimento a clientes, viabilidade). O dono do produto decidiu **reaproveitar** essa tabela em vez de recriar do zero.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Schema Drizzle para `incorporation_studies` (tabela já existe em produção — apenas declarar, sem recriar) + router tRPC com CRUD dos campos identificadores (nome/cidade/estado/endereço/responsável/status) |
| FR-02 | `/admin/incorporacao` — lista de estudos com indicador de situação e criação |
| FR-03 | `/admin/incorporacao/:id` — detalhe com dados gerais editáveis; demais módulos (terreno, massa, orçamentos, lançamento, obra) ficam para stories futuras |
| FR-04..FR-13 | Um módulo `*_json` por story futura (ver tabela de Stories) — cada um replica a lógica de negócio do Santa Fé para aquela etapa, gravando no campo correspondente já existente na tabela |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | A tabela `incorporation_studies` já existe em produção (Neon, projeto SiteProspecta) com todas as colunas `*_json` — nenhuma story deste épico deve gerar uma migration de `CREATE TABLE`; apenas a declaração inicial no Drizzle (S-01) precisa reconciliar isso manualmente (ver Change Log) |
| CON-02 | Epic muito maior que os anteriores (~24 colunas `*_json`, cada uma um sub-módulo completo do Santa Fé) — dividido em stories por etapa do funil de incorporação, não implementado de uma vez |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Schema (reconciliado com tabela já existente) + router CRUD básico + lista/detalhe admin | Done |
| S-02 | Terreno e geometria (KML, área/perímetro, APP, topografia) | Done |
| S-03 | Estudo de Mercado (pesquisa de cidade/mercado via IA, precificação por comparáveis ponderados, pesquisa primária com compradores) | Done |
| S-04 | Parâmetros urbanísticos, potencial construtivo, massa generativa e Quadro de Áreas (NBR 12721) | Done |
| S-05 | Orçamento parametrizado e negociação do terreno | Done |
| S-06 | Business plan e investidores | Backlog |
| S-07 | Contratação de projetistas e aprovação de projeto | Backlog |
| S-08 | Registro da incorporação e orçamento preliminar (EVE) | Backlog |
| S-09 | Planejamento de lançamento, fornecedores e material publicitário | Backlog |
| S-10 | Lançamento imobiliário e mix de produtos | Backlog |
| S-11 | Projetos executivos, orçamento e cronograma físico-financeiro da obra | Backlog |
| S-12 | Atendimento aos clientes e relatórios (PDF) | Backlog |

_Cada story S-02+ implementa um módulo isolado, lendo/gravando apenas sua própria coluna `*_json` — baixo acoplamento entre stories, podem ser feitas em qualquer ordem após a S-01._
