// EPIC-023 (S-E, pedido do dono de 15/11): guarda no banco o último resultado bom de cada camada do mapa do
// terreno (tabela camadas_terreno_cache, migração 0116). Se a tabela ainda não existir ou o banco falhar, a busca
// segue normalmente sem persistência — o mapa nunca deixa de responder por causa disto.
import { and, eq, sql } from "drizzle-orm";
import { camadasTerrenoCache } from "../../../drizzle/schema-camadas-terreno.js";
import type { EstadoCamada, IdCamada } from "../../../shared/geo/camadas-terreno.js";
import { getDb } from "../../db.js";
import type { ArmazemCamadas } from "./camadas-terreno-busca.js";

/** Tabela ainda não criada (migração não aplicada): não insiste até o processo reiniciar. */
let tabelaAusente = false;

function registrarFalha(acao: string, e: unknown) {
  const codigo = (e as { code?: string } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  const texto = e instanceof Error ? e.message : String(e);
  if (codigo === "42P01" || /camadas_terreno_cache.*does not exist|relation .* does not exist/i.test(texto)) {
    if (!tabelaAusente) console.warn("[camadas-terreno] tabela camadas_terreno_cache ausente — seguindo sem persistência (aplicar a migração 0116).");
    tabelaAusente = true;
    return;
  }
  console.warn(`[camadas-terreno] falha ao ${acao} o último resultado bom:`, texto);
}

export const armazemCamadasBanco: ArmazemCamadas = {
  async ler(chave: string, camada: IdCamada) {
    if (tabelaAusente) return null;
    try {
      const [linha] = await getDb().select().from(camadasTerrenoCache)
        .where(and(eq(camadasTerrenoCache.chaveTerreno, chave), eq(camadasTerrenoCache.camada, camada))).limit(1);
      if (!linha) return null;
      return { valor: JSON.parse(linha.dados) as EstadoCamada<unknown>, salvoEm: new Date(linha.salvoEm) };
    } catch (e) {
      registrarFalha("ler", e);
      return null;
    }
  },
  async gravar(chave: string, camada: IdCamada, valor: EstadoCamada<unknown>) {
    if (tabelaAusente || (valor.estado !== "ok" && valor.estado !== "vazio")) return;
    try {
      const linha = { chaveTerreno: chave, camada, estado: valor.estado, fonte: valor.fonte, dados: JSON.stringify(valor) };
      await getDb().insert(camadasTerrenoCache).values(linha).onConflictDoUpdate({
        target: [camadasTerrenoCache.chaveTerreno, camadasTerrenoCache.camada],
        set: { estado: linha.estado, fonte: linha.fonte, dados: linha.dados, salvoEm: sql`now()` },
      });
    } catch (e) {
      registrarFalha("gravar", e);
    }
  },
};
