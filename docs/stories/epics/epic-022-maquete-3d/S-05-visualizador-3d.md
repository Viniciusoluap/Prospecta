# S-05 — Visualizador 3D, mobília paramétrica e link do cliente (etapa 2)

Status: Done em código (15/11/2026) — conferido em navegador automatizado; **pendente validar em aparelhos reais**.

## Critérios de aceite
- [x] Casa em 3D a partir do modelo validado: pisos por tipo de ambiente, paredes recortadas pelas aberturas,
      esquadrias com vidro, portas, lajes com o furo da escada, escada e cobertura (laje, platibanda, uma, duas e quatro águas).
- [x] Vários pavimentos: sobe e desce a escada andando; pavimento-tipo repetido (prédio) empilhado.
- [x] Visão por fora (girar/aproximar), por dentro (caminhar com colisão) e vista de cima com escolha do andar; ocultar telhado.
- [x] Mobília gerada pelo motor (34 tipos de peça), por função do cômodo, sem bloquear portas nem sobrepor móveis.
      Nenhum modelo ou textura externo: geometria e texturas feitas por código.
- [x] Três estilos trocados com um clique (Moderno, Escandinavo, Luxo aconchegante), sem mudar a arquitetura.
- [x] Horário contínuo manhã → pôr do sol → noite: sol, céu, sombras e luminárias acesas à noite.
- [x] Tour automático pelas portas e escadas, com pausa e panorâmica em cada cômodo, nome, área e destaque
      comprovado pelo projeto; pausar, continuar, reiniciar; vista de cima no fim. Trilha gerada por código, com botão de som.
- [x] Tela de apresentação (nome, localização, área, quartos, banheiros, vagas, preço se informado; Explorar,
      Iniciar tour, Falar com consultor pelo WhatsApp). Dado não informado não aparece.
- [x] Menu, tela cheia, voltar à entrada, ambiente atual, miniatura da planta, joystick e toque no celular,
      três níveis de qualidade gráfica.
- [x] Publicação pelo admin: link público `/maquete/<token>`; tirar do ar; prévia para a equipe antes de publicar.
- [x] (S-08) Escadas em L, em U e caracol com a forma real.
- [x] (S-08) Carro na garagem. Implantação (condomínio/loteamento) ainda não é desenhada em 3D (etapa 4).

## Arquivos
- `shared/maquete-3d/geometria3d.ts`, `shared/maquete-3d/mobilia.ts`, `server/maquete-3d-visualizador.test.ts`
- `client/src/components/maquete-3d/visualizador/` (`Visualizador`, `Casa`, `Mobilia`, `Ceu`, `Navegacao`, `materiais`, `som`, `moveis/`)
- `client/src/pages/MaquetePublica.tsx`, `client/src/pages/admin/AdminMaquete3D.tsx`, `client/src/App.tsx`
- `drizzle/0112_maquete_3d_comercial.sql`, `server/maquete-3d/router.ts` (`salvarComercial`, `publicar`, `despublicar`, `maquetePublica.porToken`)
- `vite.config.ts` (o plugin `data-loc` não entra na cena 3D: quebrava ao trocar de estilo)
