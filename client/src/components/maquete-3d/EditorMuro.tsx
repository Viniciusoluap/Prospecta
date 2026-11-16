// Maquete 3D (EPIC-024, S-04) — muro de divisa na revisão: liga/desliga (obrigatório no condomínio), altura,
// espessura, recuo, acabamento, cor e portões. Sem portões editados, valem os automáticos (acesso da rua à divisa).
// Grava junto com a planta ("Salvar planta"), com a mesma trava de versão.
import { useMemo } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACABAMENTOS_MURO, COR_ACABAMENTO_MURO, LIMITES_MURO, ROTULOS_ACABAMENTO_MURO, ROTULOS_PORTAO, TIPOS_PORTAO, limites, muroPadraoDoTipo, muroSchema,
  type AcabamentoMuro, type ModeloMaquete, type Muro, type PortaoMuro, type TipoPortao,
} from "@shared/maquete-3d/modelo";
import { geometriaDoMuro, portoesAutomaticos } from "@shared/maquete-3d/muro";

const inputCls = "h-8 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const btnOutline = "border-[#C9A961]/30 bg-transparent text-gray-200";
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const limitar = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));

function Num({ valor, faixa, passo, onChange, desativado }: { valor: number; faixa: readonly [number, number]; passo: number; onChange: (n: number) => void; desativado?: boolean }) {
  return <input type="number" className={inputCls} step={passo} min={faixa[0]} max={faixa[1]} value={valor} disabled={desativado}
    onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(Math.round(limitar(n, faixa) * 100) / 100); }} />;
}

export function EditorMuro({ modelo, onChange, somenteLeitura = false }: { modelo: ModeloMaquete; onChange: (m: ModeloMaquete) => void; somenteLeitura?: boolean }) {
  const imp = modelo.implantacao;
  const condominio = modelo.tipo === "condominio";
  // O que vale hoje: o salvo ou o padrão do tipo (desligado fora do condomínio).
  const salvo = imp?.muro ?? null;
  const muro: Muro = useMemo(() => salvo ?? muroPadraoDoTipo(modelo.tipo) ?? muroSchema.parse({ ativo: false }), [salvo, modelo.tipo]);
  const temContorno = !!imp && imp.terreno.length >= 3;
  const auto = useMemo(() => (imp && temContorno ? portoesAutomaticos(imp, muro) : null), [imp, temContorno, muro]);
  const geo = useMemo(() => (imp && temContorno && muro.ativo ? geometriaDoMuro(imp, muro) : null), [imp, temContorno, muro]);
  if (!imp) return null;

  const mudar = (m: Partial<Muro>) => onChange({ ...modelo, implantacao: { ...imp, muro: muroSchema.parse({ ...muro, ...m, editado: true }) } });
  const portoes = muro.portoesEditados ? muro.portoes : auto?.portoes ?? [];
  const editarPortoes = (lista: PortaoMuro[]) => mudar({ portoesEditados: true, portoes: lista });
  const novoId = () => { let k = muro.portoes.length + 1; while (muro.portoes.some(p => p.id === `p${k}`)) k++; return `p${k}`; };
  const mudarPortao = (id: string, m: Partial<PortaoMuro>) => editarPortoes(portoes.map(p => (p.id === id ? { ...p, ...m } : p)));
  const perimetro = geo?.resumo.perimetro ?? 0;
  const naoUsados = (auto?.candidatos ?? []).filter(c => !portoes.some(p => Math.abs(p.posicao - c.posicao) < (p.largura + c.largura) / 2));

  return (
    <div className="space-y-3 rounded-lg border border-[#C9A961]/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-[#C9A961]">{condominio ? "Muro do condomínio" : "Muro de divisa"}</p>
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={muro.ativo} disabled={somenteLeitura} onChange={e => mudar({ ativo: e.target.checked })} />
          {condominio ? "Muro em todo o contorno do terreno (obrigatório no condomínio)" : "Levantar muro em todo o contorno do terreno (opcional)"}
        </label>
      </div>
      {!temContorno ? (
        <p className="text-xs text-amber-300">Esta maquete não tem o contorno do terreno (KML/KMZ ou implantação): não há onde levantar o muro. Monte a implantação a partir do estudo ou importe o contorno.</p>
      ) : !muro.ativo ? (
        <p className={`text-xs ${condominio ? "text-red-300" : "text-gray-400"}`}>{condominio ? "Sem o muro, a planta não pode ser validada: o condomínio tem muro de divisa obrigatório." : "Sem muro de divisa. Casa, prédio e loteamento não exigem muro."}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            <label className="text-xs text-gray-300">Altura (m)<Num valor={muro.altura} faixa={LIMITES_MURO.altura} passo={0.1} desativado={somenteLeitura} onChange={n => mudar({ altura: n })} /></label>
            <label className="text-xs text-gray-300">Espessura (m)<Num valor={muro.espessura} faixa={LIMITES_MURO.espessura} passo={0.01} desativado={somenteLeitura} onChange={n => mudar({ espessura: n })} /></label>
            <label className="text-xs text-gray-300">Recuo da divisa (m)<Num valor={muro.recuo} faixa={LIMITES_MURO.recuo} passo={0.05} desativado={somenteLeitura} onChange={n => mudar({ recuo: n })} /></label>
            <label className="text-xs text-gray-300">Acabamento
              <select className={inputCls} value={muro.acabamento} disabled={somenteLeitura} onChange={e => { const a = e.target.value as AcabamentoMuro; mudar({ acabamento: a, cor: COR_ACABAMENTO_MURO[a] }); }}>
                {ACABAMENTOS_MURO.map(a => <option key={a} value={a}>{ROTULOS_ACABAMENTO_MURO[a]}</option>)}
              </select></label>
            <label className="text-xs text-gray-300">Cor<input type="color" className={`${inputCls} p-0.5`} value={muro.cor} disabled={somenteLeitura} onChange={e => mudar({ cor: e.target.value.toUpperCase() })} /></label>
          </div>
          {geo && <p className="text-xs text-gray-300">Divisa de {fmt(geo.resumo.perimetro)} m · {fmt(geo.resumo.comprimento)} m de muro · {portoes.length} portão(ões). Não há muro entre os lotes.</p>}
          {geo && <PlantaDoMuro modelo={modelo} trechos={geo.trechos} />}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">Portões {muro.portoesEditados ? "(editados)" : "(automáticos: onde a rua sai do terreno)"}</p>
              {!somenteLeitura && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" className={btnOutline} onClick={() => editarPortoes([...portoes, { id: novoId(), posicao: 0, largura: 1.2, tipo: "pedestres" }])}><Plus className="mr-1 h-4 w-4" />Adicionar portão</Button>
                  {muro.portoesEditados && <Button type="button" size="sm" variant="outline" className={btnOutline} onClick={() => mudar({ portoesEditados: false, portoes: [] })}><RefreshCw className="mr-1 h-4 w-4" />Recalcular portão automático</Button>}
                </div>
              )}
            </div>
            {portoes.length === 0 && <p className="text-xs text-amber-300">Nenhum portão: o empreendimento fica sem entrada.</p>}
            {portoes.map(p => (
              <div key={p.id} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <label className="text-xs text-gray-300">Posição na divisa (m, a partir do vértice 1)
                  <Num valor={p.posicao} faixa={[0, Math.max(0, perimetro)]} passo={0.5} desativado={somenteLeitura} onChange={n => mudarPortao(p.id, { posicao: n })} /></label>
                <label className="text-xs text-gray-300">Largura (m)
                  <Num valor={p.largura} faixa={LIMITES_MURO.largura} passo={0.1} desativado={somenteLeitura} onChange={n => mudarPortao(p.id, { largura: n })} /></label>
                <label className="text-xs text-gray-300">Tipo
                  <select className={inputCls} value={p.tipo} disabled={somenteLeitura} onChange={e => mudarPortao(p.id, { tipo: e.target.value as TipoPortao })}>
                    {TIPOS_PORTAO.map(t => <option key={t} value={t}>{ROTULOS_PORTAO[t]}</option>)}
                  </select></label>
                {!somenteLeitura && <Button type="button" size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" aria-label="Tirar portão" onClick={() => editarPortoes(portoes.filter(x => x.id !== p.id))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            {!muro.portoesEditados && auto?.notas.map(n => <p key={n} className="text-xs text-amber-300">{n}</p>)}
            {!somenteLeitura && naoUsados.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                <span>Outros acessos de rua na divisa:</span>
                {naoUsados.map(c => <Button key={c.id} type="button" size="sm" variant="outline" className={btnOutline} onClick={() => editarPortoes([...portoes, { ...c, id: novoId() }])}><Plus className="mr-1 h-3 w-3" />Portão a {fmt(c.posicao)} m</Button>)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Planta do muro: divisa tracejada, trechos de muro e as aberturas dos portões. */
function PlantaDoMuro({ modelo, trechos }: { modelo: ModeloMaquete; trechos: { x: number; y: number }[][] }) {
  const imp = modelo.implantacao!;
  const l = limites(imp.terreno), m = Math.max(l.largura, l.altura) * 0.04 + 1, u = Math.max(l.largura, l.altura) / 300;
  return (
    <svg viewBox={`${l.minX - m} ${l.minY - m} ${l.largura + 2 * m} ${l.altura + 2 * m}`} className="h-48 w-full rounded-md bg-[#1A2332]" role="img" aria-label="Planta do muro de divisa">
      {imp.ruas.map((r, i) => <polygon key={`r${i}`} points={r.map(p => `${p.x},${p.y}`).join(" ")} fill="#3B3D42" />)}
      {imp.lotes.map(lt => <polygon key={lt.id} points={lt.poligono.map(p => `${p.x},${p.y}`).join(" ")} fill="#8DB59633" stroke="#8DB59666" strokeWidth={u} />)}
      <polygon points={imp.terreno.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#9CA3AF" strokeWidth={u} strokeDasharray={`${u * 4} ${u * 3}`} />
      {trechos.map((t, i) => <polyline key={i} points={t.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#C9A961" strokeWidth={u * 3} strokeLinejoin="miter" />)}
    </svg>
  );
}
