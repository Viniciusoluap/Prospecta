// Maquete 3D (EPIC-022, etapa 2) — posiciona na cena os móveis decididos pelo motor de mobília e acende as
// luminárias à noite. O desenho de cada móvel vem do catálogo paramétrico (moveis/).
import { useMemo } from "react";
import type { Edificacao } from "@shared/maquete-3d/modelo";
import { ESPESSURA_LAJE, pavimentosOrdenados } from "@shared/maquete-3d/geometria3d";
import { mobiliarPavimento, pecasDoPavimento, type PecaMobilia } from "@shared/maquete-3d/mobilia";
import { corDaLuz, type Estilo, type Materiais } from "./materiais";
import { CATALOGO } from "./moveis";

export type PecaNaCena = PecaMobilia & { y: number; chave: string };

/**
 * Toda a mobília da edificação, com a altura do andar (pavimento-tipo repete a mesma mobília em cada andar).
 * EPIC-028: quando a maquete tem itens gravados (ex.: os `itens` do JSON-fonte, `pecasDaFonte`), eles SUBSTITUEM a
 * mobília automática; sem itens, nada muda.
 */
export function mobiliaDaEdificacao(e: Edificacao, itens?: (PecaMobilia & { y: number })[] | null): PecaNaCena[] {
  if (itens && itens.length) return pecasDoPavimento(pavimentosOrdenados(e)[0], itens).map(p => ({ ...(p as PecaMobilia & { y: number }), chave: `item-${p.id}` }));
  return pavimentosOrdenados(e).flatMap(pv => {
    const pecas = mobiliarPavimento(pv);
    return Array.from({ length: pv.repeticoes }, (_, k) => pecas.map(p => ({ ...p, y: pv.nivel + k * (pv.peDireito + ESPESSURA_LAJE), chave: `${pv.id}-${k}-${p.id}` }))).flat();
  });
}

export function Mobilia({ pecas, m, estilo, noite, luzesAte, corteAte, aprimorado = false }: {
  /** Modo aprimorado: os móveis desenham a versão detalhada. */
  aprimorado?: boolean;
  pecas: PecaNaCena[]; m: Materiais; estilo: Estilo;
  /** 0 = dia, 1 = noite: liga as luzes das luminárias. */
  noite: number;
  /** Quantas luminárias viram luz de verdade (o resto só brilha): limite por desempenho. */
  luzesAte: number;
  corteAte: number | null;
}) {
  const visiveis = useMemo(() => (corteAte === null ? pecas : pecas.filter(p => p.y <= corteAte + 0.01)), [pecas, corteAte]);
  const luminarias = useMemo(() => visiveis.filter(p => p.tipo === "plafon" || p.tipo === "pendente").slice(0, luzesAte), [visiveis, luzesAte]);
  const cor = corDaLuz(estilo);
  return (
    <group>
      {visiveis.map(p => {
        const Desenho = CATALOGO[p.tipo];
        return Desenho ? (
          <group key={p.chave} position={[p.x, p.y + p.elevacao, p.z]} rotation={[0, p.rot, 0]}>
            <Desenho peca={p} m={m} estilo={estilo} aprimorado={aprimorado} />
          </group>
        ) : null;
      })}
      {noite > 0.25 && luminarias.map(p => (
        <pointLight key={p.chave} position={[p.x, p.y + p.elevacao - 0.15, p.z]} color={cor} intensity={noite * 9} distance={9} decay={1.6} />
      ))}
    </group>
  );
}
