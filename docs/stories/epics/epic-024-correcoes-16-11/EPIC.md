# EPIC-024 — As 10 correções de 16/11/2026 (prompt mestre do dono)

Status: InProgress
Origem: "PROMPT MESTRE — AIOX · PROSPECTA | Correções, melhorias e deploy em produção" (16/11/2026).
Regra de execução: `CLAUDE.md`, seção "EPIC-024 … e EPIC-025 (Dolores)" — contínuo, migrando e publicando a cada etapa.
Escopo: só Prospecta. Grupo Santa Fé em espera por decisão do dono (pendências de porte no ROADMAP).

## Fase 0 — auditoria e proteção (feita em 16/11)
- Backup completo do banco: ramificação Neon `backup-2026-11-16-antes-das-10-correcoes` (`br-odd-wind-aniucvpr`),
  conferida contra a produção (2.539 lançamentos BPO, 160 leads, 24 estudos, 119 tabelas).
- Nove ramificações antigas de teste apagadas com autorização do dono (o limite de 10 impedia o backup).
- Auditoria somente leitura das 10 correções pelo @architect: causa de cada defeito, o que existe, riscos e ordem.
- Reversão: código por `git revert` do PR da etapa; banco pelas migrações só aditivas e pela ramificação de backup.

## Correções, fases e stories

| # | Correção | Fase | Story | Tamanho | Migração |
|---|---|---|---|---|---|
| 01 | BPO / Conta Azul — reimportação bloqueada | 1 | `S-01-conta-azul-reimportacao.md` | M | — |
| 08 | KML e KMZ do terreno | 1 | `S-08-kml-kmz.md` | S | — |
| 02 | Logotipo por empreendimento | 2 | `S-02-logotipo-empreendimento.md` | M | 0119 |
| 06 | Proposta formal de aquisição do terreno (PDF e e-mail) | 2 | `S-06-proposta-terreno.md` | M | 0120 |
| 07 | Filtros na listagem de incorporações | 2 | `S-07-filtros-incorporacao.md` | S | — |
| 09 | Gerador de PCI — CPF, dados automáticos, biblioteca de modelos | 3 | `S-09-pci.md` | L | 0118 |
| 03 | Maquete — PDF que é só imagem (leitura híbrida) | 4 | `S-03-pdf-imagem.md` | L | — |
| 04 | Maquete — muro do condomínio | 4 | `S-04-muro-condominio.md` | M | — |
| 05 | Maquete — importar planta na revisão | 4 | `S-05-importar-planta-revisao.md` | M/L | 0121 |
| 10 | Integração Anthropic (cadastro, sem ativar) | 5 | `S-10-anthropic.md` | M | — |

Números de migração reservados para não colidir entre agentes: 0118 PCI, 0119 logos, 0120 e-mail da proposta,
0121 revisões da maquete. Todas aditivas e idempotentes.

## Fatos apurados na Fase 0 que mudam o plano
- **01:** os 1.528 lançamentos do Conta Azul estavam TODOS arquivados e seguravam a chave única `request_key`; a
  prévia contava arquivado como "já importado" (`chavesJaImportadas` sem filtro). Nenhum tinha vínculo com banco,
  Asaas, obra, regularização ou recebimento. Com a autorização do dono ("tudo que foi arquivado pode apagar
  definitivamente"), em 16/11 foram copiados para `bpo_lancamentos_backup_conta_azul_20261116` (1.528 linhas) e
  apagados em definitivo. Restam 1.011 lançamentos, todos arquivados, de OUTRAS origens (879 legado, 132 Asaas):
  não tinham sido tocados. **Depois, no mesmo dia, o dono autorizou: "pode apagar também os 1.011 arquivados do
  legado e Asaas".** Conferido antes: nenhum vínculo com recebimento, obra, regularização ou lançamento combinado; as
  379 movimentações bancárias ligadas já estavam como "pendente". Copiados para
  `bpo_lancamentos_backup_legado_asaas_20261116` (879 legado + 132 Asaas) e apagados em definitivo.
  `bpo_lancamentos` ficou com 0 linhas; o histórico (`bpo_lancamento_historico`, 2.539 linhas) foi preservado, sem o
  vínculo. As duas tabelas de backup e os snapshots de `bpo_lancamento_exclusoes_backup` ficam para auditoria — não
  apagar. Falta o código: a prévia distinguir arquivado de ativo e a reimportação não travar de novo.
- **03:** o PDF que o dono não conseguia ler (maquete 8) passou pelo iLovePDF e é uma única imagem JPEG de
  7144 × 5012 — sem nenhuma linha vetorial. Decisão do dono: quando o leitor próprio não garantir a qualidade, ler
  pela IA. Depende da chave cadastrada pelo dono (correção 10).
- **09:** o CPF não vem porque `listarEngenheiros` não seleciona `engineer_profiles.cpf` e `aplicarEngenheiroPci` não
  preenche `rtpCpf`/`rteCpf`; "Dados automáticos" devolve o mesmo que a tela já abriu preenchida e nunca traz RTP/RTE.
- **10:** a chave do painel fica isolada (nunca escrita em `ENV`), para não ligar em silêncio a IA paga em outras funções.
- **02:** não há gerador de imagem em uso no sistema; o botão de IA do logotipo fica com a dependência declarada.

## Etapas
- [x] Fase 0 — auditoria, backup conferido, limpeza do Conta Azul em produção
- [x] Fase 1 — 01 (código) e 08 — publicadas (PR #234, #235, #236)
- [x] Fase 2 — 02, 06, 07 — publicadas (PR #235, #236)
- [x] Fase 3 — 09 — publicada (PR #237)
- [x] Fase 4 — 03, 04, 05 — publicadas (PR #239 muro; PR #242 PDF-imagem pela IA e importar planta; migração `0121`)
- [x] Fase 5 — 10 — publicada (PR #234), só cadastro; Anthropic não ativada
