# HANDOFF 17/11 — Termo de consentimento definitivo + endereço da Avaliação (Prospecta)

Branch: `claude/paridade17-termo` (Prospecta). Gêmeo no Santa Fé: `claude/paridade17-b4-termo` (mesmo handoff na raiz).
Ordem do dono (17/11): "Corrija esse termo, faça você mesmo o termo e corrija nos dois repositórios" e, para o endereço,
"sempre vindo do lead, mas com a possibilidade de edição na avaliação, isso para os dois".
Sem merge, sem PR, sem deploy e **sem migração aplicada** nesta sessão.

## Texto final do termo (resumo dos pontos decididos)
Mesma estrutura nos dois sistemas (8 seções). Nada de "texto provisório", colchetes ou pendências do jurídico.

| Item | Decisão |
|---|---|
| 1. Controlador | Prospecta: PROSPECTA CONSTRUÇÕES E AVALIAÇÃO IMOBILIÁRIA LTDA, CNPJ 41.865.900/0001-89, R. Gonçalves Dias, 1993 - Juçara, Imperatriz - MA, 65900-545 (`shared/empresa.ts`). Santa Fé: "Grupo Santa Fé" (nome comercial), Rua B, Nº 40 - Ouro Preto, Canaã dos Carajás - PA, 68350-307 (igual ao rodapé do site, `web/src/lib/empresa.ts`). |
| Encarregado (art. 41) | Canal de atendimento ao titular, sem nome de pessoa (nenhum responsável nomeado nos repositórios). Prospecta: atendimento@prospectaconstrucoes.com / (99) 98139-2210. Santa Fé: comercial@gruposantafee.com.br / (94) 99304-4689. |
| 6. Guarda | Enquanto durar a relação; depois, só o que a lei manda/permite, pelos prazos legais (ex.: 5 anos para documentos fiscais e contábeis; prescrição para defesa de direitos); então eliminação ou anonimização. O titular pode pedir a eliminação antes. Registro do aceite/retirada guardado como prova. Não promete apagamento automático. |
| 7. Prazo de resposta | Confirmação simples ao receber o pedido; declaração completa em até 15 dias (art. 19, II). |
| 7. Direitos | Lista do art. 18 (confirmação, acesso, correção, anonimização/bloqueio/eliminação, portabilidade, eliminação dos dados consentidos, compartilhamento, possibilidade de não consentir, revogação) + ANPD. |
| 7. Retirada | Pelo botão (Prospecta: Meu perfil; Santa Fé: fim da página do termo, logado) ou pelos contatos, e a equipe registra. Fica registrada com data, hora e quem registrou. Vale dali em diante, não desfaz o passado; o sistema volta a pedir o aceite ao entrar. |
| 4. IA | Prospecta: inalterada (atendimento WhatsApp, leitura de documentos/projetos, apoio à equipe; Anthropic, fora do Brasil). Santa Fé: só Central de Vendas no WhatsApp (entra desligada; mensagens, o que a pessoa informa e nome/tipo dos arquivos vão à Anthropic) e análise de mercado/imóveis (dados do imóvel, sem nome, CPF, telefone ou e-mail). Sem maquete nem assistente da equipe. |

## Como funciona a retirada
- Registro = linha NOVA na tabela só de inclusão `consentimentos`, `tipo = 'revogacao'`, com quem registrou
  (`registrado_por`/`registradoPor`) e quando; canal `admin` (pelo admin) ou `conta` (pelo próprio titular). O banco
  recusa retirada sem autor ou com canal de aceite; UPDATE/DELETE/TRUNCATE continuam recusados.
- Só contam os aceites DEPOIS da última retirada. Quem retirou: a consulta do admin mostra "retirado em … (registrado
  por …)"; ao entrar, o modal do termo volta (aceitar de novo ou sair), conta nova ou antiga. O aceite novo funciona.
- Retirar sem consentimento ativo (ou duas vezes) é recusado com "Não há consentimento ativo para retirar.".
- Admin: Prospecta "Usuários e acesso" › Termo de consentimento; Santa Fé Configurações › Termo de consentimento
  (aceites por papel e por usuário). Só admin ativo (por papel).

## Regra do endereço da Avaliação (igual nos dois)
- Criar ou vincular (ou trocar, no Santa Fé): o endereço vem do lead (campos que o lead tem preenchidos).
- O endereço é editável na avaliação; o que foi salvo nela nunca é sobrescrito pelo lead ao salvar a avaliação.
- Mudar o endereço do lead: campo a campo, a avaliação só muda onde o valor ainda é igual ao antigo do lead, ou está
  vazio / "A definir". Cidade e UF também seguem quando o endereço da avaliação está pendente. Comparação ignora
  espaços e maiúsculas. Lead que apaga um campo não apaga o da avaliação.

## O que mudou na Prospecta
- `shared/termo-consentimento.ts` — texto definitivo, versão `2026-11-17.3`, `HISTORICO_DO_TERMO`; saíram
  `PENDENCIAS_DO_JURIDICO` e `AVISO_TEXTO_PROVISORIO`; canais `admin`/`conta` e tipos `aceite`/`revogacao`.
- `drizzle/0132_consentimentos_retirada.sql` (nova, aditiva e idempotente, **NÃO aplicada**) + `drizzle/schema-consentimentos.ts`:
  colunas `tipo` (padrão 'aceite') e `registrado_por`; CHECK do canal ampliado; CHECK "retirada exige autor".
- `server/consentimento.ts` — `situacaoDosRegistros` (só aceites depois da última retirada), `registrarRetirada`,
  `resumoPorUsuario`; rotas `consentimento.retirar`, `consentimento.meuConsentimento`, `consentimento.admin.registrarRetirada`;
  `minhaSituacao` pede o termo a quem retirou (conta nova ou antiga).
- Telas: `AdminConfiguracoes.tsx` (janela do termo: retirados, botão "Registrar retirada", linha "retirado em…");
  `components/consentimento/MeuConsentimento.tsx` em `Perfil.tsx` (botão "Retirar consentimento" com confirmação).
- Endereço: `shared/lead-snapshot.ts` (`enderecoDaAvaliacaoAposLead`, `enderecoAoVincular`), `server/avaliacao-endereco.ts`
  (propagação), `server/db.ts` (`getAvaliacoesEnderecoDoLead`), `server/routers.ts` (`avaliacoes.update` não
  sobrescreve mais o endereço com o do lead — só ao vincular agora; `leads.update` propaga o endereço),
  `AdminAvaliacaoEditar.tsx` (endereço editável em avaliação vinculada).
- Docs: story S-12 (seção do texto definitivo), ROADMAP (porte ao Santa Fé e regra do endereço).

## Testes
(a) Automáticos (comandos reais, nesta branch):
- `npx vitest run` — **262/262 arquivos, 2858/2858 testes**.
  Inclui `server/consentimento.test.ts` (45; 7 novos de retirada, textos definitivos, migração 0127+0132 aplicada 2x em PGlite)
  e `server/avaliacao-endereco.test.ts` (10; regra pura, `avaliacoes.update`, `leads.update`, propagação em PGlite).
  Ajustes em testes existentes (nenhum apagado/pulado): lista de colunas do aceite (+tipo, registrado_por), lista de rotas
  do consentimento (+3), textos antigos trocados pelos definitivos, `vinculos-reais.test.ts` com o mock da consulta nova.
- `npx tsc --noEmit -p .` — ok. `npx vite build` — ok (só o aviso de tamanho de bloco que já existia).
(b) Manuais: nenhum nesta sessão (sem navegador).
(c) Pendente em produção: aplicar 0132; retirar pelo admin e pelo Meu perfil; ver o modal voltar e aceitar de novo;
editar endereço de avaliação vinculada e depois o do lead.

## Riscos / atenção
- **Aplicar 0132 no Neon ANTES de publicar o código**: sem as colunas novas, as consultas dos aceites falham — criar
  senha pelo link mostra "Não foi possível verificar agora" e o modal do login não aparece.
- `minhaSituacao` agora consulta o banco também para contas antigas (para saber se retiraram): uma consulta por sessão.
- O CLAUDE.md (item 3 de "Dolores e consentimento") ainda diz que o texto é provisório; não foi alterado por esta sessão.
- Retirada não apaga dados nem bloqueia o servidor: a trava continua sendo o modal (limitação já registrada na S-12).
- Clientes/leads que nunca criam login continuam fora do termo (consentimento por contrato/ficha).

## Próximo passo exato
1. QA (@qa) da branch. 2. Aplicar `drizzle/0132_consentimentos_retirada.sql` no Neon (aditiva; idempotente).
3. PR `claude/paridade17-termo` → main e conferir a Vercel. 4. Validar (c) acima.
