// Catálogo completo dos móveis paramétricos.
import type { CatalogoMoveis } from "./tipos";
import { MOVEIS_ESTAR } from "./estar";
import { MOVEIS_INTIMO_SERVICO } from "./intimo-servico";

import { MOVEIS_GARAGEM } from "./garagem";

export const CATALOGO: CatalogoMoveis = { ...MOVEIS_ESTAR, ...MOVEIS_INTIMO_SERVICO, ...MOVEIS_GARAGEM };
