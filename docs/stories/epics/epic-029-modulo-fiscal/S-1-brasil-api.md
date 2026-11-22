# S-1 — Brasil API: CNPJ e CEP preenchem o cadastro

**Status:** Draft · **Epic:** EPIC-029 · **Etapa:** 1 · **Tamanho:** M · **Migração:** `0152_fiscal_consulta_cadastro.sql`

## Por quê
Hoje todo endereço e razão social é digitado à mão; nenhum cadastro tem consulta (DIAGNOSTICO §2). A nota fiscal (S-2/S-4)
precisa de CNPJ válido, endereço estruturado e **código IBGE** do município do tomador e da obra.

## Escopo
**Dentro**
1. `server/_core/brasilapi.ts`: `consultarCnpj(cnpj)` → Brasil API `/api/cnpj/v1/{cnpj}`; `consultarCep(cep)` → Brasil API
   `/api/cep/v2/{cep}`, com **reserva automática no ViaCEP** (`/ws/{cep}/json/`) se a Brasil API falhar, demorar mais de 1,5 s
   ou não trouxer o IBGE. Tempo-limite total 1,8 s. Rotas e campos [NÃO CONFIRMADO] → leitura defensiva + respostas gravadas
   nos testes (`server/__fixtures__/brasilapi/*.json`).
2. Resolver município → IBGE quando faltar (API de localidades do IBGE, por UF, guardada no mesmo cache).
3. Cache `fiscal_consultas_cache` (tipo `cnpj`|`cep`|`ibge_uf`, chave, resposta normalizada jsonb, fonte, `consultado_em`,
   `expira_em` = +30 dias). Consulta dentro do prazo não sai para a rede. Botão "consultar de novo" ignora o cache (admin).
4. `shared/fiscal/documento.ts`: um validador único de CPF e CNPJ **numérico e alfanumérico** (IN RFB 2.229/2024, DV módulo 11
   com valor ASCII − 48). As quatro cópias antigas não mudam nesta story (mudança de comportamento fora do escopo); ficam
   registradas como dívida no EPIC (R3).
5. `shared/fiscal/situacao-cnpj.ts`: situação ≠ "ATIVA" (BAIXADA, SUSPENSA, INAPTA, NULA) → alerta vermelho no campo e
   bandeira no cadastro; nunca bloqueia salvar, nunca apaga dado.
6. Componentes `CampoCnpj` e `CampoCep` (consulta ao completar o número, não a cada tecla; só preenche campo **vazio** e
   pergunta antes de sobrescrever campo já preenchido).
7. Aplicar em: cliente BPO (`AdminBpo.tsx`, `bpo_clients` — CNPJ e CEP), card do cliente no CRM (`leads` — CEP), obra (`construction_projects`),
   perfil do engenheiro (só CEP), empreiteiro (`users`, CNPJ opcional), e no futuro tomador da nota (S-2 reusa os componentes).
8. tRPC `fiscal.consultarCnpj` / `fiscal.consultarCep` com `protectedProcedure` + módulo do cadastro; limite por usuário
   (ex.: 60 consultas/10 min) para não virar proxy aberto.

**Fora:** cadastro de inscrição municipal; consulta por nome; enriquecimento em massa de cadastros antigos (pode vir com
autorização: é alterar dado existente).

## Migração 0152 (aditiva, idempotente)
- `CREATE TABLE IF NOT EXISTS fiscal_consultas_cache` (+ índice único `(tipo, chave)`).
- `ALTER TABLE leads ADD COLUMN IF NOT EXISTS cep varchar(9), numero varchar(20), complemento varchar(120), municipio_ibge varchar(7)`
  (o endereço do card hoje é um texto só). **Sem `leads.cnpj`**: tomador pessoa jurídica é o cliente do BPO (`bpo_clients.cnpj`,
  ligado ao card por `lead_id`) — não duplicar o CNPJ em dois cadastros (decisão k do dono).
- `bpo_clients`: `cep, logradouro, numero, complemento, bairro, cidade, uf, municipio_ibge, situacao_cnpj, situacao_cnpj_em`.
- `construction_projects`: `cep, municipio_ibge varchar(7), cno varchar(14)`.
- `users`: `cnpj varchar(18)`.
- Reversão: `DROP` das colunas/tabela (nenhum código antigo as lê).

## Critérios de aceite
1. **Dado** um CNPJ válido não consultado nos últimos 30 dias, **quando** o usuário termina de digitar, **então** razão
   social, nome fantasia, endereço, CNAE e situação aparecem em < 2 s (Brasil API respondendo) e a linha do cache é gravada.
2. **Dado** o mesmo CNPJ consultado há < 30 dias, **então** nenhuma chamada externa é feita (teste com `fetch` simulado que
   falha se chamado) e o preenchimento leva < 300 ms.
3. **Dado** a Brasil API fora (erro 5xx ou tempo esgotado) **quando** se consulta um CEP, **então** o ViaCEP responde e a
   fonte gravada é `viacep`; com os dois fora, mensagem clara e campos livres para digitação.
4. CEP preenche logradouro, bairro, cidade, UF e **código IBGE de 7 dígitos**.
5. CNPJ com situação BAIXADA/SUSPENSA/INAPTA/NULA mostra o alerta; teste para cada situação.
6. CNPJ alfanumérico válido é aceito; DV errado é recusado sem chamar a rede (testes com exemplos do Serpro).
7. Campo já preenchido não é sobrescrito sem confirmação.
8. Nenhum CPF de pessoa física é enviado à Brasil API (só CNPJ e CEP saem).
9. `pnpm check`, testes novos e `server/imports-esm.test.ts` passam; portão de QA.

## Segurança
- Só saem para fora CNPJ e CEP (dados públicos). URL montada só com dígitos/letras validados (sem SSRF: hosts fixos).
- Resposta externa tratada como dado: tamanho máximo, campos limitados, sem HTML.

## Dependências do dono
Nenhuma.

## Riscos
Limites da Brasil API sem número publicado; mudança de campos (testes com respostas gravadas avisam).
