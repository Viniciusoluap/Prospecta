// Endereço da Avaliação × endereço do lead (regra do dono, 17/11/2026 — "sempre vindo do lead, mas com a possibilidade
// de edição na avaliação, isso para os dois"). A regra fica em shared/lead-snapshot.ts (enderecoDaAvaliacaoAposLead);
// aqui só a gravação: quando o endereço do lead muda, cada avaliação vinculada recebe só os campos que ainda seguem o
// lead (igual ao endereço antigo do lead, vazio ou "A definir"). Edição manual na avaliação é preservada.
import { enderecoDaAvaliacaoAposLead, type EnderecoDaAvaliacao, type LeadContactSource } from "../shared/lead-snapshot.js";
import * as db from "./db.js";

type EnderecoDoLead = Pick<LeadContactSource, "address" | "neighborhood" | "city" | "state">;
export type OperacoesDoEndereco = {
  listar: (leadId: number) => Promise<Array<EnderecoDaAvaliacao & { id: number }>>;
  gravar: (id: number, dados: Partial<EnderecoDaAvaliacao>) => Promise<void>;
};

const operacoesPadrao: OperacoesDoEndereco = {
  listar: leadId => db.getAvaliacoesEnderecoDoLead(leadId),
  gravar: (id, dados) => db.updateAvaliacao(id, dados),
};

/** Devolve quantas avaliações foram atualizadas. */
export async function propagarEnderecoDoLeadParaAvaliacoes(
  leadId: number, antes: EnderecoDoLead, depois: EnderecoDoLead, ops: OperacoesDoEndereco = operacoesPadrao,
): Promise<number> {
  let atualizadas = 0;
  for (const a of await ops.listar(leadId)) {
    const patch = enderecoDaAvaliacaoAposLead(a, antes, depois);
    if (Object.keys(patch).length === 0) continue;
    await ops.gravar(a.id, patch);
    atualizadas++;
  }
  return atualizadas;
}
