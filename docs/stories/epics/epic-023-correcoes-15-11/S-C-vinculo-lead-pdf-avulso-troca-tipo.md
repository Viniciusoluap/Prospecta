# S-C — Maquete 3D: vínculo com cliente do CRM, PDF avulso e troca de tipo com planta padrão

Status: Draft
Epic: EPIC-023 (Etapa C) — correções 6, 7 e 12 do dono (15/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: G
Bloqueios: decisão 3 do dono (trocar a regra CHECK de vínculo para aceitar lead) bloqueia a correção 6.

## Problema

- Correção 6: o pedido "Projeto de cliente (pago)" só pode ser ligado a um projeto. O dono quer ligar ao projeto
  (como hoje) **ou** a um cliente do CRM (lead), um dos dois, e permitir PDF avulso. Hoje o CHECK
  `maquetes_3d_origem_alvo_ck` (`drizzle/0111_maquete_3d.sql:47-50`) exige `project_id` ou `study_id`, e os
  documentos só têm `fonte` 'projeto' | 'incorporacao' (`shared/maquete-3d/regras.ts:107-116`). O rótulo do projeto
  repete o nome do cliente (`AdminMaquete3D.tsx:153`).
- Correção 7: o pedido de Incorporação também deve aceitar PDF avulso.
- Correção 12: trocar o tipo (loteamento/casa/prédio) não redesenha a maquete. Não há mutation de troca de tipo;
  `validarModelo` (`shared/maquete-3d/modelo.ts:276`) exige edificação lida; `umaPorLote` está em
  `EditorPlanta.tsx:119-132`; o visualizador limita a 24 construções (`visualizador/Implantacao.tsx:41`).

## Critérios de aceite

### Correção 6
- [ ] AC1: ao criar "Projeto de cliente (pago)", o admin escolhe vincular a um projeto **ou** a um cliente do CRM
      (lead). O banco recusa pedido sem nenhum dos dois e com os dois (regra CHECK nova, conforme decisão 3).
- [ ] AC2: o pedido aceita PDF avulso enviado na hora, pelo upload em partes já existente
      (`server/document-upload-chunks.ts`), além dos documentos do projeto.
- [ ] AC3: pedido ligado a lead funciona no portal (`server/maquete-3d/venda.ts`) e no aviso por e-mail
      (`destinatario` em `server/maquete-3d/avisos.ts:17-27` resolve o e-mail pelo lead).
- [ ] AC4: o rótulo do projeto na lista não mostra o nome do cliente duas vezes (`AdminMaquete3D.tsx:153`).
- [ ] AC5: pedidos existentes continuam válidos sem alteração de dados.

### Correção 7
- [ ] AC6: o pedido de Incorporação aceita PDF avulso pelo mesmo upload em partes.

### Correção 12
- [ ] AC7: existe a ação de trocar o tipo da maquete (loteamento/casa/prédio) e ela redesenha a maquete.
- [ ] AC8: em Casa, o sistema pergunta o tamanho e desenha uma planta padrão básica em todos os lotes, respeitando o
      lote (distribuição automática).
- [ ] AC9: em Prédio, o sistema pergunta o tamanho e desenha um prédio padrão, respeitando o lote.
- [ ] AC10: `validarModelo` aceita a edificação padrão gerada (não exige edificação lida do PDF nesse caso).
- [ ] AC11: o visualizador mostra todas as construções dos lotes (sem o limite de 24), usando repetição leve
      (instancing).
- [ ] AC12: o PDF real continua opcional; quando lido, substitui a planta padrão.

## Tarefas
- [ ] T1: migração aditiva: coluna de vínculo com lead e novo valor de `fonte` para PDF avulso (nomes definidos na
      implementação). Troca do CHECK `maquetes_3d_origem_alvo_ck` só após a decisão 3.
- [ ] T2: servidor — criação por lead, upload avulso, `venda.ts` e `avisos.ts` resolvendo por lead.
- [ ] T3: tela — escolha projeto/lead, envio de PDF avulso (projeto e incorporação), rótulo sem duplicar o cliente.
- [ ] T4: gerador de casa padrão e de prédio padrão em `shared/maquete-3d/`, com distribuição nos lotes.
- [ ] T5: mutation de troca de tipo; ajuste de `validarModelo` e `umaPorLote`.
- [ ] T6: instancing no `visualizador/Implantacao.tsx`, retirando o limite de 24.
- [ ] T7: suíte, `pnpm check`, `vite build`; aplicar migração aditiva no Neon; HANDOFF.

## Arquivos principais
- `drizzle/schema.ts`, nova migração em `drizzle/` (após `0114_maquete_3d_email.sql`)
- `shared/maquete-3d/regras.ts`, `shared/maquete-3d/modelo.ts`, `shared/maquete-3d/implantacao.ts`
- `server/maquete-3d/router.ts`, `venda.ts`, `avisos.ts`, `server/document-upload-chunks.ts`
- `client/src/pages/admin/AdminMaquete3D.tsx`, `client/src/components/maquete-3d/EditorPlanta.tsx`,
  `client/src/components/maquete-3d/visualizador/Implantacao.tsx`

## Testes previstos
- Automáticos (`server/maquete-3d.test.ts`, `server/maquete-3d-visualizador.test.ts`): pedido por lead aceito, sem
  vínculo e com os dois recusados; destinatário por lead; PDF avulso nos dois tipos de pedido; troca de tipo gera
  planta padrão em todos os lotes e passa em `validarModelo`; PDF lido substitui a planta padrão.
- Manuais: troca de tipo no painel; visualizador com mais de 24 lotes em iPad/celular.
- Pendente em produção: pedido real ligado a lead, e-mail real.

## Riscos
- Desempenho com muitas construções em aparelho fraco → instancing e conferência em aparelho real.
- Troca do CHECK sem autorização → T1 parcial até a decisão 3.

## File List
_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
