// Maquete 3D (EPIC-024 S-05) — planta arquitetônica importada na revisão: a planta lida do PDF importado fica como
// CANDIDATA, separada do modelo em uso, até a pessoa escolher o que ela substitui. Função pura (sem banco), usada
// pelo servidor ao aplicar e coberta por teste.
import { ehPadrao, ID_PADRAO } from "./padrao.js";
import { modeloSchema, type Edificacao, type ModeloMaquete, type Pavimento } from "./modelo.js";

/** O que a candidata substitui: a construção padrão (casa/prédio padrão) ou um pavimento de uma construção existente. */
export type DestinoImportacao =
  | { tipo: "padrao" }
  | { tipo: "pavimento"; edificacaoId: string; pavimentoId: string; pavimentoCandidatoId?: string };

export const ROTULOS_ORIGEM_REVISAO: Record<string, string> = {
  anterior: "Planta anterior ao histórico", leitura: "Leitura do PDF", edicao: "Edição na revisão", tipo_padrao: "Troca de tipo / construção padrão",
  implantacao_estudo: "Implantação do estudo", importacao_pdf: "Planta arquitetônica importada", restauracao: "Restauração de versão",
};

export class DestinoInvalido extends Error {}

/** Pavimentos da candidata com ids próprios (`<edificação>-pv<n>`), e as escadas apontando para os novos ids. */
function renomearPavimentos(e: Edificacao, idEd: string): { pavimentos: Pavimento[]; mapa: Map<string, string> } {
  const mapa = new Map(e.pavimentos.map((p, j) => [p.id, `${idEd}-pv${j + 1}`]));
  const pavimentos = e.pavimentos.map(p => ({
    ...p, id: mapa.get(p.id)!,
    escadas: p.escadas.map(s => ({ ...s, destinoPavimentoId: s.destinoPavimentoId ? mapa.get(s.destinoPavimentoId) ?? null : null })),
  }));
  return { pavimentos, mapa };
}

/**
 * Aplica a candidata ao modelo atual. Mantém a implantação (terreno, lotes, ruas) e as posições das construções:
 * as posições da construção padrão passam a apontar para a planta importada, no mesmo lugar e com a mesma rotação.
 * As pendências da candidata entram no modelo (prefixadas), para a pessoa confirmar antes de validar.
 * `idNovo`: id da construção importada (único no modelo). Devolve também o mapa pavimento da candidata → id final.
 */
export function aplicarCandidata(atual: ModeloMaquete, candidata: ModeloMaquete, destino: DestinoImportacao, idNovo: string, nomeDoArquivo: string):
  { modelo: ModeloMaquete; pavimentos: Map<string, string> } {
  const fonte = candidata.edificacoes[0];
  if (!fonte?.pavimentos.length) throw new DestinoInvalido("A planta importada não tem nenhum pavimento para aplicar.");
  const pendencias = [...atual.pendencias];
  const novaPendencia = (descricao: string) => {
    let n = pendencias.length + 1;
    while (pendencias.some(p => p.id === `imp${n}`)) n++;
    pendencias.push({ id: `imp${n}`, descricao: descricao.slice(0, 400), resolvida: false });
  };
  let deOutroPavimento = (_t: string) => false;
  let edificacoes = atual.edificacoes, implantacao = atual.implantacao;
  const mapaFinal = new Map<string, string>();

  if (destino.tipo === "padrao") {
    if (atual.edificacoes.some(e => e.id === idNovo)) throw new DestinoInvalido("Já existe uma construção com este identificador.");
    const i = atual.edificacoes.findIndex(ehPadrao);
    if (i < 0 && atual.edificacoes.length) throw new DestinoInvalido("Esta maquete não tem construção padrão: escolha o pavimento que a planta importada substitui.");
    const { pavimentos, mapa } = renomearPavimentos(fonte, idNovo);
    mapa.forEach((v, k) => mapaFinal.set(k, v));
    const nova: Edificacao = { ...fonte, id: idNovo, nome: `Projeto importado — ${nomeDoArquivo}`.slice(0, 80), pavimentos };
    edificacoes = i < 0 ? [nova] : atual.edificacoes.map((e, k) => (k === i ? nova : e));
    if (implantacao) implantacao = { ...implantacao, posicoes: implantacao.posicoes.map(p => (p.edificacaoId === ID_PADRAO ? { ...p, edificacaoId: idNovo } : p)) };
  } else {
    const ed = atual.edificacoes.find(e => e.id === destino.edificacaoId);
    const alvo = ed?.pavimentos.find(p => p.id === destino.pavimentoId);
    if (!ed || !alvo) throw new DestinoInvalido("O pavimento escolhido não existe mais na planta. Recarregue a página.");
    const origem = destino.pavimentoCandidatoId ? fonte.pavimentos.find(p => p.id === destino.pavimentoCandidatoId) : fonte.pavimentos[0];
    if (!origem) throw new DestinoInvalido("O pavimento escolhido da planta importada não existe.");
    // A escada leva ao pavimento logo acima do substituído, na construção existente.
    const acima = [...ed.pavimentos].filter(p => p.nivel > alvo.nivel).sort((a, b) => a.nivel - b.nivel)[0];
    const novo: Pavimento = {
      ...alvo, paredes: origem.paredes, aberturas: origem.aberturas, comodos: origem.comodos,
      escadas: origem.escadas.map(s => ({ ...s, destinoPavimentoId: s.destinoPavimentoId && acima ? acima.id : null })),
    };
    mapaFinal.set(origem.id, alvo.id);
    // Só as pendências deste pavimento (a montagem prefixa cada uma com o nome do pavimento) e as gerais.
    const outros = fonte.pavimentos.filter(p => p.id !== origem.id).map(p => `${p.nome}:`);
    deOutroPavimento = t => outros.some(o => t.startsWith(o));
    edificacoes = atual.edificacoes.map(e => (e.id === ed.id ? { ...e, pavimentos: e.pavimentos.map(p => (p.id === alvo.id ? novo : p)) } : e));
  }
  for (const p of candidata.pendencias.filter(x => !x.resolvida && !deOutroPavimento(x.descricao))) novaPendencia(`Planta importada: ${p.descricao}`);
  return { modelo: modeloSchema.parse({ ...atual, edificacoes, implantacao, pendencias: pendencias.slice(0, 200) }), pavimentos: mapaFinal };
}
