// Maquete 3D (EPIC-028, Etapa 3) — catálogo procedural: adiciona um item novo, com as medidas padrão, no centro do
// ambiente escolhido (depois é só arrastar). Os desenhos são os do catálogo de móveis em código (sem arquivo externo).
import { useId } from "react";
import type { TipoMovel } from "@shared/maquete-3d/mobilia";
import { TIPOS_MOVEL } from "@shared/maquete-3d/mobilia";
import { CATALOGO_ITENS, ROTULOS_GRUPO, rotuloDoTipo, type GrupoItem } from "@shared/maquete-3d/edicao";
import { fmtM } from "@shared/maquete-3d/planta2d";
import { botao, campo } from "./PainelItem";

const GRUPOS = Object.keys(ROTULOS_GRUPO) as GrupoItem[];

export function Catalogo({ ambientes, ambiente, aoEscolherAmbiente, aoAdicionar }: {
  ambientes: string[]; ambiente: string; aoEscolherAmbiente: (a: string) => void; aoAdicionar: (t: TipoMovel) => void;
}) {
  const id = useId();
  return (
    <section aria-label="Catálogo de itens" className="grid gap-3" data-teste="catalogo">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="m-0 text-[17px] font-medium">Adicionar item</h3>
        <div className="min-w-[200px] flex-1 sm:max-w-[260px]">
          <label htmlFor={id} className="mb-1 block text-[13px] text-[#55554F]">No ambiente</label>
          <select id={id} className={campo} value={ambiente} onChange={e => aoEscolherAmbiente(e.target.value)}>
            {ambientes.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      {GRUPOS.map(g => {
        const tipos = TIPOS_MOVEL.filter(t => CATALOGO_ITENS[t].grupo === g && CATALOGO_ITENS[t].noCatalogo);
        if (!tipos.length) return null;
        return (
          <div key={g}>
            <h4 className="m-0 mb-1.5 text-[13px] font-normal text-[#6B6B66]">{ROTULOS_GRUPO[g]}</h4>
            <div className="flex flex-wrap gap-2">
              {tipos.map(t => {
                const p = CATALOGO_ITENS[t];
                return (
                  <button key={t} type="button" className={`${botao} flex-col !items-start !gap-0 py-1.5 text-left`} onClick={() => aoAdicionar(t)}
                    aria-label={`Adicionar ${rotuloDoTipo(t)} (${fmtM(p.larg)} × ${fmtM(p.prof)} × ${fmtM(p.alt)} m) em ${ambiente}`}>
                    <span>{rotuloDoTipo(t)}</span>
                    <span className="text-[12px] tabular-nums text-[#6B6B66]">{fmtM(p.larg)} × {fmtM(p.prof)} × {fmtM(p.alt)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
