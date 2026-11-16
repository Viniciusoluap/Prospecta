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
  `operational_projects` com o MESMO `lead_service_id` da obra, ignorando projeto `cancelado` — e só se houver um único
  engenheiro. Nenhuma coluna nova. A abertura sem rascunho devolve o mesmo relatório do botão (`obter.preenchimento`).
- Pessoa não se mistura — por construção (refeito após o portão de QA de 16/11, ver QA Results): proponente, RTP e
  RTE são blocos (`PESSOAS_PCI`). Cada fonte forma um bloco; dois blocos só se juntam quando são provadamente a mesma
  pessoa (`mesmaPessoaPci`: mesmo engenheiro escolhido; senão mesmo CPF; senão, sem CPF de um dos lados, mesmo nome
  completo normalizado). Preenche em silêncio só quando a pessoa está vazia na tela e há um único candidato, ou quando a
  tela já tem a mesma pessoa provada e só faltam dados. Em todo outro caso a pessoa vai inteira para escolha (manter /
  trocar a pessoa inteira por uma opção) — nunca campo a campo. `aplicarEscolhasPci` ignora conflitos de campo de pessoa.
- Procedência: `FormularioPci.procedencia` (por campo de pessoa: "manual", "crm", "pci", "engenheiro:7"…) vai no rascunho.
  `misturaPessoaPci` recusa gerar com nome e CPF de procedências diferentes (servidor, em `errosPci` com `paraGerar`); a
  tela mostra o motivo e o botão "Confirmo que nome e CPF são da mesma pessoa". Rascunho antigo sem procedência não é
  bloqueado (não há informação) — limitação registrada.
- Decisão de acesso ao CPF do engenheiro (portão de QA, item 4): o dono pediu o CPF do engenheiro preenchido na PCI.
  Escopo: quem usa o gerador (admin ou colaborador com o módulo Obras) lê o CPF SÓ dos usuários que a lista de
  engenheiros do gerador oferece (`listarEngenheiros`: usuário ativo, colaborador ou admin; CPF só com perfil ativo).
  Qualquer outro id → FORBIDDEN, também nos ids vindos de "Dados automáticos". Cada leitura gera
  `console.info({"evento":"pci.cpf_engenheiro_lido", usuarioId, projectId, engenheiroId, origem, comCpf, em})` — só ids,
  no mesmo padrão de log estruturado de `server/whatsapp-router.ts`. Observação: admins aparecem na lista (regra já
  existente); um admin com perfil de Engenheiro ativo tem o CPF legível pelo gerador.
- [AUTO-DECISION] Escolher engenheiro com campos RTP/RTE já preenchidos com outro valor pede `confirm` com a lista dos
  campos; botão "Mesmo profissional do RTP" no RTE.
- [AUTO-DECISION] Lista de permissão (`CAMPOS_COPIAVEIS_MODELO_PCI`): áreas coberta/acessória e destinação, todo o memorial,
  todo o sistema construtivo, geração alternativa de energia, executor/BDI/justificativa, prazo e justificativa do prazo,
  mais custos, adicionais e cronograma. Fora (sempre): proponente, RTP/RTE, imóvel (endereço, bairro, CEP, município, UF),
  matrícula/cartório/coordenadas/construtora/finalidade, documentação da obra, área e valor do terreno, valores do imóvel e
  financiado, área permeável, água/drenagem/esgoto (dependem do lote), pré-executado, obras pré-existentes, observações,
  local/data, imagem e engenheiros escolhidos. O servidor extrai de novo ao salvar e ao ler (não confia no navegador).
- [AUTO-DECISION] Versões: salvar sobre um modelo cria `versao + 1` com `previous_id`; índice único em `previous_id` impede
  duas versões a partir da mesma; nome repetido (sem distinguir maiúsculas) é recusado — também numa nova versão (não toma
  o nome de outro modelo). Exclusão lógica de todas as versões, só pelo admin ou pelo AUTOR ORIGINAL (quem salvou a v1).
  Dá para aplicar qualquer versão do histórico.
- Modelo e dado pessoal em texto livre: salvar é RECUSADO (com a lista dos campos) quando o nome, a observação, um campo de
  texto do modelo ou a descrição de serviço adicional tem CPF/CNPJ (com ou sem pontuação, dígitos conferidos), e-mail ou
  telefone (`dadosPessoaisNoModeloPci`). Campo de lista só entra no modelo com opção EXATA do modelo oficial. O título da
  obra de origem (que costuma ter o nome do cliente) só aparece para o admin. Nome de pessoa em texto livre sem documento
  não é detectável com segurança — limitação.
- [AUTO-DECISION] "Começar em branco" limpa a tela (com confirmação); o rascunho só muda ao salvar. O formulário guarda
  `modeloOrigem` (id, nome, versão) para a obra mostrar qual modelo usou.
- O tratamento do modelo oficial da CAIXA (`server/caixa/pci-gerador.ts`, fórmulas/estrutura/formato) não foi tocado.
- Testes: `createCaller` direto no sub-router perde o prefixo `pciGerador.` e o colaborador cai em FORBIDDEN; o teste
  monta o router com o nome real.

## Handoff (S-09)
- Concluído: commits na branch local `epic024-s09` (ver Change Log); nada publicado, nada aplicado em banco real.
- Testes (a) automáticos: `npx vitest run server/pci- server/engenheiro` → 9 arquivos, 94 testes passando
  (`server/pci-s09.test.ts` 21, `server/pci-s09-db.test.ts` 15); `npx tsc --noEmit` sem erros; `npx vite build` ok;
  sonda do QA (`qa-s09/probe.mts`) sem mistura em P1–P3. (b) manuais: não executados (sem navegador neste agente).
  (c) produção: pendente.
- Pendências: aplicar `drizzle/0118_pci_modelos_preenchimento.sql` no Neon antes de publicar o código (as rotas de modelo
  falham sem a tabela; o resto funciona). **Depois de aplicar a 0118, conferir no Neon que o papel do aplicativo é dono da
  tabela `pci_modelos_preenchimento`** (RLS ligado sem políticas: só o dono/superusuário enxerga as linhas — mesmo padrão
  das tabelas da 0087). Conferir o perfil real do Rafael (ativo? CPF gravado?); registrar no ROADMAP o porte para o
  Grupo Santa Fé (em espera por decisão do dono); novo portão de QA.
- Portão 2 (CONCERNS) corrigido: commits 20a6de3, 004ed9a, 176b981, 39e5263. Testes: `npx vitest run server/pci-
  server/engenheiro` → 9 arquivos, 107 testes; `server/auth-session.test.ts server/imports-esm.test.ts` → 7 testes; tsc ok.
  A 0118 ganhou a coluna `substituido` e o índice único parcial do nome — aplicar a versão NOVA no Neon.
- Próximo passo: @qa revisar de novo; aplicar 0118 no Neon; publicar; abrir a obra do Rafael e escolher RTP/RTE.

## File List
- `docs/stories/epics/epic-024-correcoes-16-11/S-09-pci.md` (novo) — esta story.
- `shared/pci-gerador.ts` — `copiavel` + `CAMPOS_COPIAVEIS_MODELO_PCI`; `modeloOrigem`; `procedencia`; `PESSOAS_PCI`,
  `pessoaDaChavePci`, `mesmaPessoaPci`; `aplicarEngenheiroPci` com CPF e procedência; `camposTrocadosPorEngenheiroPci`,
  `faltasPerfilEngenheiroPci`; `sugestoesAutomaticasPci`, `compararPreenchimentoPci` (blocos de pessoa, `pessoas`,
  `avisos`), `aplicarEscolhasPci`, `definirCampoPci`, `confirmarMesmaPessoaPci`, `misturaPessoaPci` (em `errosPci` ao
  gerar), `textoValorPci`; `extrairModeloPreenchimentoPci`, `sugestoesDoModeloPci`, `resumoModeloPreenchimentoPci`,
  `validarNomeModeloPreenchimentoPci`, `dadosPessoaisNoTextoPci`, `dadosPessoaisNoModeloPci`.
- `server/usuario-documentos.ts` — `dadosEngenheiroParaPci` (um engenheiro, com CPF).
- `server/pci-gerador.ts` — `engenheiroDaPci` (só da lista, FORBIDDEN, log), `fontesAutomaticasPci` (engenheiro da obra,
  projeto cancelado ignorado, motivos), abertura com relatório, `sugestoesAutomaticasDaObraPci`, CRUD/versões dos modelos
  (recusa de dado pessoal, nome único nas versões, autor original, obra de origem só para admin); procedimentos
  `engenheiro`, `sugestoesAutomaticas`, `modelosPreenchimento`, `modeloPreenchimento`, `historicoModeloPreenchimento`,
  `salvarModeloPreenchimento`, `excluirModeloPreenchimento`; `obter.preenchimento`.
- `client/src/components/obra/GeradorPciAba.tsx` — seletor com busca do perfil e confirmação, "Mesmo profissional do RTP",
  painel do resultado (escolha da pessoa inteira por rádio; campos técnicos por caixa), aviso de mistura com
  "Confirmo que nome e CPF são da mesma pessoa" e botão de gerar bloqueado, procedência "manual" ao digitar, painel de
  modelos.
- `drizzle/0118_pci_modelos_preenchimento.sql` (novo; portão 2: `substituido` + índice único parcial do nome),
  `drizzle/schema.ts` (`pciModelosPreenchimento`, `substituido`).
- Portão 2: `shared/pci-gerador.ts` — `provaMesmaPessoaPci`, `divergenciasPessoaPci`, `ORIGEM_CONFIRMADA_PCI`,
  `marcaPessoaPci`, `confirmacoes`, `registrarConfirmacoesPci`, `conferirProcedenciaPci`, `MisturaPessoaPci.motivo`,
  `achadosPessoaisNoTextoPci`, `mascararMeioPci`, `avisosEmpresaNoModeloPci`; `server/pci-gerador.ts` —
  `conferirProcedenciaNoServidor`, `registrarConfirmacoes`, CTE da nova versão, `violacaoUnica`, `avisos` ao salvar modelo.
- `server/pci-s09.test.ts` (novo), `server/pci-s09-db.test.ts` (novo), `server/pci-gerador.test.ts` (matriz de
  permissões; proponente divergente fica para escolha), `server/pci-gerador-db.test.ts` (coluna `lead_service_id`;
  abertura com escolha do proponente).

## QA Results

### Portão 1 — 16/11/2026 — FAIL (@qa, sonda `qa-s09/probe.mts`)
Problema central: a regra "pessoa não se mistura" estava quebrada — o CPF de uma pessoa podia cair ao lado do nome de
outra na PCI oficial.

| # | Sev. | Achado | Correção (@dev) | Teste |
|---|------|--------|-----------------|-------|
| 1 | HIGH | Proponente não era de fonte única (MARIA da PCI + CPF do JOSE do CRM) | Bloco por pessoa; outra fonte só completa com prova de mesma pessoa (engenheiro/CPF/nome completo); senão escolha da pessoa inteira | `pci-s09.test.ts` "QA 1", "mesma pessoa provada"; `pci-gerador-db.test.ts` abertura |
| 2 | HIGH | Nome digitado + fonte só com CPF → CPF em silêncio | Tela com qualquer dado da pessoa e fonte sem prova → nada em silêncio, pessoa inteira para escolha | "QA 2" |
| 3 | HIGH | Escolha por campo misturava a pessoa | Rádio por pessoa (manter / trocar a pessoa inteira); `aplicarEscolhasPci` puro ignora campo de pessoa; procedência no rascunho; gerar recusa nome e CPF de fontes diferentes | "nenhuma combinação…" (todas as combinações), "guarda da geração"; DB "gerar recusa…" |
| 4 | MED | CPF de qualquer usuário por id | Só ids da lista do gerador; FORBIDDEN; log só com ids | DB "só quem a lista oferece", "a leitura é registrada" |
| 5 | MED | Dado pessoal em texto livre do modelo; obra de origem exposta | Recusa com a lista dos campos (CPF/CNPJ/e-mail/telefone); lista só com opção oficial; obra de origem só para admin | `pci-s09.test.ts` "detecta…", "modelo com dado pessoal…"; DB "texto livre…", "salva só o técnico…" |
| 6 | MED | Quem acrescentou versão apagava o modelo; versão tomava nome de outro | Autor original ou admin; nome único também na versão | DB "exclusão lógica…", "nova versão…" |
| 7 | LOW | Projeto cancelado inferia engenheiro; abertura sem fonte | `status <> 'cancelado'`; `obter.preenchimento` com o relatório | DB "projeto cancelado…", "abertura sem rascunho…" |
| 8 | LOW | Perfil inativo dito como "sem CPF" | Motivo "perfil … desativado" | "perfil desativado: o motivo diz…"; DB "perfil desativado ou ausente" |
| 9 | LOW | Dono da tabela no Neon (RLS sem políticas) | Nota no Handoff | — |

Limitações declaradas (portão 1; a do rascunho antigo foi resolvida no portão 2, M2): rascunho antigo sem procedência não é bloqueado na geração; nome de pessoa em texto livre sem
documento não é detectado; admin com perfil de Engenheiro ativo está na lista (regra existente) e tem o CPF legível.

### Portão 2 — 16/11/2026 — CONCERNS (@qa, sondas `qa-s09b/probe.mts`, `probe2.mts`, `probe3.mts`)
Os HIGH do portão 1 foram confirmados como corrigidos. Seis itens novos/residuais, corrigidos antes de publicar
(registro desta seção a pedido do @qa; a decisão final é do próximo portão):

| # | Sev. | Achado | Correção (@dev) | Teste |
|---|------|--------|-----------------|-------|
| M1 | MED | Homônimo: bloco sem CPF herdava o CPF de outra fonte só pelo nome (PCI JOSE DA SILVA + CRM José da Silva com CPF, e-mail e telefone diferentes descartados em silêncio; procedência `pci+crm` cegava a guarda). Idem com nome digitado | `provaMesmaPessoaPci` diz COMO se provou; nome sozinho só junta se nenhum campo presente nos dois lados diverge (normalizado) e a junção não acrescenta CPF; senão a pessoa vai para escolha com as duas opções; sem divergência, também a junção rotulada "nome igual nas duas fontes; confira se é a mesma pessoa", que vale como confirmação. Mesma pessoa por CPF/engenheiro com valor diferente → aviso | `pci-s09.test.ts` "portão 2, M1" (4 casos) + "e-mail que não entrou vira aviso"; DB "RTE do rascunho…" |
| M2 | MED | Rascunho antigo (sem procedência) nunca conferido | `misturaPessoaPci`: nome e CPF sem procedência → `motivo: "legado"`, mensagem "rascunho anterior à conferência de origem", mesmo bloco/botão de confirmação, uma vez por pessoa (a confirmação viaja no rascunho). Também fecha "nome antigo + CPF digitado" e "procedência do CPF omitida" | "portão 2 … M2" |
| L3 | LOW | Guarda confiava na procedência do navegador | `conferirProcedenciaPci` (puro) + `conferirProcedenciaNoServidor` em `gerar`: "engenheiro:N", "crm", "pci" (e junções) só ficam se o valor for igual ao da fonte hoje; senão (ou origem desconhecida) → `manual`; log `pci.procedencia_rebaixada` só com chaves/ids. Só consulta as fontes quando o formulário cita uma | "portão 2 … L3"; DB "procedência forjada…" |
| L4 | LOW | Confirmação só como `manual:confirmado` | `FormularioPci.confirmacoes[pessoa] = { por, em, marca }`; o servidor (salvar e gerar) grava usuário e hora e ignora "por" vindo do navegador; a mesma confirmação (mesma marca de nome+CPF) não é registrada de novo; log `pci.pessoa_confirmada` só com ids. Vai no rascunho e no `pci_generated.form_data` | "portão 2 … L4"; DB "confirmação gravada…" |
| L5 | LOW | Detector de dado pessoal: falsos negativos/positivos; CNPJ bloqueava; mensagem sem trecho | `achadosPessoaisNoTextoPci`: CPF com espaços (só logo após "CPF"), traços; telefone só com sinal (tel/fone/cel/whats, DDD entre parênteses, +55, celular 9+8 com separador, fixo com separadores); "(arroba)", "[at]"; número técnico corrido (ART, lote) não é telefone; CNPJ só aviso (`avisosEmpresaNoModeloPci`, devolvido em `avisos` e mostrado na tela); a recusa cita o trecho com o meio mascarado | "portão 2, L5" (3 casos); DB "texto livre…" (mensagem com trecho, CNPJ salva com aviso) |
| L6 | LOW | Nome único só no código | 0118: coluna `substituido` + índice único parcial `lower(nome) WHERE deleted_at IS NULL AND NOT substituido` (idempotente); nova versão marca a anterior na MESMA instrução (CTE); violação 23505 → mensagem amigável | DB "portão 2, L6" (corrida real de dois salvamentos cai no índice; nova versão com o mesmo nome passa; excluído libera o nome) |

Comportamento que mudou de propósito (L5): telefone de 10–11 dígitos corrido, sem nenhum sinal de telefone
("41999990000"), deixa de ser bloqueado — é indistinguível de ART/lote; fixo com separadores ("41 3333 4444") continua.
Antes/depois das sondas: `qa-s09b/*.before.txt` e `*.after.txt` (pasta do QA).

Limitações que ficam: nome de pessoa em texto livre sem documento não é detectado; a confirmação é uma afirmação de quem
usa a tela (registrada com autor e hora, não verificável); o merge de procedência no servidor confere só o que as fontes
de hoje têm (fonte que mudou depois do preenchimento rebaixa para "manual" e pode pedir nova confirmação).

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada (YOLO, regra de execução contínua do EPIC-024) — Draft → InProgress |
| 16/11/2026 | @dev (Dex) | InProgress → InReview: A, B e C implementados; 23 testes novos; tsc e vite build ok; 0118 não aplicada |
| 16/11/2026 | @qa (Quinn) | Portão 1: FAIL (pessoa misturada; acesso ao CPF; dado pessoal no modelo; dono do modelo) — InReview → InProgress |
| 16/11/2026 | @dev (Dex) | Correções dos 9 itens do portão; 94 testes; tsc e vite build ok — InProgress → InReview |
| 16/11/2026 | @dev (Dex) | Correções do portão 2 (M1, M2, L3–L6); 107 testes; tsc, vite build e imports-esm ok; 0118 editada (ainda não aplicada) |
