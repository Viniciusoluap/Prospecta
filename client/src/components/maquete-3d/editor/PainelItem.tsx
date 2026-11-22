// Maquete 3D (EPIC-028, Etapa 3) — painel de campos do item selecionado: tipo (dentro do grupo), ambiente, X, Z,
// rotação (botões de 90° e 15°), largura, profundidade, altura, material e cor. Campos de 16 px e alvos de 44 px
// (celular). Mudou o campo → o 3D muda na hora; mexeu no 3D → o campo mostra o valor novo.
import { useEffect, useId, useRef, useState } from "react";
import type { ItemFonte } from "@shared/maquete-3d/fonte";
import type { TipoMovel } from "@shared/maquete-3d/mobilia";
import { LIMITES_EDICAO, MATERIAIS_ITEM, ROTULOS_MATERIAL, COR_HEX, grupoDoTipo, rotuloDoTipo, tiposDoGrupo } from "@shared/maquete-3d/edicao";
import { fmtM } from "@shared/maquete-3d/planta2d";

export const campo = "min-h-[44px] w-full rounded border border-[#CFCFCA] bg-white px-3 text-[16px] text-[#111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#111] disabled:bg-[#F4F4F1] disabled:text-[#6B6B66]";
export const botao = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded border border-[#CFCFCA] bg-white px-3 text-[15px] text-[#111] transition-colors hover:bg-[#F4F4F1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111] disabled:cursor-not-allowed disabled:opacity-45";
const rotulo = "mb-1 block text-[13px] text-[#55554F]";

const lerNumero = (t: string) => { const n = Number(t.trim().replace(",", ".")); return t.trim() !== "" && Number.isFinite(n) ? n : null; };

/** Campo numérico que aceita vírgula; aplica a cada tecla válida e volta ao valor certo ao sair do campo. */
function CampoNumero({ id, rot, valor, casas, unidade, min, max, aoMudar, desligado }: {
  id: string; rot: string; valor: number; casas: number; unidade: string; min: number; max: number; aoMudar: (v: number) => void; desligado?: boolean;
}) {
  const fmt = (v: number) => fmtM(v, casas);
  const [texto, setTexto] = useState(fmt(valor));
  const focado = useRef(false);
  useEffect(() => { if (!focado.current) setTexto(fmt(valor)); }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = lerNumero(texto), invalido = n === null || n < min || n > max;
  return (
    <div>
      <label htmlFor={id} className={rotulo}>{rot} <span className="text-[#8A8A84]">({unidade})</span></label>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" className={`${campo} tabular-nums ${invalido ? "border-[#D92D20]" : ""}`}
        value={texto} disabled={desligado} aria-invalid={invalido}
        onFocus={() => { focado.current = true; }}
        onBlur={() => { focado.current = false; setTexto(fmt(valor)); }}
        onChange={e => { setTexto(e.target.value); const v = lerNumero(e.target.value); if (v !== null && v >= min && v <= max) aoMudar(v); }} />
    </div>
  );
}

export function PainelItem({ item, ambientes, aoMudar, aoGirar, aoConverter, aoRemover }: {
  item: ItemFonte;
  ambientes: string[];
  aoMudar: (m: Partial<ItemFonte>, campo: string) => void;
  aoGirar: (graus: number) => void;
  aoConverter: (t: TipoMovel) => void;
  aoRemover: () => void;
}) {
  const base = useId();
  const travado = !item.editavel;
  const L = LIMITES_EDICAO;
  const [corTexto, setCorTexto] = useState(item.cor);
  useEffect(() => setCorTexto(item.cor), [item.cor]);
  const num = (k: "x" | "z" | "rot" | "larg" | "prof" | "alt", rot: string, unidade: string, casas: number, min: number, max: number) => (
    <CampoNumero id={`${base}-${k}`} rot={rot} valor={item[k]} casas={casas} unidade={unidade} min={min} max={max} desligado={travado}
      aoMudar={v => aoMudar({ [k]: v }, k)} />
  );
  return (
    <section aria-label="Item selecionado" className="grid gap-3" data-teste="painel-item">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[17px] font-medium">{rotuloDoTipo(item.tipo)} <span className="text-[13px] font-normal text-[#6B6B66]">· {item.id}</span></h3>
        {travado && <span className="text-[13px] text-[#8A5A00]">Item travado da planta</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${base}-tipo`} className={rotulo}>Tipo</label>
          <select id={`${base}-tipo`} className={campo} value={item.tipo} disabled={travado} onChange={e => aoConverter(e.target.value as TipoMovel)}>
            {tiposDoGrupo(grupoDoTipo(item.tipo)).map(t => <option key={t} value={t}>{rotuloDoTipo(t)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${base}-amb`} className={rotulo}>Ambiente</label>
          <select id={`${base}-amb`} className={campo} value={item.ambiente} disabled={travado} onChange={e => aoMudar({ ambiente: e.target.value }, "ambiente")}>
            {(ambientes.includes(item.ambiente) ? ambientes : [item.ambiente, ...ambientes]).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {num("x", "X", "m", 2, -L.coordenada, L.coordenada)}
        {num("z", "Z", "m", 2, -L.coordenada, L.coordenada)}
        {num("larg", "Largura", "m", 2, 0.02, L.medida)}
        {num("prof", "Profundidade", "m", 2, 0.02, L.medida)}
        {num("alt", "Altura", "m", 2, 0.005, L.altura)}
        {num("rot", "Rotação", "°", 0, -720, 720)}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Girar">
        <button type="button" className={botao} disabled={travado} onClick={() => aoGirar(-90)} aria-label="Girar 90° para a esquerda">↶ 90°</button>
        <button type="button" className={botao} disabled={travado} onClick={() => aoGirar(90)} aria-label="Girar 90° para a direita">↷ 90°</button>
        <button type="button" className={botao} disabled={travado} onClick={() => aoGirar(-15)} aria-label="Girar 15° para a esquerda">−15°</button>
        <button type="button" className={botao} disabled={travado} onClick={() => aoGirar(15)} aria-label="Girar 15° para a direita">+15°</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${base}-mat`} className={rotulo}>Material</label>
          <select id={`${base}-mat`} className={campo} value={item.material} disabled={travado} onChange={e => aoMudar({ material: e.target.value }, "material")}>
            {(MATERIAIS_ITEM as readonly string[]).includes(item.material) ? null : <option value={item.material}>{item.material}</option>}
            {MATERIAIS_ITEM.map(mt => <option key={mt} value={mt}>{ROTULOS_MATERIAL[mt]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${base}-cor`} className={rotulo}>Cor</label>
          <div className="flex gap-2">
            <input type="color" aria-label="Escolher a cor" className="h-[44px] w-[52px] flex-none cursor-pointer rounded border border-[#CFCFCA] bg-white p-1" value={item.cor.toLowerCase()} disabled={travado}
              onChange={e => aoMudar({ cor: e.target.value }, "cor")} />
            <input id={`${base}-cor`} type="text" autoComplete="off" spellCheck={false} maxLength={7} className={`${campo} font-mono uppercase ${COR_HEX.test(corTexto) ? "" : "border-[#D92D20]"}`} value={corTexto} disabled={travado}
              onChange={e => { setCorTexto(e.target.value); if (COR_HEX.test(e.target.value)) aoMudar({ cor: e.target.value.toLowerCase() }, "cor"); }} />
          </div>
        </div>
      </div>
      <button type="button" className={`${botao} border-[#D92D20] text-[#B42318]`} disabled={travado} onClick={aoRemover}>Remover este item</button>
    </section>
  );
}
