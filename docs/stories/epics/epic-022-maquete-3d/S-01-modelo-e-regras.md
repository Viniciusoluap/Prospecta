# S-01 — Modelo em três camadas e regras de negócio

Status: Done (14/11/2026)

## Critérios de aceite
- [x] Um único modelo representa casa térrea, sobrado, prédio, condomínio e loteamento.
- [x] Toda medida registra se foi confirmada por cota ou estimada.
- [x] Validação separa erro (impede publicar) de aviso; pendência em aberto é erro.
- [x] Resumo comercial (área, quartos, suítes, banheiros, vagas) calculado só do que o modelo comprova.
- [x] Preços padrão aprovados (197 / 297 / 497) e faixa pela área e pelo número de pavimentos.

## Arquivos
- `shared/maquete-3d/modelo.ts`
- `shared/maquete-3d/regras.ts`
- `server/maquete-3d.test.ts` (bloco "modelo e regras")
