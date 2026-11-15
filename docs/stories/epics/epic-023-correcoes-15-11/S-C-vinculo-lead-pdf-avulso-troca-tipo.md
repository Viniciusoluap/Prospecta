# S-C — Maquete 3D: vínculo com cliente do CRM, PDF avulso e troca de tipo com planta padrão

Status: Done (publicada em 15/11/2026)
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
- [x] AC1: ao criar "Projeto de cliente (pago)", o admin escolhe vincular a um projeto **ou** a um cliente do CRM
      (lead). O banco recusa pedido sem nenhum dos dois e com os dois (regra CHECK nova, conforme decisão 3).
- [x] AC2: o pedido aceita PDF avulso enviado na hora, pelo upload em partes já existente
      (`server/document-upload-chunks.ts`), além dos documentos do projeto.
- [x] AC3: pedido ligado a lead funciona no portal (`server/maquete-3d/venda.ts`) e no aviso por e-mail
      (`destinatario` em `server/maquete-3d/avisos.ts:17-27` resolve o e-mail pelo lead).
- [x] AC4: o rótulo do projeto na lista não mostra o nome do cliente duas vezes (`AdminMaquete3D.tsx:153`).
- [x] AC5: pedidos existentes continuam válidos sem alteração de dados.

### Correção 7
- [x] AC6: o pedido de Incorporação aceita PDF avulso pelo mesmo upload em partes.

### Correção 12
- [x] AC7: existe a ação de trocar o tipo da maquete (loteamento/casa/prédio) e ela redesenha a maquete.
- [x] AC8: em Casa, o sistema pergunta o tamanho e desenha uma planta padrão básica em todos os lotes, respeitando o
      lote (distribuição automática).
- [x] AC9: em Prédio, o sistema pergunta o tamanho e desenha um prédio padrão, respeitando o lote.
- [x] AC10: `validarModelo` aceita a edificação padrão gerada (não exige edificação lida do PDF nesse caso).
- [x] AC11: o visualizador mostra todas as construções dos lotes (sem o limite de 24), usando repetição leve
      (instancing).
- [x] AC12: o PDF real continua opcional; quando lido, substitui a planta padrão.

## Tarefas
- [x] T1: migração aditiva: coluna de vínculo com lead e novo valor de `fonte` para PDF avulso (nomes definidos na
      implementação). Troca do CHECK `maquetes_3d_origem_alvo_ck` só após a decisão 3.
- [x] T2: servidor — criação por lead, upload avulso, `venda.ts` e `avisos.ts` resolvendo por lead.
- [x] T3: tela — escolha projeto/lead, envio de PDF avulso (projeto e incorporação), rótulo sem duplicar o cliente.
- [x] T4: gerador de casa padrão e de prédio padrão em `shared/maquete-3d/`, com distribuição nos lotes.
- [x] T5: mutation de troca de tipo; ajuste de `validarModelo` e `umaPorLote`.
- [x] T6: instancing no `visualizador/Implantacao.tsx`, retirando o limite de 24.
- [x] T7: suíte, `pnpm check`, `vite build`; aplicar migração aditiva no Neon; HANDOFF.

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
- `drizzle/0115_maquete_3d_lead_arquivos.sql`, `drizzle/schema-maquete-3d.ts` — coluna `lead_id`, nova regra de vínculo e tabela `maquete_3d_arquivos` (aplicada no Neon de produção em 15/11).
- `shared/maquete-3d/padrao.ts` (novo) — casa padrão (térrea e sobrado com escada em U), prédio padrão e distribuição nos lotes.
- `shared/maquete-3d/regras.ts` — fonte de documento `avulso`, limite e escopo do envio.
- `shared/maquete-3d/mobilia.ts` — correção: quarto em que a cama não cabia derrubava o visualizador.
- `server/maquete-3d/router.ts` — `criar` com `leadId`, `clientes`, `documentosDoPedido`, `anexarPdf`, `aplicarTipo`; `base.ts`, `leitura.ts`, `avisos.ts`, `venda.ts`.
- `client/src/pages/admin/AdminMaquete3D.tsx` — novo pedido com cliente do CRM e PDF avulso; painel "Tipo da maquete e construções".
- `client/src/components/maquete-3d/PortalMaquete.tsx` — pedidos sem projeto no portal do cliente.
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx` — todas as construções aparecem (volumes em instâncias; detalhe só perto da câmera).
- Testes: `server/maquete-3d-padrao.test.ts` (novo, 14), `server/maquete-3d.test.ts` (+2).

## Notas da implementação
- Nomes definidos: coluna `maquetes_3d.lead_id`; fonte de documento `avulso`; tabela `maquete_3d_arquivos` (PDF guardado no banco, até 20 MiB).
- A origem continua `projeto` para o pedido por cliente do CRM (é o "Projeto de cliente (pago)" sem projeto cadastrado).
- Quartos pedidos além do que a frente comporta são reduzidos (cada quarto tem ao menos 2,5 m de largura).
- Sobrado exige frente ≥ 6,5 m e fundo ≥ 7,5 m; abaixo disso sai térrea.
- De longe as construções são volumes com telhado; as 12 mais próximas da câmera (até 85 m) aparecem completas.

_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
