# S-5 — Produção e notas recebidas

**Status:** InProgress (parte 1 pronta — recebidas, sem depender do dono; aguarda QA) · **Epic:** EPIC-029 · **Etapa:** 5 · **Tamanho:** L · **Migração:** `0163_obra_notas_origem_adn.sql` (o número 0157 do plano foi trocado: 0161 = S-3, 0162 = S-4)
**Depende de:** S-4 aprovada (10 notas de teste) e da ordem do dono para virar cada emissor para produção.

## Escopo
1. **Produção**: o admin (dono) muda `ambiente` do emissor para `producao` na tela, com confirmação digitada ("EMITIR EM
   PRODUÇÃO"). Botão **Emitir** liberado na tela e a ação séria `emitir_nota_fiscal` da Dolores passa a executar — **só o
   dono** (número do dono na Dolores; papel admin + usuário do dono na tela).
2. **XML e PDF no card do cliente**: a nota emitida aparece em `AdminLeadDetail.tsx` (e na obra), com download do XML e do
   DANFSe; arquivo guardado como documento privado (mesmo padrão dos documentos do card) e, se ligado, no Drive da pasta do
   cliente.
3. **Notas recebidas pelo ADN** (decisão g): `server/fiscal/distribuicao.ts` busca por NSU (`GET {adn}/contribuintes/DFe/{NSU}`
   [NÃO CONFIRMADO]) as NFS-e em que os CNPJs do grupo são **tomadores**, com o certificado do emissor (mesma raiz).
   Grava em **`obra_notas`** com `origem = 'adn'`: emitente (CNPJ), número, data, valor, chave (50), XML. Vínculo à obra e ao
   empreiteiro por código: CNPJ do emitente = `users.cnpj` de empreiteiro de uma obra ativa **e** (quando houver) CNO/endereço
   da obra no XML; ambíguo → sem vínculo, a Dolores pergunta ao dono. Roda dentro dos crons já existentes, com prazo e
   `ultimo_nsu` guardado por emissor (sem cron novo).
4. A conciliação com o BPO e o aviso `nota_obra` (divergência, sem confirmação) passam a incluir as notas do ADN sem mudança
   de regra (`server/dolores/leitura/notas.ts`, `server/dolores/avisos.ts`).

## Migração 0157 (aditiva — exige QA)
- `obra_notas ADD COLUMN IF NOT EXISTS origem varchar(10) NOT NULL DEFAULT 'grupo' CHECK (origem IN ('grupo','adn'))`,
  `nsu bigint`, `xml text`, `emissor_id integer`; índice único `(chave_acesso)` parcial para `origem='adn'`.
- `ALTER COLUMN grupo_id DROP NOT NULL`, `ALTER COLUMN mensagem_id DROP NOT NULL` + CHECK `origem <> 'grupo' OR (grupo_id IS
  NOT NULL AND mensagem_id IS NOT NULL)` (linhas antigas continuam obrigadas).
- CHECK de `chave_acesso`: `^[0-9]{44}$|^[0-9]{50}$`; CHECK de `emitente_documento`: aceita CNPJ alfanumérico.
- Gatilho `obra_notas_guarda` revisto só para tratar `origem` como imutável. Nenhum dado existente muda.
- `fiscal_distribuicao_estado` (emissor, ultimo_nsu, ultima_consulta_em).

## Critérios de aceite
1. Emitir em produção sem a confirmação digitada → recusado; por outro admin que não o dono → recusado.
2. Nota emitida aparece no card do cliente com XML e PDF baixáveis.
3. Distribuição com servidor falso: 120 documentos em 3 páginas → 120 linhas, rodar de novo → zero novas (NSU + chave única).
4. Nota do ADN de empreiteiro com obra única → vinculada; com duas obras possíveis → sem vínculo e aviso ao dono.
5. Linhas antigas de `obra_notas` continuam exigindo grupo e mensagem (teste no banco).
6. A conciliação aponta divergência entre nota do ADN e pagamento do BPO (mesma regra das notas de grupo).
7. Regra `automatico` **não existe** (decisão h): CHECK de `fiscal_tipos_servico.regra` continua sem esse valor.

## Dependências do dono
Ordem para virar cada emissor para produção; conferência do contador.

## Riscos
R1/R2/R3 (mudanças de CHECK e NOT NULL em `obra_notas` — portão de QA obrigatório); limite de chamadas do ADN [NÃO CONFIRMADO].

---

## Parte 1 — NFS-e recebidas (feita em 22/11/2026, sem depender do dono) — Dev (Dex)

Escopo desta parte: itens 3 e 4 do Escopo acima, **preparados e desligados**. Os itens 1 e 2 (produção e XML/PDF no card)
continuam pendentes (dependem da S-4 e do dono). Nada foi aplicado em banco nenhum; nada foi publicado.

### O que foi feito
1. **Migração `drizzle/0163_obra_notas_origem_adn.sql`** (só aditiva, idempotente; testada 2× no PGlite):
   - colunas novas em `obra_notas`: `origem` (`'grupo'` padrão — todas as linhas existentes — ou `'adn'`), `chave_nfse`
     varchar(50), `nsu` bigint, `emitente_cnpj_alfa` varchar(14). `chave_acesso` (44, NF-e) e `emitente_documento` (só números)
     **não mudaram**;
   - **única troca de regra existente:** `grupo_id`/`mensagem_id` perdem o NOT NULL da coluna, mas a MESMA exigência continua para
     a origem antiga pelo CHECK `obra_notas_grupo_exige_mensagem_ck` (`origem <> 'grupo' OR (grupo_id IS NOT NULL AND
     mensagem_id IS NOT NULL)`), criado ANTES do `DROP NOT NULL` (sem janela). Inevitável: a nota do ADN não tem grupo nem
     mensagem, e a decisão (g) proíbe tabela paralela;
   - CHECKs novos: `obra_notas_origem_ck`, `obra_notas_adn_ck` (adn = sem grupo/mensagem/arquivo, `tipo = 'nfse'`, com chave e
     NSU), `obra_notas_chave_nfse_ck` (`^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$`, padrão do XSD oficial — a inscrição pode ter letras;
     ajuste pedido pela pesquisa de 22/11), `obra_notas_nsu_ck`, `obra_notas_cnpj_alfa_ck` (só CNPJ com letra; o numérico continua
     na coluna antiga), `obra_notas_um_documento_ck`; índice único parcial `obra_notas_chave_nfse_uidx` (idempotência);
   - gatilho NOVO `obra_notas_guarda_origem` (origem, chave, NSU e CNPJ alfanumérico imutáveis) ao lado do antigo — a função
     `obra_notas_guarda` da 0128 **não foi tocada**;
   - tabela-filha `obra_notas_adn` (XML original, SHA-256, CNPJ tomador; só inserção; só aceita nota `'adn'`), para as leituras
     da Dolores e da tela não carregarem o XML;
   - `fiscal_distribuicao_estado` (um por CNPJ tomador): `ligada` (false por padrão), `ultimo_nsu` (nunca volta — gatilho),
     `ultima_consulta_em`, `ultima_consulta_vazia_em` (regra do ADN: 1 h de espera depois de consulta sem novidade), resultado e
     contagem. Não apaga.
2. **Validador único de CNPJ** `shared/fiscal/documento.ts` (numérico e alfanumérico, letra = ASCII − 48, exemplo da Receita
   `12.ABC.345/01DE-35` conferido). As 4 cópias passaram a usar o cálculo dele: `shared/contratos/modelos.ts` (já aceitava o
   alfanumérico — mesma regra), `shared/dolores/notas.ts`, `shared/dolores/sanitizar.ts` e `shared/pci-gerador.ts` (continuam
   só numéricos por guarda explícita: coluna numérica das notas de grupo, filtro de texto e memorial — regra igual). CPF não mudou.
   A conciliação passou a manter as letras do CNPJ alfanumérico do fornecedor do BPO (`documentoDoFornecedor`; numérico: igual).
3. **Leitura do XML nacional** `server/fiscal/nfse-recebida.ts` (pura, fixture `server/fiscal/fixtures/nfse-nacional-recebida.xml`):
   chave, número, datas, emitente, tomador, vServ/vLiq, descrição; recusa DOCTYPE/ENTITY, XML > 300 000 caracteres e nota de
   produção restrita; só grava nota em que a empresa é TOMADORA (a distribuição também traz as emitidas). Nome e descrição pelo
   mesmo filtro das notas de grupo (`textoLido`: dado bancário nunca). Vínculo por código: CPF/CNPJ do emitente = documento do
   empreiteiro (`users.cpf`, a mesma conferência das notas de grupo) de obra não encerrada; uma obra → vinculada; mais de uma →
   só o empreiteiro, sem obra, com a dúvida "diga a qual obra"; documento em dois usuários → nada. Duplicidade igual à das notas
   de grupo (mesmo emitente + número → `duplicada_de`, não concilia de novo).
4. **Captura por NSU** `server/fiscal/distribuicao.ts`, DESLIGADA: interface `ClienteDistribuicaoAdn` injetada por
   `registrarClienteDistribuicao` (a S-4 registra o cliente mTLS; sem ele, nem banco nem rede); só CNPJ com `ligada = true`;
   páginas de até 50, NSU gravado por página, espera de 1 h depois de consulta vazia, prazo por chamada e total; erro registra
   `erro` e não avança o NSU. Roda no cron diário que já existe (`/api/cron/lead-card-due`, `api/index.ts`, no máximo 10 s,
   depois dos rascunhos) — nenhum cron novo. Nomes de campos JSON que só vêm de terceiros (`nfseXmlGZipB64`,
   `eventoXmlGZipB64`, `lote`, `cnpjConsulta`) isolados em `NOMES_ADN_TERCEIROS`; GZip+Base64 em `xmlDoArquivoAdn`.
5. **Conciliação/avisos reaproveitados, sem regra nova:** `notasDoBanco` usa `leftJoin` com a mensagem (nota de grupo tem sempre
   — mesmo resultado de antes); `paraConciliar` usa o CNPJ alfanumérico quando houver; o aviso `nota_obra` de **divergência** já
   inclui a nota do ADN; o de "sem confirmação do empreiteiro", a ronda e o texto sugerido ao empreiteiro ficam só para a origem
   `'grupo'`; "salvar no Drive" recusa nota do ADN (não há arquivo do WhatsApp). Nenhum lançamento é criado, ligado ou alterado.

### Decisões autônomas
- [AUTO-DECISION] Valor da origem antiga → `'grupo'` (texto da story) e não `'whatsapp'` (exemplo do pedido). Motivo: a story e o
  comentário da 0128 falam em "nota de grupo".
- [AUTO-DECISION] Colunas novas em vez de alargar `chave_acesso`/`emitente_documento` → mantém as regras da origem antiga intactas.
- [AUTO-DECISION] XML em tabela-filha → as listagens (até 500 notas) não carregam XML.
- [AUTO-DECISION] Sem `users.cnpj` (não existe): o vínculo usa o documento do empreiteiro em `users.cpf`, como as notas de grupo.
- [AUTO-DECISION] Tipo de aviso próprio para nota recebida → **adiado**; por ora vale o aviso `nota_obra` de divergência.

### Testes
- (a) Automáticos: `server/fiscal/notas-recebidas.test.ts` — 24 testes (migração 2×, regra antiga de grupo, CNPJ alfanumérico,
  parser por fixture, 120 documentos em 3 páginas → 120 notas e de novo → zero, espera de 1 h, idempotência por chave, vínculo
  1 obra/2 obras, duplicidade com nota de grupo, falha do ADN, prazo, captura desligada sem chamar nada, conciliação divergente e
  alfanumérica sem alterar o BPO). Regressão verde: `server/dolores/notas-obra.test.ts` (42), `notas-regras.test.ts` (23),
  `regras.test.ts` (38), `c5-e4-proatividade.test.ts` (28), `qa-e5-provas`, `operacao`, `c5-e2-qa`, `ponte`, `acoes`,
  `correcoes-e3`, `grupos-automaticos`, `grupos-qa-seg-e7`, `c5-mesas`, `c5-memoria-longa`, `c5-e2-qa-r2`, `c5-e2-resolve`,
  `epic027-d-qa`, `c5-e1-qa`, `server/fiscal/rascunhos.test.ts`, `consulta-cadastral*`, `juridico-modelos`, `pci-gerador`,
  `imports-esm`, `auth-session`. `pnpm check` (tsc) e `vite build` verdes. Não há script `lint` no `package.json`.
- (b) Manuais: nenhum.
- (c) Pendentes em produção: aplicar a 0163 no Neon **antes** de publicar (o schema Drizzle já lê as colunas novas — publicar sem
  a migração quebra as leituras de `obra_notas`); conferir campos do XML real do ADN na S-4.

### Pendências (parte 2 e S-4)
- Itens 1 e 2 do Escopo (produção, XML/PDF no card). Cliente mTLS real (S-4) e a tela para ligar a captura por CNPJ.
- Conferir com XML real: `infNFSe/valores/vLiq`, nomes de campos do lote JSON, CNO da obra no XML (`construction_projects.cno`
  não existe ainda: o vínculo por CNO fica para quando existir).
- Obra de nota sem vínculo não pode ser ligada depois (o gatilho da 0128 só deixa `obra_id` virar NULL): precisa de um caminho
  aprovado pelo dono (fila) numa próxima etapa.
- `shared/dolores/sanitizar.ts` continua sem reconhecer CNPJ alfanumérico em texto livre (risco baixo: dado de empresa) — QA da Dolores.

### File List (parte 1)
- `drizzle/0163_obra_notas_origem_adn.sql` (novo), `drizzle/schema-dolores-notas.ts`, `drizzle/schema-fiscal.ts`
- `shared/fiscal/documento.ts` (novo), `shared/contratos/modelos.ts`, `shared/dolores/notas.ts`, `shared/dolores/sanitizar.ts`, `shared/pci-gerador.ts`
- `server/fiscal/nfse-recebida.ts` (novo), `server/fiscal/distribuicao.ts` (novo), `server/fiscal/fixtures/nfse-nacional-recebida.xml` (novo),
  `server/fiscal/notas-recebidas.test.ts` (novo)
- `server/dolores/leitura/notas.ts`, `server/dolores/notas-router.ts`, `server/dolores/avisos.ts`, `server/dolores/rondas.ts`,
  `server/dolores/conciliacao.ts`, `server/dolores/notas-obra.ts`, `server/dolores/testes-banco.ts`, `api/index.ts`

### Correções do portão de QA (CONCERNS, `server/fiscal/notas-recebidas-qa.test.ts`) — 22/11/2026
- **M1** número da NFS-e só entra se for só dígitos (1 a 15, `numeroDaNfse`); senão null + dúvida.
- **M2** prazo real: a chamada ao cliente corre contra o prazo (`Promise.race` + abort) mesmo que ele ignore o sinal; o prazo
  também é conferido entre uma gravação e outra (o resto fica para a próxima rodada, "parcial").
- **M3** duas capturas do mesmo CNPJ: o NSU é gravado com `GREATEST(ultimo_nsu, n)` e a rodada segue do maior — nada volta,
  o gatilho nunca dispara, nenhuma exceção.
- **M4** documento ilegível: a rodada fica "parcial" e o NSU é guardado em `fiscal_distribuicao_estado.nsus_ilegiveis` (jsonb,
  os 20 mais recentes; coluna acrescentada na própria 0163, que ainda não foi aplicada em banco nenhum); o resultado da rotina
  devolve `nsusIlegiveis`. XML sem `tpAmb` também conta como ilegível (não é gravado).
- **B1** marcação HTML retirada de nome e descrição antes do filtro de texto. **B2** XML sem `tpAmb` → não grava.
  **B3** documento em dois empreiteiros ativos (mesmo que só um tenha obra) → nenhum vínculo.
- Os 7 `it.fails` do QA viraram `it` e passam. Merge da `origin/main` (conflito só em `api/index.ts`, cron diário: ficaram
  a captura das recebidas e a retentativa do Jurídico). Testes: `server/fiscal/*` 98/98, `notas-obra` 42, `notas-regras` 23,
  `c5-e4-proatividade` 28, `pci-gerador` 11, `juridico-modelos` 6; `pnpm check` e `vite build` verdes.
- Atenção: a `main` já tem `drizzle/0161_juridico_validacao_assinaturas.sql` — o número 0161 reservado à S-3 colidiu.

## S-5b — correções da revisão independente (PR #315) — 22/11/2026 — Dev (Dex)

A captura do ADN continua **desligada** (sem cliente registrado e sem CNPJ ligado). Estas correções são pré-requisito para ligá-la.
Migração nova `drizzle/0166_obra_notas_cancelamento_e_outra_origem.sql` (só aditiva, idempotente, **não aplicada**; aplicar
ANTES de publicar este código — o esquema passa a ler as colunas novas de `obra_notas`).

### O que mudou, por achado
1. **MÉDIO — cancelamento perdido.** Documento cuja raiz não é `NFSe` vai ao leitor novo `lerEventoNfse`
   (`server/fiscal/nfse-recebida.ts`; mesmas proteções: sem DOCTYPE/ENTITY, teto de 300 000, XML malformado, `tpAmb`; `Id` do
   pedido/evento conferido com a chave e o tipo). Cancelamento (101101, 105102, 105104, 305101 — PESQUISA.md §1.5) é guardado em
   `obra_notas_eventos_adn` e marca `obra_notas.cancelada_em/cancelamento_tipo` na nota daquela chave **e na mesma nota da outra
   origem**; se a nota ainda não chegou, o evento fica guardado e ela já nasce cancelada (evento casado). Nota cancelada: apontamento
   `cancelada` (nunca "já lançado"), recusada em `conciliar_nota_obra` (preparo e execução aprovada) e bloqueada por gatilho no banco
   para ligar ao BPO; aviso `nota_obra` com a marca nova `cancelada` ao dono (30 dias; inclui a já ligada a pagamento, que não é
   desfeita — o dono confere). Evento de outro tipo ou raiz desconhecida → `a_conferir`: NSU em `fiscal_distribuicao_estado.nsus_a_conferir`
   e rodada "parcial" (nada some em silêncio). Evento de produção restrita → ignorado; sem `tpAmb` ou chave divergente → ilegível.
2. **MÉDIO — origem dupla travava o arquivo.** Duplicada agora é só dentro da MESMA origem (grupo × grupo, ADN × ADN — proteção
   mantida). Mesma nota (emitente + número) por grupo e por ADN → `obra_notas.outra_origem_de` (não `duplicada_de`): a nota de grupo
   pode ir ao Drive (`prepararSalvarNota`), mas só a primeira é conciliada (apontamento `outra_origem`, recusa no preparo e na execução).
   Nos dois sentidos (`gravarNotaRecebida` e `gravarNota` de `server/dolores/notas-obra.ts`). Chave: a nota de grupo só lê a chave de
   44 da NF-e, então o casamento entre origens é por emitente + número.
3. **BAIXO — exceção travava o CNPJ.** O NSU que deu exceção fica em `nsu_com_falha`/`tentativas_nsu_com_falha`; na 3ª tentativa
   (`MAX_TENTATIVAS_POR_NSU`) vai para os ilegíveis e a captura segue.
4. **BAIXO — GZip quebrado = "sem XML".** `xmlDoArquivoAdn` devolve `{ ilegivel: "gzip_invalido" | "grande_demais" }` (nunca null);
   `DocumentoDistribuido.xml` aceita esse valor e ele conta como ilegível. `null` continua sendo "o ADN não mandou XML" (ignorado).
5. **BAIXO — contador da ronda.** `contarNotasDaRonda` (exportada de `server/dolores/rondas.ts`): "sem conciliação" conta também a nota
   do ADN pendente (rascunho/confira, sem BPO); não conta cancelada nem a da outra origem. Texto do relatório: "(inclui as recebidas pelo ADN)".

### Decisões autônomas
- [AUTO-DECISION] Tipos que cancelam → 101101, 105102, 105104, 305101 (reason: os quatro que PESQUISA.md §1.5 lista como cancelamento; o resto vai ao dono).
- [AUTO-DECISION] Caminho do XML do evento → `evento/infEvento/pedRegEvento/infPedReg` ou `pedRegEvento/infPedReg` [NÃO CONFIRMADO com XML real; conferir na S-4].
- [AUTO-DECISION] Cancelamento de nota já conciliada → não desfaz o vínculo (reason: regra do dono de não alterar dado existente); aviso ao dono.
- [AUTO-DECISION] Aviso da cancelada por 30 dias (`DIAS_AVISO_CANCELADA`) (reason: evitar reaviso eterno de algo que o dono já viu).
- [AUTO-DECISION] Evento de tipo desconhecido em lista própria `nsus_a_conferir` (não misturado aos ilegíveis), mesma regra dos 20 mais recentes.

### Testes
- Reprodução na `main` (worktree temporária, teste descartado): evento → "ignorada"; GZip quebrado → null; NSU com exceção → 5 rodadas
  com erro e NSU parado. Achados 2 e 5 reproduzidos pela expectativa antiga de `notas-recebidas.test.ts` (ADN depois do grupo = "duplicada").
- Novo `server/fiscal/notas-recebidas-s5b.test.ts` (15). Ajustados: `notas-recebidas.test.ts` (gzip → ilegível; grupo × ADN = outra
  origem) e `notas-recebidas-qa.test.ts` (aplica a 0166 depois da 0163).
- `server/fiscal/*` 7 arquivos 170/170 (com o novo); `notas-obra` 42, `notas-regras` 23, `acoes` 24, `acoes-whatsapp` 12,
  `c5-e4-proatividade` 28, `operacao-regras` 19; também `operacao`, `operacao-qa-seguranca`, `c4-horario-relatorio`, `c5-integracao2(+qa)`,
  `c5-tarefa-demorada(+qa)`, `qa-c4-c5-prova`, `s3-fiscal(+qa)` 208/208 (não há `rondas*.test`). `npx tsc --noEmit` e `npx vite build` verdes.
- Pendente: aplicar a 0166 no Neon (antes do deploy) e portão de QA.

### File List (S-5b)
- `drizzle/0166_obra_notas_cancelamento_e_outra_origem.sql` (novo), `drizzle/schema-dolores-notas.ts`, `drizzle/schema-fiscal.ts`
- `server/fiscal/nfse-recebida.ts`, `server/fiscal/distribuicao.ts`, `server/fiscal/notas-recebidas-s5b.test.ts` (novo),
  `server/fiscal/notas-recebidas.test.ts`, `server/fiscal/notas-recebidas-qa.test.ts`
- `server/dolores/notas-obra.ts`, `server/dolores/acoes/notas.ts`, `server/dolores/conciliacao.ts`, `server/dolores/leitura/notas.ts`,
  `server/dolores/notas-router.ts`, `server/dolores/avisos.ts`, `server/dolores/rondas.ts`, `server/dolores/testes-banco.ts`
- `shared/dolores/notas.ts`, `shared/dolores/avisos.ts`, `shared/dolores/operacao.ts`, `client/src/components/admin/DoloresNotasCard.tsx`

### S-5b — correções do portão de QA (CONCERNS, `server/fiscal/s5b-qa.test.ts`) — 22/11/2026
- **MÉDIO — valor/data entre origens.** Ao ligar a "mesma nota por outra origem", valor (centavos) e data de emissão são
  comparados (`divergenciasEntreOrigens`, `server/fiscal/nfse-recebida.ts`). Sem divergência, nada muda. Com divergência:
  - ADN depois do grupo (grupo ainda não conciliado): a oficial do ADN fica "confira" com o alerta e passa a ser a conciliada; a
    de grupo ganha `outra_origem_de` → oficial (continua com o arquivo para o Drive). Única troca aceita pelo gatilho da 0166
    (grupo sem vínculo, não conciliado, não duplicado → NFS-e do ADN sem par); qualquer outra continua `OBRA_NOTAS_VINCULO`;
  - ADN depois do grupo já conciliado: a oficial fica "outra origem" + "confira" com o alerta para o dono conferir o pagamento;
  - grupo depois do ADN: a de grupo fica "confira" com o alerta; a conciliação continua na oficial.
  Aviso `nota_obra` novo, marca `origem_divergente`, no id da oficial (30 dias).
- **BAIXO — todos os eventos pendentes da chave** são casados quando a nota chega (antes, `.limit(1)`).
- **BAIXO — evento sem nota há mais de 7 dias** (`DIAS_EVENTO_SEM_NOTA`): um aviso `nota_obra` só com a quantidade (marca
  `evento_sem_nota`) e a lista `cancelamentosDoAdnSemNota` em `listar_notas_obra` (`cancelamentosSemNotaDoAdn`: NSU, tipo e data;
  sem chave, CNPJ nem XML).
- 0166 alterada (ainda não aplicada): só o gatilho `obra_notas_guarda_cancelamento` (exceção acima) e o comentário; continua
  aditiva e idempotente. Os 2 `it.fails` do QA viraram `it`; 7 testes novos em `notas-recebidas-s5b.test.ts`. Ajuste em
  `notas-recebidas.test.ts`: a nota de grupo do teste "sem divergência" ganhou o mesmo valor/data da oficial (sem valor lido
  conta como divergência e a conciliação passa para a oficial).
- Rodada: 19 arquivos, 429/429 (server/fiscal/* com s5b-qa, notas-obra, notas-regras, acoes, acoes-whatsapp, c5-e4-proatividade,
  operacao, operacao-regras, s3-fiscal(+qa), c4-horario-relatorio); tsc e vite build verdes; `origin/main` sem novidade no merge.
