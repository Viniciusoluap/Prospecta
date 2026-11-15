# S-04 — Painel Maquete 3D e tela de revisão

Status: Done em código (14/11/2026) — conferido no navegador com banco em memória e IA simulada; **pendente validar em produção**.

## Critérios de aceite
- [x] Bloco "Maquete 3D" no Painel Administrativo e rotas `/admin/maquete-3d` e `/admin/maquete-3d/:id`.
- [x] Lista com situação, origem, preço e resumo; novo pedido a partir de projeto ou estudo, escolhendo os PDFs.
- [x] Preços padrão (e modelo/esforço da IA) editáveis só pelo admin.
- [x] Liberar/autorizar, recusar e excluir (admin).
- [x] Leitura com barra de progresso por passo e repetição do passo com erro.
- [x] Revisão: planta desenhada por pavimento; edição de paredes, aberturas, cômodos, escadas, níveis, cobertura e
      pendências; medida estimada tracejada com botão de confirmar; lista de erros e avisos; salvar e validar.
- [x] Prancha original do PDF ao fundo da planta, com transparência, largura e posição ajustáveis (guardadas no navegador).
- [ ] Edição da implantação (lotes, vias, posições): hoje só visualização — entra com a etapa 4.

## Arquivos
- `client/src/pages/admin/AdminMaquete3D.tsx`
- `client/src/components/maquete-3d/EditorPlanta.tsx`, `client/src/components/maquete-3d/fundo-pdf.ts`
- `client/src/App.tsx`, `client/src/pages/Admin.tsx`, `client/src/components/GlobalBackButton.tsx`
- `server/maquete-3d/router.ts` (`pdfParte`, `pranchas` no detalhe), `server/admin-permissions.test.ts`
- `package.json` (`pdfjs-dist`)
