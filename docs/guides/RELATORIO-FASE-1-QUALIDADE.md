# Relatório da Fase 1 — Qualidade estática

Data: 2026-08-31  
Branch: `codex/nextjs-santa-fe-unification`  
HEAD inicial local: `746f670`  
Checkpoint remoto inicial: `e26957a`

## Escopo executado

- eliminados todos os 27 erros de lint encontrados no início da fase;
- removidos imports, variáveis e expressões sem efeito;
- substituídos casts `any` por tipos inferidos do schema legado;
- movido o componente de lançamentos do BPO para fora do ciclo de renderização;
- removidas atualizações síncronas de estado disparadas por efeitos;
- estabilizado o cálculo de tempo usado durante renderização;
- corrigidas entidades tipográficas em conteúdo JSX;
- preservados comportamento, identidade visual, landing, vídeos e links da Prospecta.

## Verificação da história

História verificada: a plataforma unificada deve continuar compilando e executando seus contratos existentes depois da correção da dívida estática, sem alteração funcional ou visual intencional.

| Camada | Estado | Evidência |
| --- | --- | --- |
| Lint | Aprovado | 0 erros; 25 avisos revisados |
| TypeScript | Aprovado | `tsc --noEmit` sem erros |
| Testes automatizados | Aprovado | 29 arquivos; 275 testes |
| Build de produção | Aprovado | Next.js 16.2.7; 56 páginas estáticas geradas; todas as rotas coletadas |
| Banco/produção | Não alterado | Nenhuma migration ou deploy executado |

## Avisos remanescentes

Os 25 avisos restantes pertencem exclusivamente à regra `@next/next/no-img-element`.

Eles foram mantidos conscientemente neste checkpoint porque envolvem:

- imagens e links da landing que precisam permanecer visualmente idênticos;
- QR Codes PIX em `data:` URL;
- fotos de perfil geradas localmente em `data:` URL;
- URLs de produtos administráveis e potencialmente externas.

A migração dessas imagens para `next/image`, com configuração de domínios, dimensões e validação visual, pertence à Fase 5. Alterá-las sem teste visual criaria risco de regressão de layout e não faz parte da Fase 1.

## Riscos ou pendências

- executar validação visual desktop/mobile na Fase 5;
- revisar os 25 elementos de imagem com evidência visual antes de otimizar;
- o aviso do npm sobre `http-proxy` é do ambiente de execução, não do código do projeto.

## Rollback

Reverter somente o commit `checkpoint/fase-1: stabilize lint and static quality`. Nenhuma alteração de banco precisa ser revertida.

## Próxima fase

Fase 2 — auditoria e fechamento da paridade funcional com o Grupo Santa Fé.
