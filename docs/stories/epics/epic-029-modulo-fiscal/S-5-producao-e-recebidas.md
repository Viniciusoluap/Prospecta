# S-5 — Produção e notas recebidas

**Status:** Draft · **Epic:** EPIC-029 · **Etapa:** 5 · **Tamanho:** L · **Migração:** `0157_obra_notas_origem_adn.sql`
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
