// Maquete 3D (EPIC-022, etapa 2) — contrato dos móveis paramétricos. Cada móvel é um componente que desenha a
// peça no seu referencial local; quem posiciona, gira e eleva é o visualizador (Mobilia.tsx).
//
// Referencial local de TODO móvel:
//   - origem no centro da base (no piso do móvel): y = 0 embaixo, y = peca.altura em cima;
//   - largura ao longo de X (de -largura/2 a +largura/2);
//   - profundidade ao longo de Z (de -profundidade/2 a +profundidade/2);
//   - as COSTAS ficam em -Z (encostadas na parede) e a FRENTE em +Z (voltada para o cômodo).
// O móvel deve caber exatamente na caixa largura × altura × profundidade da peça.
import type { ReactElement } from "react";
import type { PecaMobilia, TipoMovel } from "@shared/maquete-3d/mobilia";
import type { Estilo, Materiais } from "../materiais";

export type PropsMovel = { peca: PecaMobilia; m: Materiais; estilo: Estilo };
export type DesenhoMovel = (p: PropsMovel) => ReactElement | null;
export type CatalogoMoveis = Partial<Record<TipoMovel, DesenhoMovel>>;
