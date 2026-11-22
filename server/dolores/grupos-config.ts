// EPIC-027 C5 (E2) — configuração da resposta da Dolores num grupo (interruptor "responder quando marcada" de UM grupo), pelo
// pedido do DONO na conversa dele, depois do "pode"/"confirmo" reconhecido por código (server/dolores/pendencia.ts). As regras de
// quando dá para LIGAR são as mesmas da tela (server/dolores/grupos-router.ts, `ligarMarcacaoGrupo`): grupo ativo, aceito (não
// recusado nem esperando o dono) e de tipo conhecido. Nunca mexe no interruptor GERAL (esse continua só na tela, do admin).
import { doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { precisaDoAceiteDoDono, tipoEfetivo } from "../../shared/dolores/grupos-tipo.js";
import { getDb } from "../db.js";

type GrupoParaLigar = { ativo: boolean; tipo?: string | null; leadId: number | null; obraId: number | null; origem?: string | null;
  situacaoConfirmacao?: string | null; adicionadoPor?: string | null; provaAdicao?: string | null; obraExcluidaEm?: Date | null };

/** Por que a resposta NÃO pode ser ligada neste grupo (null = pode). Desligar sempre pode. Mesmas regras da tela. */
export function motivoParaNaoLigar(g: GrupoParaLigar): string | null {
  if (!g.ativo) return "o grupo está desativado";
  if (precisaDoAceiteDoDono(g)) return "o grupo ainda espera você aceitar (ou dizer o tipo)";
  if (tipoEfetivo(g) === "indefinido") return "ainda não sei de que tipo é o grupo";
  if (g.obraExcluidaEm) return "a obra deste grupo foi excluída no CRM; diga de novo de qual obra ele é";
  return null;
}

/** Grava o interruptor de UM grupo (nunca o geral). `porUserId`: null = pedido do dono pelo WhatsApp. */
export async function definirRespostaDoGrupo(grupoId: number, ligado: boolean, porUserId: number | null): Promise<void> {
  await getDb().insert(doloresMarcacoesGrupo).values({ grupoId, responderLigado: ligado, atualizadoPor: porUserId })
    .onConflictDoUpdate({ target: doloresMarcacoesGrupo.grupoId, set: { responderLigado: ligado, atualizadoEm: new Date(), atualizadoPor: porUserId } });
}
