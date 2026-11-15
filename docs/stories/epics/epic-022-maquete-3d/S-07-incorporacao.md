# S-07 — Maquete 3D na Incorporação: loteamento, condomínio e prédio (etapa 4)

Status: Done em código (15/11/2026) — conferido em navegador automatizado com dados de exemplo; **pendente validar com um estudo real**.

## Critérios de aceite
- [x] Aba "Maquete 3D" dentro do estudo de Incorporação: pedir (loteamento, condomínio ou prédio), ver a situação e abrir o pedido.
- [x] Sem cobrança; nasce "aguardando autorização" e só o administrador autoriza.
- [x] Implantação montada direto do estudo, sem IA e sem PDF: divisa do terreno (KML/GeoJSON) e ruas e lotes do
      cenário escolhido do estudo de massa, convertidos para metros, com o norte para cima.
- [x] Cada lote vendável é ligado à unidade do inventário pelo código (`Q<quadra> / L<lote>`); o visualizador
      colore por situação (disponível, reservado, vendido), mostra a contagem e, ao tocar no lote, a área e a situação.
- [x] O link público leva só código e situação das unidades (nada de comprador nem de preço).
- [x] Loteamento valida e publica sem PDF. Atualizar a implantação a partir do estudo mantém as edificações já lidas;
      reler os PDFs mantém a implantação vinda do estudo.
- [x] Condomínio: construções posicionadas na implantação (até 24 desenhadas) e a casa-tipo navegável por dentro.
- [x] Prédio: pavimento-tipo repetido e empilhado, com o apartamento-tipo navegável (vem da leitura do PDF).
- [x] (S-08) Tela para posicionar as casas do condomínio à mão, em fila ou uma por lote.
- [ ] Terreno, ruas e lotes não são editáveis na revisão (vêm do estudo); as construções são.
- [ ] Prédio é um bloco por edificação, sem elevador, garagem em subsolo ou áreas comuns modeladas.
- [x] (S-08) A implantação acompanha a topografia do estudo.

## Arquivos
- `shared/maquete-3d/implantacao.ts`, `shared/maquete-3d/modelo.ts` (ruas em polígono, tipo do lote)
- `server/maquete-3d/router.ts` (`implantacaoDoEstudo`, `unidadesDoEstudo`), `server/maquete-3d/leitura.ts`
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx`, `Visualizador.tsx`, `Navegacao.tsx`
- `client/src/components/incorporacao/estudo/maquete-3d-tab.tsx`, `incorporacao-detail.tsx`
- `client/src/pages/admin/AdminMaquete3D.tsx`, `client/src/pages/MaquetePublica.tsx`
