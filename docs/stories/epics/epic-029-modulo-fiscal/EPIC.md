# EPIC-029 — Módulo Fiscal (NFS-e) + Brasil API

**Status:** Fase 0 concluída (diagnóstico e plano, só leitura). Etapas 1–5 autorizadas pelo dono, em ritmo contínuo.
**Autor do plano:** @architect (Aria), 22/11/2026. **Pedido original:** `prompt-fiscal.md` (Vinicius), Fases 0–5.
**Documentos desta pasta:** `DIAGNOSTICO.md` (onde cada peça encaixa, com arquivo:linha), `PESQUISA.md` (fontes oficiais e o
que NÃO foi confirmado), `S-1` a `S-5` (stories).

---

## 1. Objetivo

1. Preencher cadastros a partir de um CNPJ ou CEP (Brasil API, com ViaCEP como reserva).
2. Gerar **rascunhos** de NFS-e a partir dos recebimentos que o sistema já registra (BPO, obra, regularização, avaliação,
   comissão da empresa).
3. **Nenhuma nota sai sem a aprovação do Vinicius.** Ele vê, edita, emite ou decide não emitir — na tela ou conversando com a
   Dolores.
4. Emitir direto na **API do Sistema Nacional NFS-e** (gratuita), sem intermediário pago.
5. Capturar as notas **recebidas** (empreiteiros e fornecedores) pela distribuição do Ambiente de Dados Nacional (ADN) e
   conciliá-las com o BPO pelas notas de obra da Dolores, que já existem.

## 2. Decisões do dono (22/11/2026) — ajustes à proposta original

| # | Decisão | Como entra no plano |
|---|---------|---------------------|
| a | **Não criar sistema paralelo** | Reaproveita: cadastros (`leads`, `bpo_clients`, `users`, `engineer_profiles`), a aba **"Contabilidade"** do BPO Financeiro (ver k), `tax_profiles` (perfil tributário que já existe), o padrão de histórico imutável (`*_historico`), as notas de obra da Dolores (`obra_notas` + conciliação com o BPO), o padrão mTLS de `server/_core/inter.ts`, o cofre `server/_core/secret-vault.ts`, a geração de PDF com `jspdf` no servidor. |
| b | **Certificado A1 = credencial do painel** | O dono envia o `.pfx` e digita a senha em Configurações › Integrações; o servidor guarda **cifrado** (AES-256-GCM, padrão das chaves do painel). Nunca no repositório, nunca em variável escrita por agente, nunca mostrado de volta, nunca em log. |
| c | **Fluxo do repositório** | Branch `claude/epic029-…` por etapa, migração só aditiva no Neon de produção, portão de QA (@qa), PR, merge e conferência da Vercel. Sem `feature/modulo-fiscal`, sem branch de teste do Neon. |
| d | **Paridade com o Grupo Santa Fé fica para depois** | Pendência registrada em `docs/stories/epics/ROADMAP.md` (seção EPIC-029). A parte da Dolores (S-3) segue a exceção da Dolores, que já existe. |
| e | **Dolores em conversa natural (correção do dono no mesmo dia)** | O dono **não decora comandos** ("quero conversar com ela e que ela me responda como qualquer IA normal"). Nada de VER / EMITIR / NÃO / DEPOIS como palavras fixas. Ele fala em linguagem natural ("me mostra essa nota", "essa não precisa, foi reembolso de cartório", "deixa pra depois"); o modelo escolhe a **leitura** ou a **ação**. Ver a prévia = leitura. Marcar "sem nota", "depois" ou editar = **registro**, que passa pela confirmação natural que já existe (`shared/dolores/confirmacao.ts`: "pode", "sim", "isso", "manda ver"…). **Emitir = ação séria** ("confirmo"), no mesmo mecanismo. Só na conversa direta com o número do dono; nunca em grupo, nunca de cliente. O aviso de rascunho termina com uma pergunta natural, sem lista de comandos. |
| f | **Avisos proativos** | O aviso de rascunho novo e o resumo das 18h entram como **tipo novo** dos avisos proativos (`server/dolores/avisos.ts`, branch `epic027-c5int2`, ainda fora da `main`). Sem cron novo: o resumo das 18h usa a rota `/api/cron/dolores-avisos/18` (21:00 UTC) que aquela branch já cria. |
| g | **Notas recebidas = nova origem em `obra_notas`** | Sem tabela paralela de "notas recebidas". A captura pelo ADN grava em `obra_notas` com `origem = 'adn'`. |
| h | **"Automático depois de 30 notas"** | **Não construir agora.** A regra `automatico` fica fora do CHECK e da tela. |
| i | **Emissor por CNPJ desde o início** | `fiscal_emissores` (um por CNPJ, com certificado, série, ambiente e regime próprios). Toda nota aponta para um emissor. |
| j | **Ritmo contínuo** | Migrando e publicando a cada etapa. A etapa 4 (homologação) depende do dono/contador: o que não depende dele fica pronto antes. |
| k | **Fiscal DENTRO da aba "Contabilidade" do BPO** (decisão do dono, 22/11: "para não termos campos redundantes") | Sem menu novo, sem tela paralela, sem aba "Notas fiscais" à parte: o módulo vira seções da aba Contabilidade (`client/src/pages/admin/TaxAccountingPanel.tsx`, aberta em `AdminBpo.tsx:968`). **Nenhuma informação já cadastrada é digitada de novo**: o emissor sai do perfil tributário (`tax_profiles`: empresa, CNPJ, regime), o tomador sai do cliente do BPO (`bpo_clients`) ou do card do CRM (`leads`), valor/competência/centro de custo saem do lançamento (`bpo_lancamentos`) ou do registro de origem. `fiscal_emissores` guarda **só** o que o perfil tributário não tem (numeração da DPS, ambiente, município, inscrição municipal, certificado). Mapa campo a campo em `DIAGNOSTICO.md` §7.1. |
| l | **"confirmo" para ação séria** | Emitir nota (e, na S-4/S-5, cancelar) é ação séria da Dolores: só com "confirmo", no mecanismo que já existe. Registro (sem nota, depois, editar) aceita a resposta afirmativa natural. |

## 3. Etapas

| Etapa | Story | Entrega | Depende do dono? |
|-------|-------|---------|------------------|
| 1 | `S-1-brasil-api.md` | Serviço de consulta CNPJ/CEP (Brasil API → ViaCEP no CEP), cache de 30 dias no Neon, alerta de CNPJ inativo/baixado/suspenso/inapto/nulo, aplicado nos cadastros que já existem. | Não. Precisa só liberar a rede da Vercel (já é livre). |
| 2 | `S-2-rascunhos.md` | Complemento fiscal do perfil tributário (emissor), tipos de serviço, rascunhos com histórico imutável, geração por varredura idempotente das origens, seções "Notas a decidir", "Tipos de serviço" e "Notas × receita do mês" **dentro da aba Contabilidade** do BPO, prévia PDF com marca d'água, relatório mensal para o contador. Botão "Emitir" desligado. | Não para construir. Os valores dos tipos de serviço (código, alíquota) ficam "a preencher pelo contador". |
| 3 | `S-3-dolores-fiscal.md` | Leituras e ações fiscais da Dolores em conversa natural; aviso de rascunho e resumo das 18h como tipo novo dos avisos; envio do PDF da prévia ao dono. | Não. Ligar o tipo de aviso é decisão dele na tela. |
| 4 | `S-4-homologacao.md` | DPS no leiaute nacional, assinatura XML-DSig com o A1, envio mTLS à produção restrita, consulta, cancelamento (evento 101101), campos IBS/CBS, DANFSe. | **Sim** (regime, certificado, inscrição municipal, códigos e alíquotas, CNO). Tudo o mais fica pronto antes. |
| 5 | `S-5-producao-e-recebidas.md` | Liberar "Emitir" (tela e Dolores, só o dono), XML/PDF no card do cliente, captura das notas recebidas pelo ADN (NSU) para `obra_notas`. | Sim: virar o emissor para produção é ato do dono. |

Ordem obrigatória: 1 → 2 → 3 → 4 → 5. A 3 pode começar assim que a 2 tiver as tabelas (precisa da branch dos avisos na
`main` — ver Riscos R6).

## 4. Critérios de aceite do epic

1. Digitar um CNPJ ou CEP válido preenche os campos sozinho em menos de 2 s quando a Brasil API responde, e em menos de 2 s
   **sempre** que o dado já está no cache; com a Brasil API fora, o CEP vem do ViaCEP; CNPJ que não estiver "ATIVA" mostra
   alerta visível (nunca bloqueia em silêncio).
2. Cada recebimento elegível vira **um único** rascunho `A_DECIDIR` (chave única por origem; a mesma receita registrada no
   BPO e no módulo — ex.: recebimento de regularização ligado a um lançamento do BPO — não vira duas notas).
3. O dono vê, edita, adia e marca "sem nota" (motivo obrigatório da lista); cada mudança grava uma linha de histórico que
   não pode ser alterada nem apagada (gatilho do banco).
4. A prévia em PDF tem a marca d'água "RASCUNHO — SEM VALOR FISCAL" em todas as páginas.
5. O relatório mensal mostra a receita com nota × sem nota, separada por motivo, e exporta CSV.
6. Pela conversa natural com a Dolores o dono consegue ver a prévia, marcar "sem nota" (com motivo), adiar e editar, sempre
   com a confirmação natural; "emitir" pede "confirmo" e, até a etapa 5, responde que a emissão ainda não está ativa.
7. Homologação: 10 notas emitidas e canceladas na produção restrita sem erro, com XML, protocolo e chave de 50 dígitos guardados.
8. Nada fiscal sai do sistema antes da etapa 4; nenhuma nota de produção antes da etapa 5; nenhuma emissão sem o dono.
9. Certificado e senha nunca aparecem em log, erro, auditoria, resposta de API, tela (só titular, CNPJ, validade e impressão
   digital) ou repositório — vigiado por teste, como `server/integracoes-anthropic.test.ts` faz com a chave da Anthropic.

## 5. O que foi descartado e por quê

| Proposta original | Decisão | Motivo |
|-------------------|---------|--------|
| Tabela `fiscal_log` separada | Trocada por `fiscal_notas_historico` (só inserção, gatilho) + `dolores_acoes` para o que vem da Dolores | Mesmo padrão de `bpo_lancamento_historico`, `obra_movimentos_historico` e `regularizacao_recebimentos_historico`. Não é sistema paralelo. |
| Tabela de notas recebidas | Descartada — origem nova em `obra_notas` | Decisão (g). |
| Regra `automatico` dos tipos de serviço | Fora do CHECK e da tela | Decisão (h). |
| Comandos VER / EMITIR / NÃO / DEPOIS | Descartados — conversa natural + confirmação existente | Decisão (e), corrigida pelo dono. Também colidiria com `lerConfirmacao`: "não" sozinho já é a resposta negativa a uma proposta aberta. |
| Rodar a Calculadora de Tributos da Receita dentro do sistema | **Descartado nesta forma** | O motor publicado é uma API REST em **Java 25 / Spring Boot 4** com banco SQLite gerado por Flyway (ver `PESQUISA.md`). Não roda na função Node da Vercel; hospedar Java à parte custa dinheiro e foge do "custo zero". Alternativa: o Sefin Nacional calcula IBS/CBS na emissão e devolve na NFS-e [a confirmar na homologação]; guardar o que voltou como memória de cálculo; prévia opcional pela API pública da Receita se ela existir em produção [NÃO CONFIRMADO]. |
| Data "16/11/2026" da publicação da Calculadora | Não usada como fato | Fontes secundárias divergem (13/11 × 16/11); o repositório oficial não traz a data. |
| Branch `feature/modulo-fiscal` e branch de teste do Neon | Descartadas | Decisão (c). |
| Certificado em variável de ambiente | Descartado | Decisão (b): o dono envia pelo painel; o servidor cifra. |
| Usar o certificado do Jurídico (`client/src/lib/certificados-digitais.ts`) | Descartado para a emissão | Aquele cofre fica no navegador (IndexedDB) e nunca vai ao servidor; o mTLS com o Sefin precisa sair do servidor. A biblioteca de abrir o `.pfx` (P12/pkijs) pode ser reaproveitada. |
| Cron novo às 18h | Descartado | Decisão (f): rota de avisos das 18h que já existe na branch dos avisos. |

## 6. Riscos

| # | Risco | Mitigação |
|---|-------|-----------|
| R1 | **Chave de acesso da NFS-e tem 50 dígitos**; `obra_notas.chave_acesso` é `varchar(44)` com CHECK `^[0-9]{44}$` (0128:43). | S-5 alarga para 44 **ou** 50 (CHECK novo aceita os dois; dado existente intacto). Migração aditiva de CHECK, coberta pela autorização "novos valores de CHECK". |
| R2 | `obra_notas.grupo_id` e `mensagem_id` são `NOT NULL` (0128:26-27); nota capturada pelo ADN não tem grupo nem mensagem. | S-5: `ALTER COLUMN … DROP NOT NULL` + CHECK "se origem = 'grupo', grupo e mensagem obrigatórios". Afrouxa regra, não apaga dado; **precisa de QA** porque o gatilho `obra_notas_guarda` e as leituras supõem grupo. |
| R3 | **CNPJ alfanumérico** (IN RFB 2.229/2024, emissão desde 31/07/2026 segundo a imprensa): os validadores do sistema são só numéricos (`shared/dolores/notas.ts:130`, `shared/dolores/sanitizar.ts:57`, `shared/contratos/modelos.ts:93`, `shared/pci-gerador.ts:1333`) e o CHECK de `obra_notas.emitente_documento` é `^[0-9]{11}|[0-9]{14}$`. | S-1 cria um validador único `shared/fiscal/documento.ts` que aceita os dois formatos; S-5 alarga o CHECK. O filtro de dados pessoais (`sanitizar.ts`) não reconhece CNPJ alfanumérico — avisar o QA da Dolores (CNPJ é dado de empresa; risco baixo). |
| R4 | Node 24 (OpenSSL 3) recusa `.pfx` antigo (RC2/3DES) com "Unsupported PKCS12 PFX data". | Abrir o `.pfx` em JS puro (pkijs, já no projeto; ou node-forge) e passar PEM (`cert`/`key`) ao `https.request`, como `criarFetchMtls` já faz com o Inter (`server/_core/inter.ts:60`). Teste com PFX legado (o Jurídico já tem um). |
| R5 | Cadeia ICP-Brasil não está no repositório de certificados do Node; projetos de terceiros usam `rejectUnauthorized: false`. | **Proibido** desligar a verificação. Embutir as raízes ICP-Brasil (arquivo público do ITI) e passar em `ca`. Se o servidor do Sefin usar cadeia pública comum, nem isso é preciso [a confirmar na homologação]. |
| R6 | A S-3 depende de `server/dolores/avisos.ts` e da migração 0150, que estão na branch local `epic027-c5int2` e não na `main`. | S-3 só começa depois que essa branch entrar na `main`; até lá, S-1 e S-2 seguem. Se ela atrasar, o aviso de rascunho fica na lista de pendências da tela e no relatório diário (`rondas.ts`), sem envio novo. |
| R7 | Tetos dos avisos: no máximo 6 por dia, segunda a sábado, 07h–20h, agrupados. Rascunho criado às 21h só é avisado no dia seguinte. | Aceito pelo desenho dos avisos (decisão do dono de 21/11). O resumo das 18h agrupa tudo. |
| R8 | Duplicidade de receita: a mesma entrada aparece no BPO e no módulo (obra, regularização) ligada por `bpo_lancamento_id`. | Chave única `(origem_tipo, origem_id)` + regra "lançamento do BPO já coberto por um registro de módulo não gera nota própria". Teste dedicado. |
| R9 | O que é ou não serviço tributável (parcela da Caixa, custas repassadas, comissão de correspondente) é decisão do contador. | Tudo nasce `A_DECIDIR` (decisão do pedido original: "sempre perguntar"); itens que são reembolso (ITBI, cartório, taxas da Caixa) já vêm com **sugestão** de motivo, nunca decididos sozinhos. |
| R10 | Função da Vercel de 60 s: assinatura + mTLS + resposta do Sefin + PDF. | Emissão é uma nota por chamada, com prazo próprio (ex.: 25 s para o Sefin); resultado incerto (tempo esgotado) vira `EMITINDO` e é resolvido por consulta da DPS (`GET /dps/{id}`) antes de qualquer reenvio — nunca reenviar às cegas (nota duplicada). |
| R11 | Chave do cofre derivada de `JWT_SECRET` (`secret-vault.ts:9-15`): trocar o `JWT_SECRET` torna ilegíveis todas as credenciais, inclusive o A1. | Aceito (é o padrão das chaves do painel, decisão b). Documentar no card: "se o JWT_SECRET mudar, envie o certificado de novo". Alternativa avaliada em `DIAGNOSTICO.md` §6. |
| R12 | Documentação oficial do gov.br não pôde ser lida nesta sessão (rede bloqueada para `www.gov.br`). | Tudo o que veio de terceiros está marcado em `PESQUISA.md`; a etapa 4 começa conferindo o Swagger da produção restrita com o certificado do dono. |

## 7. Dependências do dono e do contador (bloqueiam só a etapa 4)

1. Regime tributário de cada CNPJ emissor (Simples, Presumido, Real) — muda o grupo de tributação da DPS e a calculadora do
   Simples × regime regular.
2. Se a Efficaz (correspondente Caixa) emite pelo CNPJ da Prospecta ou por um próprio (→ segundo emissor).
3. Certificado A1 (`.pfx` + senha) de cada CNPJ emissor, enviado pelo próprio dono no painel.
4. Inscrição municipal em Imperatriz e nos municípios das obras, se exigida.
5. Códigos de serviço (código de tributação nacional, NBS, item da LC 116), alíquotas de ISS e retenções de cada tipo de
   serviço, validados pelo contador.
6. CNO (Cadastro Nacional de Obras) das obras, se a DPS de construção civil exigir [a confirmar no leiaute].
7. Quem é o tomador em cada tipo de receita (ex.: parcela da Caixa — o mutuário ou a Caixa?) — decisão do contador.

## 8. Fora do escopo

- Portar para o Grupo Santa Fé (pendência no ROADMAP).
- NF-e de produto, NFC-e, CT-e.
- Regra `automatico` (decisão h).
- Envio de nota por e-mail ao tomador (pode vir depois, com autorização própria: é mensagem a cliente).
