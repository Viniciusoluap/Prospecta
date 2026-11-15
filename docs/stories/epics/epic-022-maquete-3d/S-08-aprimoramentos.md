# S-08 — Aprimoramentos pedidos pelo dono em 15/11/2026

Status: Done em código (15/11/2026) — conferido em navegador automatizado; **pendente validar em aparelhos e dados reais**.

Origem: resposta do dono à lista de limitações das etapas 2 a 4.

## Critérios de aceite
- [x] **Aprimorador da mobília**: botão "Aprimorar" no visualizador (fica guardado no aparelho) que liga oclusão de
      ambiente, brilho das luzes, suavização de serrilhado, sombras no máximo, mais luminárias acesas e a versão
      detalhada de todos os móveis (`aprimorado` em `moveis/tipos.ts`). Vale para toda maquete, atual ou futura.
      Botão "Baixar foto em alta desta vista" (PNG com até o triplo dos pixels).
- [x] **Escadas fiéis**: em L (dois lances e patamar na quina), em U (dois lances paralelos e patamar no fundo) e
      caracol (degraus em torno do mastro). O desenho, a altura de quem sobe andando e o trajeto do tour seguem a
      mesma forma (`shared/maquete-3d/escadas.ts`). A leitura do PDF pede o tipo e o caminho; o editor mostra o caminho.
- [x] **Carro na garagem**: gerado por código (`moveis/garagem.tsx`), um por vaga simples e dois quando cabem.
- [x] **Condomínio**: tela para posicionar construções à mão na implantação — adicionar, arrastar, girar, trocar o
      modelo, repetir em fila (quantidade, distância, direção), "uma em cada lote" e remover. As posições são
      mantidas quando a implantação é atualizada pelo estudo.
- [x] **Topografia**: a implantação segue o relevo do estudo (`elevation_json`): terreno em malha com o mapa de
      ruas e lotes pintado por cima, construções assentadas na cota do terreno. Sem topografia no estudo, fica plano e avisa.
- [x] **Preço**: o pedido do cliente no portal nasce "aguardando aprovação"; o administrador confere a faixa da
      tabela (pode corrigir) e aprova; só então o cliente paga pelo Asaas e o sistema recebe.
- [x] **E-mail automático**: ao aprovar (valor e caminho para pagar) e ao publicar (link da maquete). Destinatário:
      quem pediu no portal ou, se o pedido foi criado pela equipe, o e-mail do cadastro do projeto. O resultado do
      envio aparece na tela; há "Reenviar o e-mail com o link". O botão do WhatsApp continua.
- [ ] Estorno segue manual no Asaas (decisão do dono: "Ok").
- [ ] O relevo entra só na implantação; a casa vista sozinha continua em terreno plano.
- [ ] As construções são assentadas na cota do canto de origem, sem corte/aterro do platô.

## Arquivos
- `shared/maquete-3d/escadas.ts`, `geometria3d.ts`, `modelo.ts` (percurso da escada, relevo), `implantacao.ts`, `mobilia.ts`, `regras.ts`
- `server/maquete-3d/avisos.ts`, `venda.ts`, `router.ts` (`aprovarPedido`, `reenviarEmail`), `base.ts`, `leitura.ts`
- `drizzle/0114_maquete_3d_email.sql`, `drizzle/schema.ts`
- `client/src/components/maquete-3d/visualizador/Aprimorado.tsx`, `Implantacao.tsx`, `Casa.tsx`, `Visualizador.tsx`, `Mobilia.tsx`, `moveis/`
- `client/src/components/maquete-3d/EditorPlanta.tsx`, `PortalMaquete.tsx`, `client/src/pages/admin/AdminMaquete3D.tsx`
