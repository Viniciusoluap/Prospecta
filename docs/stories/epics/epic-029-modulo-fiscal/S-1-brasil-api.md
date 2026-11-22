# S-1 — Cadastro automático por CNPJ e CEP (Brasil API + ViaCEP de reserva)

Status: InReview (ramo `epic029-s1`, criado de `origin/main` em `a3fc88a`; portão de QA CONCERNS em `a0d8fc4`, achados corrigidos — aguarda a reconferência do @qa).
Epic: EPIC-029 — Módulo Fiscal (`EPIC.md`, escrito em outra frente). Etapa 1, autorizada pelo dono, custo zero (só APIs gratuitas).
Migração: `drizzle/0152_consultas_cadastrais_cache.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).
Paridade: regra comum dos dois sistemas — **pendência de porte para o Grupo Santa Fé** (registrar no ROADMAP do Prospecta; ver Pendências).

## Pedido
Ao digitar um CNPJ completo, buscar na Brasil API razão social, nome fantasia, endereço completo, situação cadastral e CNAE
principal; ao digitar um CEP completo, buscar logradouro, bairro, cidade, UF e código IBGE (Brasil API, com o ViaCEP de reserva
automática). Alertar quando o CNPJ não estiver ATIVO. Aplicar nas telas de cadastro que já existem, sem criar cadastro novo e sem
sobrescrever em silêncio o que o usuário já digitou. CPF não consulta nada.

## Escopo
- DENTRO: serviço de servidor com host fixo, tempo-limite, zod e limpeza de texto; cache de 30 dias no Neon; limite por usuário;
  procedimentos tRPC com permissão; hook + aviso reutilizáveis no cliente; ligação nas telas existentes com CNPJ/CEP em formulário
  controlado.
- FORA: emissão de nota e qualquer outra etapa do Módulo Fiscal; formulários não controlados (ver Pendências); consulta de CPF;
  gravação de qualquer dado novo nos cadastros (só preenche os campos que a tela já tem).

## Critérios de aceite
- [x] AC1 — `server/_core/brasilapi.ts`: CNPJ em `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` → razão social, nome fantasia,
      endereço (tipo + logradouro, número, complemento, bairro, cidade, UF, CEP, código IBGE), situação cadastral e CNAE principal
      (código + descrição). Sócios (QSA, com CPF parcial), telefone e e-mail não saem do serviço.
- [x] AC2 — CEP em `https://brasilapi.com.br/api/cep/v2/{cep}` → logradouro, bairro, cidade, UF, código IBGE (`ibge.city`, quando vem).
      Se a Brasil API falhar (erro HTTP, tempo esgotado, rede, resposta fora do formato ou "não encontrado"), tenta sozinho
      `https://viacep.com.br/ws/{cep}/json/` (traz `ibge`). Só falha quando os dois falham.
- [x] AC3 — Segurança antes da rede: CNPJ com dígito errado (validador reaproveitado de `shared/contratos/modelos.ts#cnpjValido`,
      que já aceita o CNPJ alfanumérico) e CEP fora de 8 números NÃO chamam a rede nem o cache. Host fixo (a única parte variável da
      URL é o documento limpo), `redirect: "error"`, tempo-limite de 4 s por chamada com `AbortController`, resposta de até 200 KB,
      conferida por zod tolerante (campo novo é ignorado; tipo errado vira vazio) e textos limpos (sem HTML, sem caractere de controle,
      tamanho máximo por campo).
- [x] AC4 — Permissão: CNPJ só para admin e colaborador ATIVO com módulo **BPO** ou **Obras** (mapa `consultaCadastral` em
      `server/_core/trpc.ts`); corretor, cliente, empreiteiro, conta inativa e visitante, não. CEP: qualquer conta ATIVA logada (o CEP
      também está em "Meu perfil", que toda conta edita); visitante, não.
- [x] AC5 — Limite de uso: 30 consultas por minuto por usuário (CNPJ e CEP somados) → `TOO_MANY_REQUESTS` com frase clara.
- [x] AC6 — Nada de CNPJ/CPF em log nem na mensagem de erro: os avisos do servidor dizem só o tipo do problema. CPF nunca é
      devolvido nem guardado: o CPF do dono que vem na razão social/nome fantasia de MEI (11 números, com ou sem pontuação) é
      retirado antes da tela e do cache, e também na leitura de linha antiga do cache (`semCpf`, correção do portão de QA).
- [x] AC7 — Cache de 30 dias na tabela nova `consultas_cadastrais_cache` (tipo, chave, resposta jsonb, fonte, consultado_em; uma linha
      por tipo+chave; CHECK no formato da chave). Guarda o resultado JÁ LIMPO, nunca a resposta bruta; não guarda falha; cache
      estragado ou vencido vai à rede e regrava; banco fora do ar não impede a consulta.
- [x] AC8 — Alerta: situação diferente de ATIVA (INAPTA, BAIXADA, SUSPENSA, NULA ou não informada) devolve `alerta` e a tela mostra em
      destaque (caixa âmbar, `role="alert"`). No cache, o alerta é recalculado a partir da situação gravada.
- [x] AC9 — Telas existentes: ao completar 14 caracteres de CNPJ válido (ou 8 números de CEP), preenche SÓ os campos vazios; o que o
      usuário já digitou com outro valor aparece listado com os botões "Usar dados da Receita" / "Usar endereço do CEP" e "Manter o
      que digitei". Documento já salvo no cadastro aberto não consulta de novo só por abrir a tela. Falha → frase "preencha à mão".
- [x] AC10 — Testes vitest com fetch simulado (nenhum teste usa a rede).

## Formato das respostas (confirmado)
- Brasil API CNPJ v1 e CEP v2: conferidos na documentação OpenAPI oficial do projeto BrasilAPI
  (`pages/docs/doc/cnpj.json` e `pages/docs/doc/cep.json` no repositório oficial, lidos em 22/11/2026; o site `brasilapi.com.br`
  estava bloqueado pela rede desta sessão). CNPJ: `razao_social`, `nome_fantasia`, `situacao_cadastral` (1 NULA, 2 ATIVA,
  3 SUSPENSA, 4 INAPTA, 8 BAIXADA) + `descricao_situacao_cadastral`, `cnae_fiscal` + `cnae_fiscal_descricao`,
  `descricao_tipo_de_logradouro`, `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `uf`, `cep`,
  `codigo_municipio_ibge`; 400 inválido, 404 não encontrado, 503 indisponível (não guardar em cache). CEP v2: `cep`, `state`, `city`,
  `neighborhood` (pode ser nulo), `street` (pode ser nulo), `location`, `ibge { city, state }` (podem ser nulos); 404 não encontrado.
- ViaCEP: formato real confirmado pelo portão de QA (22/11/2026): `cep`, `logradouro`, `bairro`, `localidade`, `uf`, `ibge`;
  `{ "erro": true }` (ou `"true"`) quando o CEP não existe. Mapeado com zod tolerante: campo ausente vira vazio; sem cidade ou UF,
  a resposta é recusada.

## Telas alteradas (cadastros que já existiam)
| Tela | Campo que consulta | Campos preenchidos (se vazios) |
|---|---|---|
| BPO › Clientes › Novo cliente (`AdminBpo.tsx`) | CNPJ | Nome / Razão social (desligado quando o cliente vem do CRM) |
| BPO › Contabilidade › Perfil tributário (`TaxAccountingPanel.tsx`) | CNPJ | Empresa |
| BPO › Contabilidade › Empreendimento e RET (`TaxAccountingPanel.tsx`) | CNPJ/SPE | Empreendimento (nome fantasia ou razão social) |
| Obra › Valores da operação › Novo investidor (`FinanceiroObra.tsx`) | CPF/CNPJ (só CNPJ consulta) | Nome |
| Configurações › Usuários › Engenheiro (`PerfilEngenheiroPanel.tsx`) | CEP | Logradouro, bairro, cidade, UF |
| Meu perfil (`Perfil.tsx`) | CEP | Endereço (logradouro - bairro), cidade, estado |

## Decisões
- [AUTO-DECISION] Quem consulta CEP → qualquer conta ativa logada (motivo: "Meu perfil" tem CEP e toda conta edita o próprio perfil;
  o limite por usuário e o host fixo evitam o uso como repasse aberto).
- [AUTO-DECISION] Módulos que liberam o CNPJ ao colaborador → BPO e Obras (motivo: são os módulos das telas ligadas nesta etapa;
  ao ligar outra tela, acrescentar o módulo dela no mapa).
- [AUTO-DECISION] Procedimentos como `mutation` (motivo: gravam o cache e contam no limite; não devem ser repetidos sozinhos pelo
  react-query).
- [AUTO-DECISION] Falha de consulta volta como `{ ok: false, motivo, mensagem }` (motivo: a tela segue no preenchimento à mão sem erro
  vermelho genérico); permissão e limite continuam como erro tRPC.
- [AUTO-DECISION] Migração numerada 0152 conforme o pedido (0150 e 0151 ficam para as outras frentes em andamento).
- IDS: REUSE de `cnpjValido` (`shared/contratos/modelos.ts`), padrão de tabela/migração em arquivo próprio (`schema-dolores-memoria-longa.ts`,
  0149) e de testes de migração em PGlite (`aiox-migrations.test.ts`); CREATE do serviço, do hook e do aviso (não havia consulta de
  CNPJ/CEP nem preenchimento automático no repositório).

## Arquivos
- `shared/consulta-cadastral.ts` (novo) — limpeza/conferência de CNPJ e CEP, situação e alerta, limpeza de texto, separação vazio × conflito.
- `server/_core/brasilapi.ts` (novo) — consultas à Brasil API e ao ViaCEP (host fixo, tempo-limite, zod, limpeza).
- `server/consulta-cadastral.ts` (novo) — cache no banco, limite por usuário, `consultaCadastralRouter` (`cnpj`, `cep`).
- `server/consulta-cadastral.test.ts` (novo) — 41 testes.
- `server/consulta-cadastral-qa.test.ts` (novo, do @qa) — 22 testes do portão de QA (os `it.fails` viraram `it`).
- `drizzle/0152_consultas_cadastrais_cache.sql` (novo), `drizzle/schema-consultas-cadastrais.ts` (novo), `drizzle.config.ts` (lista de schemas).
- `server/routers.ts` (registro `consultaCadastral`), `server/_core/trpc.ts` (mapa de módulos).
- `client/src/hooks/useAutoPreenchimentoCadastral.ts` (novo), `client/src/components/AvisoConsultaCadastral.tsx` (novo).
- `client/src/pages/admin/AdminBpo.tsx`, `client/src/pages/admin/TaxAccountingPanel.tsx`, `client/src/components/obra/FinanceiroObra.tsx`,
  `client/src/components/admin/PerfilEngenheiroPanel.tsx`, `client/src/pages/Perfil.tsx`.

## Testes
(a) Automáticos:
- `npx vitest run server/consulta-cadastral.test.ts server/consulta-cadastral-qa.test.ts --maxWorkers=2 --minWorkers=1` → 63/63
  (41 do @dev + 22 do @qa). Depois do QA: CPF de MEI fora da razão social/fantasia e do cache, invisíveis bidi/largura zero, resposta
  de outro CNPJ recusada, content-length > 200 KB recusado sem ler o corpo. Testes originais: regras comuns (CNPJ/CEP/CPF, alerta,
  limpeza de HTML, vazio × conflito); CNPJ sucesso, inválido sem rede, alerta por situação (4 casos), 404/503, malformado (3 casos),
  tipo errado tolerado, tempo esgotado, erro sem o CNPJ; CEP sucesso, reserva ViaCEP (erro, demora, malformado), os dois falham,
  não encontrado, formato inválido sem rede; cache válido, vencido, estragado, fonte ViaCEP, falha não guardada; migração 0152 2× em
  PGlite + gravar/ler/substituir no banco + banco fora do ar; limite (janela e por usuário); permissão (admin, colaborador BPO/Obras/CRM,
  corretor/cliente/empreiteiro, inativo, visitante), CEP para conta ativa, entrada estranha sem rede, falha amigável, limite de 30/min.
- Vizinhos: `admin-permissions`, `aiox-migrations`, `consentimento`, `cpf-validation`, `obra-financeiro-router`, `relatorios`,
  `operational-consolidation`, `agregador-admin`, `api-rotas-producao`, `admin-navigation` → todos passando.
- `npx tsc --noEmit` → 0 erros. `npx vite build` → concluído.
(b) Manuais: nenhum nesta sessão (sem acesso à Brasil API pela rede daqui).
(c) Pendentes de validação em produção: consulta real de CNPJ e CEP depois da migração 0152 aplicada.

## Como testar (depois da migração 0152 aplicada)
1. BPO › Clientes › "Novo cliente": deixe o nome vazio e digite um CNPJ válido de empresa ativa → o nome é preenchido e aparece
   "1 campo(s) vazio(s) preenchido(s)".
2. No mesmo formulário, digite outro nome e troque o CNPJ → o nome NÃO muda; aparece a lista com "Usar dados da Receita" e
   "Manter o que digitei".
3. Digite o CNPJ de uma empresa baixada ou inapta → caixa âmbar "Atenção: este CNPJ está BAIXADA/INAPTA na Receita Federal".
4. Meu perfil: apague cidade e estado e digite um CEP novo de 8 números → endereço, cidade e estado vazios são preenchidos.
5. Digite um CNPJ com o último número errado → nada é consultado (nenhum aviso); um CPF no campo CPF/CNPJ do investidor também não.

## Pendências
- Aplicar `drizzle/0152_consultas_cadastrais_cache.sql` no Neon (aditiva; sem ela as consultas funcionam, só sem cache — o servidor
  registra "cache indisponível" sem dados).
- Porte para o Grupo Santa Fé (regra de paridade): registrar no ROADMAP do Prospecta — consulta de CNPJ/CEP com as mesmas regras
  (host fixo, cache 30 dias, limite, alerta de situação, nunca sobrescrever em silêncio).
- Formulários não controlados que têm CPF/CNPJ (Jurídico › contratos "CPF/CNPJ Parte A/B", Modelos de contrato "CNPJ da Parte A",
  empreiteiro/terrenista) não foram ligados nesta etapa: exigem converter o formulário para estado controlado.
- O limite por usuário é em memória, por instância da função da Vercel (com várias instâncias, o teto real é maior). Se virar
  problema, mover a contagem para o banco.
- Atualizar o HANDOFF da frente (regra permanente) — fica com a sessão líder, que faz o commit/push.

## QA Results
- 22/11/2026 — @qa (Quinn), commit `a0d8fc4` (`server/consulta-cadastral-qa.test.ts`): **CONCERNS**. Aprovado em SSRF/repasse aberto
  (host fixo, sem seguir redirecionamento, tempo-limite cobre o corpo, tamanho máximo), permissão e limite, "nunca sobrescreve em
  silêncio" e migração só aditiva. Achados:
  - MÉDIO (LGPD) — CPF completo do dono do MEI na razão social ia para a tela e para o cache → **corrigido** (`semCpf` em
    `shared/consulta-cadastral.ts`, aplicado em `server/_core/brasilapi.ts#mapearCnpj` e na leitura do cache em `server/consulta-cadastral.ts`).
  - BAIXO 1 — invisíveis de direção e largura zero (U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF) passavam pela limpeza → **corrigido**.
  - BAIXO 2 — resposta com `cnpj` diferente do pedido era aceita e gravada → **corrigido** (recusada como `resposta_invalida`, sem cache).
  - BAIXO 3 — tamanho só conferido depois de ler o corpo → **corrigido** (recusa cedo por `content-length` > 200 KB).
  - ViaCEP: formato real confirmado pelo @qa.
- Veredito após as correções: CONCERNS → corrigido (os 3 `it.fails` viraram `it` e passam); aguarda a reconferência do @qa.

## Change Log
- 22/11/2026 — @dev (Dex): Ready → InProgress (início da implementação no ramo `epic029-s1`).
- 22/11/2026 — @dev (Dex): InProgress → InReview (ACs 1–10 implementados; tsc 0 erros, 36 testes novos + vizinhos passando, build ok).
- 22/11/2026 — @dev (Dex): correções do portão de QA (CONCERNS → corrigido): CPF de MEI, invisíveis bidi, CNPJ trocado, content-length; 63/63 testes.
