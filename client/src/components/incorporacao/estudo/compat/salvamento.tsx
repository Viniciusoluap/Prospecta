import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { salvarFila, type FilaSalvamento } from "./fila-salvamento";
import { exigirResultado, type ErroAcao } from "./acao-resultado";

type Pendencia = { erro: string | null; salvar?: () => Promise<boolean>; orientacao?: string };
const Contexto = createContext<((id: string, pendencia: Pendencia | null) => void) | null>(null);
const Pendencias = createContext<ReadonlyMap<string, Pendencia>>(new Map());

export function SalvamentoProvider({ children }: { children: ReactNode }) {
  const [pendencias, setPendencias] = useState(new Map<string, Pendencia>());
  const informar = useCallback((id: string, pendencia: Pendencia | null) => {
    setPendencias(anteriores => {
      if (!pendencia && !anteriores.has(id)) return anteriores;
      const novas = new Map(anteriores);
      if (pendencia) novas.set(id, pendencia);
      else novas.delete(id);
      return novas;
    });
  }, []);

  useEffect(() => {
    if (!pendencias.size) return;
    const avisar = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendencias.size]);

  return <Contexto.Provider value={informar}><Pendencias.Provider value={pendencias}>{children}</Pendencias.Provider></Contexto.Provider>;
}

export function usePendenciasIncorporacao() {
  return useContext(Pendencias);
}

export function AvisoSalvamento() {
  const pendencias = usePendenciasIncorporacao();
  if (!pendencias.size) return null;
  const itens = Array.from(pendencias.values());
  const falhas = itens.filter(item => item.erro);
  const rascunho = itens.find(item => item.orientacao);
  return falhas.length > 0
    ? <div role="alert" className="text-xs text-red-700 mt-3">
        Há alterações não salvas. {falhas[0].erro}{" "}
        <button type="button" className="underline font-bold" onClick={() => { void Promise.all(falhas.map(item => item.salvar?.())); }}>Tentar novamente</button>
      </div>
    : <p role="status" className="text-xs text-amber-800 mt-3">
        {itens.some(item => item.salvar) ? "Salvando alterações automaticamente…" : rascunho?.orientacao}
      </p>;
}

export function usePendenciaManual(orientacao: string | null) {
  const id = useId();
  const informar = useContext(Contexto);
  useEffect(() => { informar?.(id, orientacao ? { erro: null, orientacao } : null); }, [informar, id, orientacao]);
  useEffect(() => () => informar?.(id, null), [informar, id]);
}

export function useSalvamento<T>(dados: T | null, gravar: (dados: T, anterior: T) => Promise<unknown>) {
  const id = useId();
  const informar = useContext(Contexto);
  const json = dados === null ? null : JSON.stringify(dados);
  const [gravado, setGravado] = useState(json);
  const [pending, setPending] = useState(false);
  const [falha, setFalha] = useState<{ json: string; mensagem: string } | null>(null);
  const fila = useRef<FilaSalvamento<T>>({ atual: json, gravado: json, gravar, envio: null });

  useLayoutEffect(() => {
    const estado = fila.current;
    estado.atual = json;
    estado.gravar = gravar;
    if (estado.gravado === null && json !== null) {
      estado.gravado = json;
      setGravado(json);
    }
  }, [json, gravar]);

  const salvar = useCallback(() => salvarFila(
    fila.current,
    setGravado,
    (snapshot, erro) => setFalha({ json: snapshot, mensagem: erro instanceof Error ? erro.message : "Falha ao salvar." }),
    () => { setPending(true); setFalha(null); },
    () => setPending(false),
  ), []);

  const alterado = json !== null && gravado !== null && json !== gravado;
  const erro = alterado && falha?.json === json ? falha.mensagem : null;
  useEffect(() => {
    if (!alterado || pending || erro) return;
    const timer = window.setTimeout(() => { void salvar(); }, 700);
    return () => window.clearTimeout(timer);
  }, [alterado, pending, erro, json, salvar]);

  useEffect(() => { informar?.(id, alterado || pending ? { erro, salvar } : null); }, [informar, id, alterado, pending, erro, salvar]);
  useEffect(() => () => informar?.(id, null), [informar, id]);

  return { salvar, alterado, pending, erro, salvo: !alterado && !pending };
}

export function useSalvamentoJson<T>(dados: T, estudoId: string, gravar: (id: string, json: string) => Promise<{ ok: true } | ErroAcao>, aposSalvar?: () => void) {
  return useSalvamento(dados, async snapshot => {
    exigirResultado(await gravar(estudoId, JSON.stringify(snapshot)));
    aposSalvar?.();
  });
}
