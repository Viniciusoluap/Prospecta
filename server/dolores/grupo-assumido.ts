// EPIC-027 C2 — "Assumir (humano)" por GRUPO, pela Central WhatsApp (whatsapp_grupo_atendimento, migração 0142). Grupo assumido
// pela equipe: a Dolores não responde nele nem quando é marcada, até alguém devolver. Só CALA: esta tabela nunca liga interruptor.
// Tabela ainda inexistente (código publicado antes da 0142; 42P01) → ninguém assumiu ainda: regra de sempre (não cala todos os grupos).
// Outra falha ao ler (banco fora do ar) → trata como assumido (calada): na dúvida, ela não fala no grupo.
import { eq } from "drizzle-orm";
import { whatsappGrupoAtendimento } from "../../drizzle/schema-whatsapp-grupos.js";
import { getDb } from "../db.js";
import { ehTabelaInexistente } from "./erro-de-banco.js";
import { erroParaLog } from "./erro-seguro.js";

export async function grupoAssumidoPelaEquipe(grupoId: number): Promise<boolean> {
  try {
    const [l] = await getDb().select({ modo: whatsappGrupoAtendimento.modo }).from(whatsappGrupoAtendimento)
      .where(eq(whatsappGrupoAtendimento.grupoId, grupoId)).limit(1);
    return l?.modo === "humano";
  } catch (e) {
    if (ehTabelaInexistente(e)) return false;
    console.error("[dolores/grupo-assumido] não consegui conferir se a equipe assumiu o grupo (fica calada)", erroParaLog(e));
    return true;
  }
}
