# S-09 — Gerador de PCI: CPF do engenheiro, "Dados automáticos" e biblioteca de modelos

Status: InReview
Epic: EPIC-024 (Fase 3) — correção 09 do dono (16/11/2026)
Paridade: Gerador de PCI existe nos dois sistemas — porte para o Grupo Santa Fé fica como pendência no ROADMAP
(Santa Fé em espera por decisão do dono, ver EPIC.md).
Tamanho estimado: L
Migração: `drizzle/0118_pci_modelos_preenchimento.sql` (aditiva e idempotente).

## Problema

A) O CPF do engenheiro Rafael Claudino está no perfil, mas o Gerador de PCI não o preenche. `listarEngenheiros`
(`server/usuario-documentos.ts`) não lê `engineer_profiles.cpf` e `aplicarEngenheiroPci` (`shared/pci-gerador.ts`) não
grava `rtpCpf`/`rteCpf` (AK47/AK50); o comentário "CPF não existe no perfil" ficou velho desde a migração 0098.

B) O botão "Dados automáticos" não preenche nada: sem rascunho, a tela já abre com `preenchimentoAutomaticoPci` e o botão
devolve o mesmo formulário, sem dizer o que fez. RTP/RTE nunca vêm (a obra não guarda engenheiro); a falha de leitura da
PCI vinculada é engolida; e o botão troca o formulário inteiro (com `confirm`) em vez de só completar.

C) Não há biblioteca de modelos de preenchimento: uma casa padrão de 70 m² usada em 20 obras exige redigitar todo o
memorial, sistema construtivo, custos e cronograma em cada obra.

## Decisão que substitui a de 30/10
`HANDOFF-30-10-CPF-ENGENHEIRO.md` decidiu "sem cópia automática de dados pessoais e sem CPF em listas". O pedido do dono
de 16/11 substitui a primeira parte **só para o CPF do próprio engenheiro** escolhido como RTP/RTE na PCI: ele é buscado no
servidor apenas para o engenheiro escolhido (procedimento do módulo Obras, `pciGerador.engenheiro`). A segunda parte
continua: o CPF nunca vai na lista de engenheiros. CPF de cliente nunca é copiado entre obras.

## Critérios de aceite
- [x] AC1: ao escolher o engenheiro em RTP e/ou RTE, preenchem nome, CPF, e-mail, DDD/telefone, registro (CREA) e UF do
      registro, vindos do perfil. O mesmo profissional pode ser RTP e RTE, ou profissionais diferentes.
- [x] AC2: o CPF nunca aparece no payload da lista de engenheiros; é buscado só para o engenheiro escolhido.
- [x] AC3: perfil de Engenheiro desativado ou incompleto (sem CPF/CREA/telefone) é avisado na tela — nada é inventado.
- [x] AC4: escolher engenheiro com campos RTP/RTE já preenchidos com outros valores pede confirmação antes de substituir.
- [x] AC5: "Dados automáticos" usa obra, cliente do CRM, localização, PCI vinculada e engenheiros (o escolhido na obra ou o
      do projeto vinculado ao mesmo serviço do CRM) e mostra: o que preencheu e de qual fonte; o que já estava igual; o que
      está diferente (conflito) com confirmação por campo ou de todos; o que não foi encontrado e por quê.
- [x] AC6: "Dados automáticos" nunca sobrescreve campo preenchido sem confirmação explícita.
- [x] AC7: dá para salvar a PCI da obra como modelo com nome; o modelo guarda SÓ os campos técnicos de uma lista de
      permissão (allow-list em `CAMPOS_PCI`), nunca dados pessoais/específicos (proponente, RTP/RTE, endereço, bairro,
      coordenadas, matrícula, imagem, valores do terreno/imóvel, cliente).
- [x] AC8: aplicar um modelo em outra obra preenche só os campos técnicos, mantém os dados pessoais da obra atual e
      trata conflito igual ao AC5/AC6; dá para ajustar depois e começar em branco.
- [x] AC9: vários modelos; salvar sobre um modelo cria nova versão e preserva a anterior; histórico das versões.
- [x] AC10: geração da planilha oficial (fórmulas, estrutura e formato do modelo da CAIXA) não muda.
- [x] AC11: permissões: só admin e colaborador com o módulo Obras usam o gerador e a biblioteca; corretor, empreiteiro e
      colaborador sem Obras não.

## Tarefas
- [x] T1: story.
- [x] T2: A — `dadosEngenheiroPci` (servidor) + `pciGerador.engenheiro`; `aplicarEngenheiroPci` com CPF e avisos;
      seletor com confirmação e botão "Mesmo profissional do RTP".
- [x] T3: B — sugestões com fonte (`sugestoesAutomaticasPci`), comparação (`compararPreenchimentoPci`), engenheiro da obra
      (rascunho/última PCI gerada/projeto do mesmo serviço do CRM), motivos do que faltou; painel de resultado na tela.
- [x] T4: C — migração 0118 + schema; `copiavel` (allow-list) em `CAMPOS_PCI`; `extrairModeloPreenchimentoPci`;
      procedimentos listar/salvar/obter/histórico/excluir; painel de modelos na tela.
- [x] T5: testes (A, B, C, permissões); suítes PCI, `npx tsc --noEmit`, `npx vite build`.
- [ ] T6: aplicar a migração 0118 no Neon e conferir com o perfil real do Rafael (fora deste agente — sem acesso a banco real).

## Arquivos principais
- `shared/pci-gerador.ts`, `server/pci-gerador.ts`, `client/src/components/obra/GeradorPciAba.tsx`
- `drizzle/0118_pci_modelos_preenchimento.sql`, `drizzle/schema.ts`

## Testes previstos
- Automáticos: `server/pci-s09.test.ts` (puros) e `server/pci-s09-db.test.ts` (PGlite).
- Manuais: escolher o Rafael em RTP e RTE; "Dados automáticos" numa obra com rascunho; salvar/aplicar modelo.
- Pendente em produção: perfil real do Rafael (ativo? CPF gravado?), migração 0118 aplicada.

## Riscos
- Perfil do Rafael desativado (`active=false`): a tela avisa; CPF/CREA/telefone do perfil não entram.
- Projeto operacional vinculado ao mesmo serviço com engenheiros diferentes: não escolhe nenhum, avisa.

## Dev Notes (implementação, 16/11/2026)
- **Causa confirmada A:** `listarEngenheiros` não seleciona `engineer_profiles.cpf`; `aplicarEngenheiroPci` não gravava
  `rtpCpf`/`rteCpf`. Correção: `dadosEngenheiroParaPci` (server/usuario-documentos.ts) lê UM engenheiro com CPF, mesmas
  regras da lista (usuário ativo, colaborador/admin; dados do perfil só com perfil ativo); `pciGerador.engenheiro` devolve
  isso + avisos (sem perfil, perfil desativado, faltando CPF/CREA/UF/telefone/e-mail). A lista segue sem CPF (testado).
- **Causa confirmada B:** sem rascunho a tela abre com o mesmo `preenchimentoAutomaticoPci` que o botão devolve; o botão
  trocava o formulário inteiro sem relatório; RTP/RTE nunca vinham; falha de leitura da PCI vinculada e da localização era
  engolida. Correção: `sugestoesAutomaticasPci` (fonte de cada valor + motivo do que falta) e `compararPreenchimentoPci`
  (só completa vazio; igual; conflito com confirmação por campo ou todos). A abertura usa as mesmas fontes.
- **Engenheiro da obra (sem relação inventada):** `construction_projects` não tem engenheiro. Fontes usadas, em ordem:
  (1) o escolhido no formulário aberto, (2) `rtpEngenheiroId`/`rteEngenheiroId` do rascunho (`pci_generator_drafts` —
  a escolha já ficava guardada com a obra), (3) os da última PCI gerada, (4) só para o RTP, o `engineer_user_id` de
  `operational_projects` com o MESMO `lead_service_id` da obra — e só se houver um único engenheiro. Nenhuma coluna nova.
- [AUTO-DECISION] Pessoa não se mistura: se um dado do proponente/RTP/RTE está diferente, os vazios da mesma pessoa também
  vão para confirmação; RTP/RTE vêm de UMA origem (o CPF do RT da PCI vinculada nunca entra ao lado do nome de outro
  engenheiro). Motivo: evitar CPF de uma pessoa com nome de outra.
- [AUTO-DECISION] Escolher engenheiro com campos RTP/RTE já preenchidos com outro valor pede `confirm` com a lista dos
  campos; botão "Mesmo profissional do RTP" no RTE.
- [AUTO-DECISION] Lista de permissão (`CAMPOS_COPIAVEIS_MODELO_PCI`): áreas coberta/acessória e destinação, todo o memorial,
  todo o sistema construtivo, geração alternativa de energia, executor/BDI/justificativa, prazo e justificativa do prazo,
  mais custos, adicionais e cronograma. Fora (sempre): proponente, RTP/RTE, imóvel (endereço, bairro, CEP, município, UF),
  matrícula/cartório/coordenadas/construtora/finalidade, documentação da obra, área e valor do terreno, valores do imóvel e
  financiado, área permeável, água/drenagem/esgoto (dependem do lote), pré-executado, obras pré-existentes, observações,
  local/data, imagem e engenheiros escolhidos. O servidor extrai de novo ao salvar e ao ler (não confia no navegador).
- [AUTO-DECISION] Versões: salvar sobre um modelo cria `versao + 1` com `previous_id`; índice único em `previous_id` impede
  duas versões a partir da mesma; nome repetido (sem distinguir maiúsculas) é recusado. Exclusão lógica de todas as
  versões, só pelo admin ou por quem salvou a última versão. Dá para aplicar qualquer versão do histórico.
- [AUTO-DECISION] "Começar em branco" limpa a tela (com confirmação); o rascunho só muda ao salvar. O formulário guarda
  `modeloOrigem` (id, nome, versão) para a obra mostrar qual modelo usou.
- O tratamento do modelo oficial da CAIXA (`server/caixa/pci-gerador.ts`, fórmulas/estrutura/formato) não foi tocado.
- Testes: `createCaller` direto no sub-router perde o prefixo `pciGerador.` e o colaborador cai em FORBIDDEN; o teste
  monta o router com o nome real.

## Handoff (S-09)
- Concluído: commits na branch local `epic024-s09` (ver Change Log); nada publicado, nada aplicado em banco real.
- Testes (a) automáticos: `npx vitest run server/pci- server/engenheiro` → 9 arquivos, 81 testes passando
  (novos: `server/pci-s09.test.ts` 12, `server/pci-s09-db.test.ts` 11); `npx tsc --noEmit` sem erros; `npx vite build` ok.
  (b) manuais: não executados (sem navegador neste agente). (c) produção: pendente.
- Pendências: aplicar `drizzle/0118_pci_modelos_preenchimento.sql` no Neon antes de publicar o código (as rotas de modelo
  falham sem a tabela; o resto funciona); conferir o perfil real do Rafael (ativo? CPF gravado?); registrar no ROADMAP o
  porte para o Grupo Santa Fé (em espera por decisão do dono); portão de QA.
- Próximo passo: @qa revisar; aplicar 0118 no Neon; publicar; abrir a obra do Rafael e escolher RTP/RTE.

## File List
- `docs/stories/epics/epic-024-correcoes-16-11/S-09-pci.md` (novo) — esta story.
- `shared/pci-gerador.ts` — `copiavel` + `CAMPOS_COPIAVEIS_MODELO_PCI`; `modeloOrigem`; `aplicarEngenheiroPci` com CPF;
  `camposTrocadosPorEngenheiroPci`, `faltasPerfilEngenheiroPci`; `sugestoesAutomaticasPci`, `compararPreenchimentoPci`,
  `aceitarSugestoesPci`, `textoValorPci`; `extrairModeloPreenchimentoPci`, `sugestoesDoModeloPci`,
  `resumoModeloPreenchimentoPci`, `validarNomeModeloPreenchimentoPci`; `preencherPciAutomatico` sobre as sugestões.
- `server/usuario-documentos.ts` — `dadosEngenheiroParaPci` (um engenheiro, com CPF).
- `server/pci-gerador.ts` — `engenheiroDaPci`, `fontesAutomaticasPci` (engenheiro da obra, motivos), `sugestoesAutomaticasDaObraPci`,
  CRUD/versões dos modelos de preenchimento; procedimentos `engenheiro`, `sugestoesAutomaticas`, `modelosPreenchimento`,
  `modeloPreenchimento`, `historicoModeloPreenchimento`, `salvarModeloPreenchimento`, `excluirModeloPreenchimento`.
- `client/src/components/obra/GeradorPciAba.tsx` — seletor com busca do perfil e confirmação, "Mesmo profissional do RTP",
  painel do resultado (preenchidos/conflitos/iguais/não encontrados), painel de modelos.
- `drizzle/0118_pci_modelos_preenchimento.sql` (novo), `drizzle/schema.ts` (`pciModelosPreenchimento`).
- `server/pci-s09.test.ts` (novo), `server/pci-s09-db.test.ts` (novo), `server/pci-gerador.test.ts` (matriz de permissões),
  `server/pci-gerador-db.test.ts` (coluna `lead_service_id` na tabela de teste).

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada (YOLO, regra de execução contínua do EPIC-024) — Draft → InProgress |
| 16/11/2026 | @dev (Dex) | InProgress → InReview: A, B e C implementados; 23 testes novos; tsc e vite build ok; 0118 não aplicada |
