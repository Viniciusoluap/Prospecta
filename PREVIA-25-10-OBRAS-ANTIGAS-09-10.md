# Prévia — obras antigas: coordenadas da PCI (09) e vínculo no catálogo (10)

Gerada em 25/10/2026 por consulta **somente leitura** ao Neon `plain-cake-26372935` (produção).
Coordenadas convertidas com a própria função do sistema (`shared/obra-localizacao.ts › coordenadasDaPci`).
**Nada foi gravado.** Aplicar só com aprovação do dono, grupo por grupo.

O que "aplicar" faz (mesma rotina da tela Editar Obra › Localização exata — `salvarLocalizacaoObra`):
cria um imóvel **não publicado** (status "reservado", preço 0, fora do site), vincula à obra e grava o ponto.
Reversível: apagar o imóvel criado (slug `obra-<id>-…`) desfaz o vínculo (`imovel_id` volta a nulo).

## Grupo A — coordenada única e coerente com o endereço (recomendo aplicar)
| Obra | Cliente | Endereço | Ponto (lat, lng) |
|---|---|---|---|
| 16 | JESSE WILKESON | Residencial Aurora | -5.488889, -47.450278 |
| 17 | FELIPE SOUSA | Morada do Bosque | -5.508444, -47.444778 |
| 21 | JOAO FLAVIO | Rua México, Jardim América | -5.496667, -47.444722 |
| 23 | SILMARA MACIEL | Morada do Bosque | -5.508333, -47.444694 |
| 24 | ALINE CRISTINA | Residencial Aurora | -5.488333, -47.450556 |
| 25 | SHEILLA SILVA | Parque Alvorada II | -5.535000, -47.446667 |
| 28 | LUCIA BRENA | Residencial Aurora | -5.488333, -47.450278 |
| 31 | MARIANA TORRES | Parque São José | -5.483917, -47.490028 |
| 32 | D'ANNE ALMEIDA | Morada do Bosque | -5.507917, -47.444528 |
| 35 | MARCELO DA SILVA | Lot. Guilherme Amorim, Ribeirãozinho | -5.756111, -47.371111 |
| 36 | JEFFERSON SILVA | Morada do Bosque | -5.508222, -47.446194 |

## Grupo B — mesmo ponto em mais de uma obra (Residencial Aurora; PCI com ponto de referência do loteamento)
No mapa os marcadores ficam sobrepostos. Aplicar mesmo assim, ou deixar para ajustar o ponto exato na tela de cada obra.
| Ponto | Obras |
|---|---|
| -5.488611, -47.450556 | 13 MARIA DAYANE, 14 LUCIANO |
| -5.488889, -47.450556 | 15 MAYKON, 20 ADHARA, 27 CARINE |

## Grupo C — suspeita (NÃO aplicar sem conferir)
| Obra | Cliente | Problema |
|---|---|---|
| 19 | EMILY VICTORIA | Endereço em **Bom Jesus das Selvas**, mas a PCI traz o ponto do Residencial Aurora (Imperatriz, ~100 km). Provável PCI copiada. |

## Já resolvida
- 18 MYLCA — já tem imóvel vinculado com ponto salvo.

## Item 10 — obras com endereço e sem imóvel, sem coordenada na PCI
Vincular cria imóvel interno não publicado (só aparece no catálogo administrativo; nada vai ao site):
- Endereço específico: 1 KEILANE (Rua dos Jasmins, lote 18), 48 MARCIO (R. Porto Franco, 319), 49 PEDRO (Av. das Águias, Qd D, Lt 23),
  53 JEOVA, 54 VILDE, 55 RITA, 56 LUZIA (Morada do Bosque).
- Endereço genérico "Imperatriz/MA" (vínculo pouco útil — sugiro esperar endereço real): 50 LILIAN, 51 RAILLANE, 52 KALLYNE.
- Fora: 7 YANN (sem endereço) e 57 "Teste" (obra de teste).

## Grupo Santa Fé
Supabase `giulchozonhzyopmgmkv`: só 2 obras (Alessandra Bernardo, Joelson da Cruz), endereço "A definir" e sem PCI. **Nada a aplicar.**

## Decisão pedida ao dono
1. Grupo A (11 obras): aplicar? 2. Grupo B (5 obras): aplicar com ponto repetido? 3. Grupo C: conferir a PCI da Emily.
4. Item 10: vincular as 7 obras com endereço específico? (as 3 genéricas ficam para depois)

## APLICADO em 25/10 (autorizado pelo dono: grupos A e B)
- 16 obras (13, 14, 15, 16, 17, 20, 21, 23, 24, 25, 27, 28, 31, 32, 35, 36) ganharam imóvel **não publicado** (status reservado,
  preço 0, slug `obra-<id>-…`) com o ponto da PCI e vínculo `construction_projects.imovel_id` — imóveis 6–21. Conferido: 0 imóveis soltos.
- Emily (19): **não** aplicado — o dono preenche manualmente. Obras sem coordenada na PCI: ficam sem vínculo; o dono preenche.
- Para desfazer uma obra: apagar o imóvel `obra-<id>-…` correspondente (o vínculo volta a nulo).
