# S-8 — Alíquota do Simples calculada pelo sistema

**Status:** InReview · **Epic:** EPIC-029 · **Etapa:** 8 · **Tamanho:** M · **Migração:** `0168_fiscal_folha_fator_r.sql` (aditiva; NÃO aplicada no banco nesta entrega)
**Depende de:** S-4 (DPS), `ALIQUOTAS.md` §3 e §4 (tabelas e enquadramento), decisão do dono de 22/11 (noite), item 3:
"alíquota do Simples calculada pelo sistema (RBT12 dos 12 meses anteriores × anexo de cada tipo de serviço, LC 123), e não
um número fixo". Substituição prevista: a apuração de receita por empresa da S-6 (`server/fiscal/teto.ts`), quando chegar à `main`.

## Problema
A DPS do emissor do Simples levava a alíquota de ISS digitada no tipo de serviço (número fixo). No Simples, a alíquota muda
todo mês: depende da receita bruta dos 12 meses anteriores (RBT12), do anexo da atividade (III, IV ou V) e, nos serviços do
Fator R, da folha de salários. O número fixo erra para cima ou para baixo e não mostra de onde veio.

## Escopo (IN)
1. **Módulo puro `shared/fiscal/simples.ts`**: tabelas dos Anexos III, IV e V por período de vigência (a atual — LC 123 com a
   redação da LC 155/2016, 01/01/2018 a 31/12/2026; a de 2027 em diante fica como lacuna explícita, sem números inventados);
   `aliquotaEfetiva(rbt12, anexo)`, `parteDoIss(rbt12, anexo)` (teto de 5% do ISS na 5ª faixa, com a diferença redistribuída
   aos tributos federais pelos percentuais da lei), `rbt12Proporcional` (empresa com menos de 12 meses — art. 18, §2º),
   `fatorR` e `anexoDoServico` (cAtvSN 7/8/12 → III; 13/14 → IV; 9 → III se r ≥ 28%, senão V).
2. **Servidor `server/fiscal/simples.ts`**: RBT12 da empresa (raiz do CNPJ: matriz + filiais) na competência da nota.
   `receitaDoPeriodo(raiz, de, ate)` com implementação mínima (notas EMITIDAS + receitas do BPO nas contas da empresa, quando
   a coluna de conta por empresa existir); a S-6 substitui. Folha dos 12 meses informada pelo admin em "Dados fiscais do perfil".
3. **Rascunho/DPS**: para emissor do Simples, a DPS leva em `pAliq` a parte do ISS calculada (não o número fixo do tipo);
   a tela do rascunho mostra "como foi calculada" (RBT12, anexo, faixa, alíquota nominal, parcela a deduzir, efetiva, ISS,
   Fator R e as fontes da receita). Regime diferente de Simples ("a confirmar", Presumido, Real, desconhecido) não calcula.

## Fora do escopo (OUT)
- Gravar `fiscal_tipos_servico.codigo_atividade_simples` por migração (o dono grava na tela — quadro abaixo).
- Tabelas de 2027 (LC 214/2025): lacuna até a próxima pesquisa ler o texto oficial.
- `pTotTribSN` (total aproximado de tributos do Simples, FAQ 20.5): o leiaute tem `indTotTrib` × `pTotTribSN` como escolha;
  continua `indTotTrib` do contador até a posição ser conferida no XSD.
- Paridade com o Grupo Santa Fé (o dono decide depois — pendência no ROADMAP, regra do EPIC-029).

## Valores do cAtvSN por tipo de serviço (quadro do ALIQUOTAS.md §5 — o dono grava na tela "Tipos de serviço")
| Tipo de serviço | cAtvSN | Anexo |
|---|---|---|
| Assessoria / BPO (17.12) | **9** | V, ou III se r ≥ 28% |
| Recebimento de obra / empreitada (7.02) | **13** | IV (CPP fora do DAS) |
| Regularização e despachante (17.01) | **9** | V, ou III se r ≥ 28% |
| Avaliação de imóvel (28.01) | **9** | V, ou III se r ≥ 28% |
| Comissão de correspondente (17.01) | **9** | V, ou III se r ≥ 28% (alguns citam III direto — vale o PGDAS-D do contador) |

## Regras de cálculo (documentadas no código)
- **RBT12** = receita bruta dos 12 meses anteriores ao mês da competência da nota (art. 18, §1º), somando matriz e filiais
  (mesma raiz de 8 dígitos). Mesmo RBT12 para todos os anexos (art. 18, §3º/§4º).
- **Alíquota efetiva** = (RBT12 × nominal − parcela a deduzir) ÷ RBT12 (§1º-A). RBT12 = 0 → nominal da 1ª faixa.
- **Parte de cada tributo** = efetiva × repartição da faixa (§1º-B). **Teto do ISS**: na 5ª faixa dos Anexos III e IV, o ISS
  efetivo é no máximo 5%; o excedente vai aos federais pelos percentuais da lei (III: IRPJ 6,02 / CSLL 5,26 / Cofins 19,28 /
  PIS 4,18 / CPP 65,26; IV: IRPJ 31,33 / CSLL 32,00 / Cofins 30,13 / PIS 6,54).
- **6ª faixa** (RBT12 > R$ 3,6 milhões): ISS fora do DAS — a DPS volta a usar a alíquota municipal do tipo de serviço.
  **Acima de R$ 4,8 milhões**: fora do limite do Simples — não calcula (o contador decide).
- **Arredondamento**: as contas são feitas em frações exatas (inteiros), e só o resultado é arredondado para 4 casas
  percentuais (0,0001%), meio para cima. A parte do ISS sai da efetiva EXATA, não da efetiva arredondada. Valor em reais
  (`centavosDaAliquota`): valor × alíquota de 4 casas, arredondado ao centavo, meio para cima.
- **Empresa com menos de 12 meses** (art. 18, §2º; Res. CGSN 140/2018, art. 22 — [NÃO CONFIRMADO no texto oficial nesta
  sessão]): 1º mês → receita do próprio mês × 12; do 2º ao 12º → média dos meses anteriores × 12. Precisa da data de início
  de atividade (campo novo em "Dados fiscais do perfil"); sem a data, a empresa é tratada como tendo 12 meses ou mais e a tela avisa.
- **Sublimite do ISS (portão de QA, M3 — conferir com o contador, não bloqueia):** o ISS sai do DAS pela receita do
  ANO-CALENDÁRIO, não pelo RBT12 (LC 123, arts. 13-A, 19 e 20; Res. CGSN 140/2018, arts. 9º a 13; ALIQUOTAS.md §3.1-A). Ano anterior
  acima de R$ 3,6 mi → ISS fora no ano todo; ano em curso acima em mais de 20% → fora a partir do mês seguinte ao excesso; até 20%
  → continua no DAS e o efeito fica para o ano seguinte (aviso). Ano de início: limite proporcional (R$ 300 mil × meses). RBT12 na
  6ª faixa sem excesso → ISS no DAS pela fórmula da 5ª faixa, com teto de 5%. Com o ISS fora do DAS, o `pAliq` é a alíquota municipal.
- **Receita bruta (M1):** só honorário e receita do BPO; reembolso de despesa não é receita bruta (LC 123, art. 3º §1º).
- **`pAliq` com 2 casas** (`CASAS_PALIQ`, meio para cima): os percentuais do leiaute nacional são de 2 casas (TSDec1V2) —
  [NÃO CONFIRMADO: o XSD não está no repositório]. Vale também para a alíquota municipal.
- **Fator R** = folha dos 12 meses ÷ RBT12 (§5º-J, §24). r ≥ 28% → III; r < 28% → V. Com menos de 12 meses: folha dos meses
  anteriores ÷ receita dos mesmos meses. **Folha não informada, desatualizada (o mês final não é o anterior à competência)
  ou RBT12 = 0 → "a informar" e o cAtvSN 9 usa o Anexo V**, o lado de pagar mais (nunca subestimar o imposto em silêncio).
  A tela mostra o motivo. Com a receita incompleta, um r ≥ 28% também cai no Anexo V (o r pode estar acima do real).
- **Folha só para o admin (M2):** colaborador vê a situação (informada / a informar / desatualizada) e o anexo, nunca o valor nem o r.
- **Início de atividade (M4):** sem a data, a DPS de `producao` é recusada; em produção restrita, só aviso. Não há dado de folha completo no sistema: a categoria "Pró-labore" do BPO não traz salários, FGTS
  nem CPP (§24), por isso a folha é informada pelo admin.

## Critérios de aceite
1. Os seis exemplos do ALIQUOTAS.md §3.5 dão exatamente os números calculados à mão (efetiva, ISS, IRPJ no teto, Fator R).
2. Competência de 2027 em diante → "tabela do Simples de 2027 ainda não cadastrada" e a DPS do Simples é recusada com essa falta.
3. cAtvSN 9 sem folha → Anexo V com o motivo "folha a informar"; com folha ≥ 28% do RBT12 → Anexo III.
4. Empresa no 1º mês e no 5º mês de atividade → RBT12 proporcional correto.
5. DPS de emissor do Simples: `pAliq` = parte do ISS calculada; sem cálculo → falta "alíquota do Simples"; 6ª faixa → alíquota
   municipal do tipo. Emissor fora do Simples continua com a alíquota do tipo (sem mudança).
6. A tela do rascunho mostra "Alíquota do Simples — como foi calculada" para emissor do Simples; outro regime → "não se aplica".
7. RBT12 soma matriz e filiais (raiz) e não soma outra empresa; nota não emitida não entra.

## Pendências da troca de fonte (junção com a S-6)
- **M5 (portão de QA): dupla contagem nota × BPO.** A fonte mínima tira do BPO o lançamento ligado a uma nota emitida, mas não casa
  nota emitida sem origem no BPO com o mesmo dinheiro entrando no banco por outro lançamento. Resolver ao trocar
  `fonteReceitaMinima` pela apuração da S-6 (que também trata transferências entre contas).
- Sublimite: conferir as regras do §3.1-A do ALIQUOTAS.md com o contador.

## Riscos
- Fonte de receita mínima até a S-6 (sem contas por empresa no banco, o BPO não entra e a tela marca "receita incompleta").
- Posição/formato do `pAliq` para optante ME/EPP [NÃO CONFIRMADO no XSD]: se a Sefin recusar, a mensagem dela volta à tela.
- Tabelas do Simples não abertas no Planalto nesta sessão (confiança alta por várias fontes que somam 100%).

## Tasks
- [x] Story
- [x] `shared/fiscal/simples.ts` + testes com os exemplos do ALIQUOTAS.md
- [x] `server/fiscal/simples.ts` (receita, folha, cálculo da nota) + migração 0168 (não aplicada)
- [x] DPS: `pAliq` do Simples e falta quando não calcula; fixtures da S-4 ajustados
- [x] Tela: "como foi calculada" no rascunho; folha e início de atividade em "Dados fiscais do perfil"
- [x] Portão de QA (@qa): CONCERNS — M1 a M4 e os dois baixos corrigidos; M5 fica para a junção com a S-6
- [ ] Aplicar a 0168 no Neon (lead, após QA)

## File List
- `docs/stories/epics/epic-029-modulo-fiscal/S-8-aliquota-simples.md` (novo) · `ALIQUOTAS.md` (§3.1-A, sublimite)
- `shared/fiscal/simples.ts` (novo) · `server/fiscal/simples.test.ts` (novo — o vitest só lê `server/**`)
- `server/fiscal/simples.ts` (novo) · `server/fiscal/simples-servidor.test.ts` (novo)
- `drizzle/0168_fiscal_folha_fator_r.sql` (novo — tabela `fiscal_dados_simples`, por raiz do CNPJ) · `drizzle/schema-fiscal.ts`
- `shared/fiscal/dps-campos.ts` · `server/fiscal/dps.ts` · `server/fiscal/router.ts` · `server/fiscal/previa-pdf.ts`
- `server/fiscal/emissao-fundacao.test.ts` · `server/fiscal/emissao-qa.test.ts` (fixture com a alíquota do Simples)
- `client/src/components/fiscal/AliquotaSimples.tsx` (novo) · `client/src/components/fiscal/NotasADecidir.tsx` · `client/src/components/fiscal/DadosFiscaisDoPerfil.tsx`

## Dev Notes (IDS e decisões)
- **IDS**: REUSE de `detalhar`/`carregarNota`/`cnpjLimpo` (notas.ts) para o valor das notas emitidas; ADAPT de `faltasDps`/`serializarDps`
  (campo opcional `aliquotaSimples`); CREATE de `shared/fiscal/simples.ts` (não havia cálculo do Simples no repositório) e de
  `server/fiscal/simples.ts` (a apuração da S-6 ainda não está na `main`: `server/fiscal/teto.ts` só existe na branch `epic029-s6` e soma o
  ANO, não os 12 meses — a interface `FonteReceita.receitaDoPeriodo(raiz, de, ate)` fica pronta para ela).
- [AUTO-DECISION] Onde guardar a folha → tabela nova `fiscal_dados_simples` por RAIZ do CNPJ (0168), editada em "Dados fiscais do perfil"
  (razão: o Fator R é da empresa, matriz + filiais; coluna nova em `tax_profiles`/`fiscal_emissores` quebraria os testes que leem essas
  tabelas sem a 0168 e se perderia a cada nova versão do perfil; a leitura tem guarda `to_regclass` — sem a migração, "a informar").
- [AUTO-DECISION] Folha "válida" só quando o último mês incluído é o anterior à competência da nota (razão: o Fator R é do mês; folha
  velha cai no Anexo V, nunca subestima).
- [AUTO-DECISION] Receita incompleta (sem conta por empresa) não bloqueia a produção restrita, mas bloqueia `producao` na DPS (razão:
  homologação não tem valor fiscal; produção só depois da S-6).
- [AUTO-DECISION] cAtvSN 8 e 14 aceitos no módulo puro (documentados no ALIQUOTAS.md §4), embora o CHECK da 0162 ainda só aceite 7/9/12/13.
- Folha no sistema: só existe a categoria "Pró-labore" do BPO (shared/financeiro/bpo-operacional.ts) — sem salários, FGTS e CPP (§24); não serve.

## Testes executados
- (a) Automáticos (após o portão de QA): `simples.test.ts` 33/33, `simples-servidor.test.ts` 21/21, `s8-qa.test.ts` 41/41 (os 3
  `it.fails` viraram `it`). Primeira rodada: `simples.test.ts` 28/28; `simples-servidor.test.ts` 15/15; regressão
  `emissao-fundacao` 27/27, `emissao-qa` 13/13, `rascunhos` 34/34, `rascunhos-qa` 12/12, `certificado` 17/17, `notas-recebidas` 25/25,
  `notas-recebidas-qa` 27/27. `npx tsc --noEmit` limpo; `npx vite build` ok.
- (b) Manuais: nenhum (tela conferida só pelo typecheck/build).
- (c) Pendentes em produção: aplicar a 0168 no Neon; gravar os cAtvSN dos tipos (quadro acima); informar folha e início de atividade.

## Change Log
- 22/11/2026 — @dev (Dex): story criada (Ready → InProgress) a partir da ordem do lead; implementação.
- 23/11/2026 — @dev (Dex): implementação concluída, InProgress → InReview (aguarda o portão de QA).
- 23/11/2026 — @dev (Dex): correções do portão de QA (CONCERNS): M1 receita bruta, M2 folha só para o admin, M3 sublimite pelo
  ano-calendário, M4 início de atividade na produção, pAliq com 2 casas e Fator R com receita incompleta no Anexo V. M5 pendente (S-6).
