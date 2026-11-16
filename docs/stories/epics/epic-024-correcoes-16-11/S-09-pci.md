# S-09 — Gerador de PCI: CPF do engenheiro, "Dados automáticos" e biblioteca de modelos

Status: InProgress
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

## File List
(atualizada ao final)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada (YOLO, regra de execução contínua do EPIC-024) — Draft → InProgress |
