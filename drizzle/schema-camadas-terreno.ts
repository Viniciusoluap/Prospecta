// 15/11/2026 — EPIC-023 (S-E): último resultado bom de cada camada do mapa do terreno, por terreno
// (migração 0116_camadas_terreno_cache.sql). Arquivo separado de schema.ts para não colidir com outras frentes.
// Chave = chaveDoTerreno(contorno) + id da camada; `dados` guarda o EstadoCamada inteiro em JSON.
import { pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const camadasTerrenoCache = pgTable("camadas_terreno_cache", {
  chaveTerreno: varchar("chave_terreno", { length: 160 }).notNull(),
  camada: varchar("camada", { length: 30 }).notNull(),
  estado: varchar("estado", { length: 20 }).notNull(),
  fonte: text("fonte").notNull(),
  dados: text("dados").notNull(),
  salvoEm: timestamp("salvo_em").defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.chaveTerreno, t.camada] })]);

export type CamadaTerrenoCache = typeof camadasTerrenoCache.$inferSelect;
