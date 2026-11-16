# S-05 — Maquete: "Importar planta arquitetônica (PDF)" na Revisão da planta

Status: Ready for Review (código, testes e tela; migração 0121 NÃO aplicada em banco real)
Epic: EPIC-024 (Fase 4) — correção 05 do dono (16/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: M/G
Dependência: S-03 (roteamento híbrido por prancha, confirmação e teto da IA).
Migração: `drizzle/0121_maquete_3d_revisoes.sql` (número reservado no EPIC).

## Problema

O dono quer, em Maquete 3D → Revisão da planta, o botão "Importar planta arquitetônica (PDF)" para mandar um projeto
profissional que substitua ou oriente a planta padrão gerada pelo sistema: envio; identificação dos pavimentos;
interpretação dos elementos; prévia da planta original; comparação entre a importada e o desenho interpretado;
edição e confirmação; uso da planta revisada como referência geométrica da maquete; preservação do PDF original e
do histórico das revisões. Hoje `iniciarLeitura` apaga o modelo (`modelo: null`) e não existe histórico (só o contador).

## Critérios de aceite
- [x] AC1: a leitura do PDF importado não apaga o modelo em uso — vira uma planta CANDIDATA guardada à parte
      (`maquetes_3d.importacao`), lida prancha a prancha com o mesmo roteamento híbrido da S-03, os mesmos limites de
      passo e a mesma retomada.
- [x] AC2: tela de comparação lado a lado — planta atual de um lado; candidata sobre a página original do PDF do
      outro, por pavimento, com pendências e avisos do leitor visíveis; a candidata pode ser editada no editor
      existente antes de aplicar.
- [x] AC3: "Aplicar" — a pessoa escolhe o que a candidata substitui: a construção padrão (casa/prédio padrão) ou um
      pavimento de uma construção existente, mantendo as posições da implantação; com a trava otimista de
      `salvarModelo`; permitido em `liberada`, `em_revisao`, `validada` e `publicada` (validada/publicada voltam para
      revisão; a publicada sai do ar — o link nunca muda em silêncio — e só o administrador aplica nela).
- [x] AC4: histórico — tabela `maquete_3d_revisoes` (migração 0121 aditiva e idempotente; schema Drizzle em
      `drizzle/schema-maquete-3d.ts`) com id, maquete_id, versao, modelo, origem, motivo, documento de origem, autor,
      created_at; uma linha a cada mudança do modelo; lista na revisão; restaurar uma versão cria uma revisão nova; o
      PDF original (já guardado) fica ligado à revisão.
- [x] AC5: testes — a importação não toca no modelo até aplicar; aplicar troca só o escolhido e mantém as posições;
      conflito de versão; linhas do histórico para cada tipo de mudança; restauração; publicada volta para revisão;
      permissões (módulo maquete3d, mesmos papéis); migração rodada duas vezes no PGlite.

## Tarefas
- [x] T1: migração `0121_maquete_3d_revisoes.sql` (tabela + coluna `importacao`) e schema Drizzle.
- [x] T2: `shared/maquete-3d/importacao.ts` (novo) — `aplicarCandidata` pura: destino padrão ou pavimento, posições
      mantidas, ids novos sem colisão, escadas religadas, pendências da candidata levadas ao modelo.
- [x] T3: `server/maquete-3d/revisoes.ts` (novo) — `gravarModelo` (trava + revisão), `guardarAnterior`,
      `registrarRevisao`, `listarRevisoes`, `lerRevisao`.
- [x] T4: `server/maquete-3d/importacao.ts` (novo) — iniciar, avançar (prancha / IA / montagem da candidata),
      confirmar/pular a IA, salvar e descartar a candidata, aplicar.
- [x] T5: revisões gravadas também por: leitura (montagem), edição (`salvarModelo`), troca de tipo (`aplicarTipo`),
      implantação do estudo e restauração; "ler de novo do zero" guarda antes a planta que vai apagar.
- [x] T6: router — `importarPlanta` (PDF novo em partes ou um da lista), `avancarImportacao`, `confirmarIAImportacao`
      (só admin), `pularIAImportacao`, `salvarCandidata`, `descartarImportacao`, `aplicarImportacao`, `revisoes`,
      `restaurarRevisao`; `detalhe` com a importação em andamento.
- [x] T7: tela (`client/src/components/maquete-3d/ImportarPlanta.tsx`) — botão na Revisão da planta, comparação lado a
      lado, edição da candidata, destino, motivo, aplicar; histórico com restauração. `EditorPlanta`: fundo ligado de
      início e alinhamento guardado à parte para a candidata.
- [x] T8: testes (`server/maquete-3d-importacao.test.ts`, 8).
- [ ] T9: aplicar a 0121 no Neon e conferir em navegador com um projeto real (fora desta sessão).

## Dev Notes
- [AUTO-DECISION] O PDF importado entra na lista de PDFs do pedido (como o PDF avulso): fica guardado em
  `maquete_3d_arquivos`, serve de fundo pela `pdfParte` e é o "documento de origem" da revisão. Cada pedido aceita
  até 6 PDFs.
- [AUTO-DECISION] A candidata é sempre lida prancha a prancha (também no modo "ia", em que toda prancha com desenho vai
  para a IA). O fluxo antigo por inventário segue só na leitura principal do modo "ia".
- [AUTO-DECISION] Destino "padrão" sem construção padrão: se o modelo não tem construção nenhuma, a importada vira a
  base; se tem construções lidas, a pessoa precisa escolher o pavimento (nunca acrescenta uma segunda construção sem
  pedir).
- [AUTO-DECISION] Num pavimento: ficam id, nome, nível, pé-direito e repetições do pavimento existente; trocam paredes,
  aberturas, cômodos e escadas (a escada passa a levar ao pavimento logo acima). Só as pendências desse pavimento e as
  gerais vão para o modelo.
- [AUTO-DECISION] Maquete publicada: aplicar e restaurar só pelo administrador (é o mesmo poder de "tirar do ar").
- [AUTO-DECISION] Primeira mudança de uma maquete antiga grava antes a planta como estava (origem "anterior"), para
  poder voltar a ela; o mesmo vale para "ler de novo do zero".
- Sem transação interativa (neon-http): o modelo é gravado com `UPDATE … WHERE modelo_versao = versão` e a revisão logo
  depois, com versão única por maquete (`ON CONFLICT DO NOTHING`). Se a gravação da revisão falhar depois do modelo, a
  mudança fica sem linha no histórico e o erro vai para o log (o salvamento não é desfeito nem dado como falho).
- **A 0121 tem de ser aplicada antes de publicar o código:** a coluna `maquetes_3d.importacao` está no schema Drizzle,
  e toda consulta da maquete a seleciona.
- As pranchas do PDF importado passam a ser o fundo dos pavimentos substituídos (em `leitura.parciais.pranchasDosPavimentos`).
  A planta lida pela IA não tem alinhamento automático com o fundo: alinha-se à mão no editor.
- Comparação "por pavimento": cada lado tem as próprias abas de pavimento (não há trava de rolagem entre os dois).

## Testes
- (a) Automáticos: `server/maquete-3d-importacao.test.ts` (8): migração 0121 duas vezes; candidata sem tocar no
  modelo, edição, conflito de versão, aplicar na construção padrão mantendo a posição (x, y, rotação) e o fundo;
  aplicar só num pavimento; restauração; publicada (só admin, sai do ar e volta para revisão; o link mantém a planta
  publicada enquanto a candidata não é aplicada); permissões e situações; PDF importado escaneado pela rota híbrida
  (confirmação gravada na maquete, IA uma vez). Os testes de maquete existentes passaram a rodar a 0121.
- (b) Manuais: não feitos (sem navegador nesta sessão).
- (c) Pendentes em produção: migração 0121 no Neon; importar um projeto profissional real e aplicar.

## File List
- `drizzle/0121_maquete_3d_revisoes.sql` (novo), `drizzle/schema-maquete-3d.ts`
- `shared/maquete-3d/importacao.ts` (novo)
- `server/maquete-3d/revisoes.ts` (novo), `server/maquete-3d/importacao.ts` (novo)
- `server/maquete-3d/leitura.ts` — revisão na montagem; planta guardada antes de ler de novo; `PranchaLida` exportado.
- `server/maquete-3d/router.ts` — rotas da importação e do histórico; `salvarModelo`, `aplicarTipo` e
  `implantacaoDoEstudo` pelo `gravarModelo`; `guardarPdfAvulso`.
- `client/src/components/maquete-3d/ImportarPlanta.tsx` (novo), `client/src/components/maquete-3d/EditorPlanta.tsx`,
  `client/src/pages/admin/AdminMaquete3D.tsx`
- `server/maquete-3d-importacao.test.ts` (novo), `server/maquete-3d.test.ts`, `server/maquete-3d-hibrida.test.ts` (rodam a 0121)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO, regra do EPIC-024 de não parar entre etapas) |
