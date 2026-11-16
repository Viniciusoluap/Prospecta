// S-I (EPIC-023): regra de gravação do contorno da APP no estudo (`incorporation_studies.app_geometry_json`).
// Área e contorno andam juntos: o Estudo de Massa nunca pode usar um contorno que não corresponde à área nem ao
// terreno atual.

/**
 * Valor da coluna do contorno ao gravar a APP: string = grava; null = apaga; undefined = mantém o que está gravado.
 * `contorno` explícito (objeto ou null) manda. Sem o campo (cliente antigo, em cache), o contorno gravado continua —
 * a não ser que a área mude mais de 2%: aí ele está velho e é apagado.
 */
export function contornoAoSalvarApp(input: { areaM2: number; contorno?: unknown }, areaAnteriorM2: number | null | undefined): string | null | undefined {
  if (!(input.areaM2 > 0)) return null;
  if (input.contorno === null) return null;
  if (input.contorno !== undefined) return JSON.stringify(input.contorno);
  const antes = Number(areaAnteriorM2 ?? 0);
  return Math.abs(input.areaM2 - antes) > 0.02 * Math.max(antes, 1) ? null : undefined;
}

/** Campos do estudo limpos quando o terreno (KML) é trocado: o contorno da APP era do terreno anterior. */
export const CAMPOS_LIMPOS_AO_TROCAR_TERRENO = { appGeometryJson: null } as const;
