// Maquete 3D (EPIC-024, S-04) — muro de divisa na revisão: liga/desliga (obrigatório no condomínio), altura,
// espessura, recuo, acabamento, cor e portões. Sem portões editados, valem os automáticos (acesso da rua à divisa).
// Grava junto com a planta ("Salvar planta"), com a mesma trava de versão. Terreno com várias áreas: um muro e uma
// lista de portões por área.
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACABAMENTOS_MURO, COR_ACABAMENTO_MURO, LIMITES_MURO, ROTULOS_ACABAMENTO_MURO, ROTULOS_PORTAO, TIPOS_PORTAO, areasDoTerreno, assinaturaDoContorno, limites,
  muroPadraoDoTipo, muroSchema, type AcabamentoMuro, type ModeloMaquete, type Muro, type PortaoMuro, type Ponto, type TipoPortao,
} from "@shared/maquete-3d/modelo";
import { geometriaDoMuro, perimetrosDasAreas, pontosDosPortoes, portoesAutomaticos, verticesIniciais } from "@shared/maquete-3d/muro";

const inputCls = "h-8 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const btnOutline = "border-[#C9A961]/30 bg-transparent text-gray-200";
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const limitar = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));

/** Valor do campo ao confirmar (sair do campo ou Enter): limitado à faixa, com 2 casas; texto inválido volta ao anterior. */
export function numeroConfirmado(texto: string, anterior: number, faixa: readonly [number, number]): number {
  const n = parseFloat(texto.replace(",", "."));
  return Number.isFinite(n) ? Math.round(limitar(n, faixa) * 100) / 100 : anterior;
}

/**
 * Campo numérico que só limita a faixa ao sair do campo (ou com Enter): digitar "1" a caminho de "1,2" não vira o
 * mínimo no meio da digitação.
 */
function Num({ valor, faixa, passo, onChange, desativado }: { valor: number; faixa: readonly [number, number]; passo: number; onChange: (n: number) => void; desativado?: boolean }) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => { setTexto(String(valor)); }, [valor]);
  const confirmar = () => {
    const v = numeroConfirmado(texto, valor, faixa);
    setTexto(String(v));
    if (v !== valor) onChange(v);
  };
  return <input type="number" className={inputCls} step={passo} min={faixa[0]} max={faixa[1]} value={texto} disabled={desativado}
    onChange={e => setTexto(e.target.value)} onBlur={confirmar} onKeyDown={e => { if (e.key === "Enter") confirmar(); }} />;
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
  // Os mesmos de portoesDoMuro (sem recalcular as ruas): editados, ou os automáticos; a portaria é o 1º de veículos de cada área.
  const portoes = muro.portoesEditados ? muro.portoes : auto?.portoes ?? [];
  const principais = new Set<string>(), vistas = new Set<number>();
  for (const p of portoes) if (p.tipo === "veiculos" && !vistas.has(p.area ?? 0)) { vistas.add(p.area ?? 0); principais.add(p.id); }
  // Editar a lista grava a assinatura do contorno (para saber depois se a divisa mudou) e dá a conferência por feita.
  const editarPortoes = (lista: PortaoMuro[]) => mudar({ portoesEditados: true, portoes: lista.slice(0, 20), contorno: assinaturaDoContorno(imp), reancorado: false });
  const novoId = () => { let k = portoes.length + 1; while (portoes.some(p => p.id === `p${k}`)) k++; return `p${k}`; };
  const mudarPortao = (id: string, m: Partial<PortaoMuro>) => editarPortoes(portoes.map(p => (p.id === id ? { ...p, ...m } : p)));
  const perimetros = perimetrosDasAreas(imp);
  const areas = perimetros.map((perimetro, indice) => ({ indice, perimetro })).filter(a => a.perimetro > 0);
  const varias = areas.length > 1;
  const mesmaArea = (p: PortaoMuro, c: PortaoMuro) => (p.area ?? 0) === (c.area ?? 0);
  // Rua que chega à divisa sem portão (a pessoa tirou): o muro a fecha.
  const fechadas = (auto?.candidatos ?? []).filter(c => !portoes.some(p => mesmaArea(p, c) && Math.abs(p.posicao - c.posicao) < (p.largura + c.largura) / 2));
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
          {geo && <p className="text-xs text-gray-300">{varias ? `${areas.length} áreas · ` : ""}Divisa de {fmt(geo.resumo.perimetro)} m · {fmt(geo.resumo.comprimento)} m de muro · {portoes.length} portão(ões). Não há muro entre os lotes.</p>}
          {geo && <PlantaDoMuro modelo={modelo} trechos={geo.trechos} portoes={portoes} principais={principais} />}
          {geo && <p className="text-[11px] text-gray-400">Na planta: ● vértice 1 (onde começa a medida de cada área), ■ portaria, ▲ portão secundário ou de pedestres.</p>}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">Portões {muro.portoesEditados ? "(editados)" : "(automáticos: um em cada rua que chega à divisa)"}</p>
              {!somenteLeitura && muro.portoesEditados && <Button type="button" size="sm" variant="outline" className={btnOutline} onClick={() => mudar({ portoesEditados: false, portoes: [], contorno: undefined, reancorado: false })}><RefreshCw className="mr-1 h-4 w-4" />Recalcular portões automáticos</Button>}
            </div>
            {muro.portoesEditados && muro.reancorado && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                <span>O contorno do terreno mudou depois que os portões foram editados: cada um foi levado ao ponto da nova divisa mais perto de onde estava. Confira as posições na planta acima.</span>
                {!somenteLeitura && <Button type="button" size="sm" variant="outline" className={btnOutline} onClick={() => mudar({ reancorado: false, contorno: assinaturaDoContorno(imp) })}><Check className="mr-1 h-3 w-3" />Conferi os portões</Button>}
              </div>
            )}
            {portoes.length === 0 && <p className="text-xs text-amber-300">Nenhum portão: o empreendimento fica sem entrada.</p>}
            {areas.map(ar => {
              const daArea = portoes.filter(p => (p.area ?? 0) === ar.indice);
              return (
                <div key={ar.indice} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {varias ? <p className="text-xs font-semibold text-[#C9A961]">Área {ar.indice + 1} · divisa de {fmt(ar.perimetro)} m</p> : <span />}
                    {!somenteLeitura && <Button type="button" size="sm" variant="outline" className={btnOutline} onClick={() => editarPortoes([...portoes, { id: novoId(), posicao: 0, largura: 1.2, tipo: "pedestres", ...(ar.indice ? { area: ar.indice } : {}) }])}><Plus className="mr-1 h-4 w-4" />Adicionar portão{varias ? ` na área ${ar.indice + 1}` : ""}</Button>}
                  </div>
                  {daArea.length === 0 && <p className="text-xs text-amber-300">Sem portão nesta área: ela fica sem entrada.</p>}
                  {daArea.map(p => (
                    <div key={p.id} className="grid items-end gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto]">
                      <span className={`pb-2 text-xs font-semibold ${principais.has(p.id) ? "text-emerald-300" : "text-gray-300"}`}>{principais.has(p.id) ? "Portaria" : p.tipo === "pedestres" ? "Pedestres" : "Portão secundário"}</span>
                      <label className="text-xs text-gray-300">Posição na divisa (m, a partir do vértice 1)
                        <Num valor={p.posicao} faixa={[0, Math.max(0, ar.perimetro)]} passo={0.5} desativado={somenteLeitura} onChange={n => mudarPortao(p.id, { posicao: n })} /></label>
                      <label className="text-xs text-gray-300">Largura (m)
                        <Num valor={p.largura} faixa={LIMITES_MURO.largura} passo={0.1} desativado={somenteLeitura} onChange={n => mudarPortao(p.id, { largura: n })} /></label>
                      <label className="text-xs text-gray-300">Tipo
                        <select className={inputCls} value={p.tipo} disabled={somenteLeitura} onChange={e => mudarPortao(p.id, { tipo: e.target.value as TipoPortao })}>
                          {TIPOS_PORTAO.map(t => <option key={t} value={t}>{ROTULOS_PORTAO[t]}</option>)}
                        </select></label>
                      {!somenteLeitura && <Button type="button" size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" aria-label="Tirar portão" onClick={() => editarPortoes(portoes.filter(x => x.id !== p.id))}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  ))}
                  {fechadas.filter(c => (c.area ?? 0) === ar.indice).map(c => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-300">
                      <span>A rua que chega à divisa a {fmt(c.posicao)} m do vértice 1 termina no muro (o portão dela foi tirado).</span>
                      {!somenteLeitura && <Button type="button" size="sm" variant="outline" className={btnOutline} onClick={() => editarPortoes([...portoes, { ...c, id: novoId() }])}><Plus className="mr-1 h-3 w-3" />Reabrir portão</Button>}
                    </div>
                  ))}
                </div>
              );
            })}
            {!muro.portoesEditados && auto?.notas.map(n => <p key={n} className="text-xs text-amber-300">{n}</p>)}
            {geo?.resumo.notas.filter(n => n.startsWith("O contorno do terreno tem trechos")).map(n => <p key={n} className="text-xs text-amber-300">{n}</p>)}
          </div>
        </>
      )}
    </div>
  );
}

/** Planta do muro: divisa tracejada (todas as áreas), trechos de muro, o vértice 1 de cada área e os portões. */
function PlantaDoMuro({ modelo, trechos, portoes, principais }: { modelo: ModeloMaquete; trechos: Ponto[][]; portoes: PortaoMuro[]; principais: Set<string> }) {
  const imp = modelo.implantacao!;
  const contornos = areasDoTerreno(imp).filter(a => a.length >= 3);
  const l = limites(contornos.flat()), m = Math.max(l.largura, l.altura) * 0.04 + 1, u = Math.max(l.largura, l.altura) / 300;
  const inicios = verticesIniciais(imp), pontos = pontosDosPortoes(imp, portoes);
  return (
    <svg viewBox={`${l.minX - m} ${l.minY - m} ${l.largura + 2 * m} ${l.altura + 2 * m}`} className="h-56 w-full rounded-md bg-[#1A2332]" role="img" aria-label="Planta do muro de divisa">
      {imp.ruas.map((r, i) => <polygon key={`r${i}`} points={r.map(p => `${p.x},${p.y}`).join(" ")} fill="#3B3D42" />)}
      {imp.lotes.map(lt => <polygon key={lt.id} points={lt.poligono.map(p => `${p.x},${p.y}`).join(" ")} fill="#8DB59633" stroke="#8DB59666" strokeWidth={u} />)}
      {contornos.map((c, i) => <polygon key={`t${i}`} points={c.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#9CA3AF" strokeWidth={u} strokeDasharray={`${u * 4} ${u * 3}`} />)}
      {trechos.map((t, i) => <polyline key={i} points={t.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#C9A961" strokeWidth={u * 3} strokeLinejoin="miter" />)}
      {inicios.map((p, i) => p && (
        <g key={`v${i}`}>
          <circle cx={p.x} cy={p.y} r={u * 5} fill="#60A5FA" stroke="#1A2332" strokeWidth={u} />
          <text x={p.x + u * 7} y={p.y - u * 6} fontSize={u * 14} fill="#93C5FD">{contornos.length > 1 ? `V1 (área ${i + 1})` : "V1"}</text>
        </g>
      ))}
      {portoes.map((p, i) => {
        const q = pontos[i];
        if (!q) return null;
        const r = u * 6, cor = principais.has(p.id) ? "#34D399" : "#F59E0B";
        return principais.has(p.id)
          ? <rect key={p.id} x={q.x - r} y={q.y - r} width={2 * r} height={2 * r} fill={cor} stroke="#1A2332" strokeWidth={u}><title>{`Portaria · ${fmt(p.posicao)} m`}</title></rect>
          : <polygon key={p.id} points={`${q.x},${q.y - r * 1.2} ${q.x + r},${q.y + r * 0.8} ${q.x - r},${q.y + r * 0.8}`} fill={cor} stroke="#1A2332" strokeWidth={u}><title>{`Portão · ${fmt(p.posicao)} m`}</title></polygon>;
      })}
    </svg>
  );
}
