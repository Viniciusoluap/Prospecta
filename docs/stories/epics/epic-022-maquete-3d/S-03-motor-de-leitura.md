# S-03 — Motor de leitura do PDF

Status: Done em código e teste com IA simulada (14/11/2026) — **pendente validar com PDF real**.

## Critérios de aceite
- [x] Leitura em passos curtos (um por chamada), para caber no limite de 60 s da função:
      inventário → por pavimento: paredes/aberturas e cômodos/escadas → implantação → montagem.
- [x] Estado gravado a cada passo; passo com erro pode ser repetido sem refazer os anteriores.
- [x] Vários pavimentos com níveis, pé-direito e escadas ligadas ao pavimento de destino.
- [x] Pavimento-tipo (repetições) e implantação (terreno, vias, lotes, posições) cobertos.
- [x] O que o projeto não traz vira "estimada" ou pendência — nada é inventado em silêncio.
- [x] Sem chave da IA, recusa da IA ou PDF grande demais: mensagem clara e nenhum modelo gravado.
- [ ] Validar precisão e tempo por passo com PDFs reais de projetos da Prospecta.

## Arquivos
- `server/maquete-3d/leitura.ts`, `server/maquete-3d/base.ts`
- `server/maquete-3d.test.ts` (bloco "router maquete3d")
