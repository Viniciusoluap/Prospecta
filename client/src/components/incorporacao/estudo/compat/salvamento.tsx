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

export interface OpcoesSalvamento {
  /** Não há registro gravado no banco: o conteúdo inicial são só os padrões do formulário. */
  semRegistro?: boolean;
}

// Revisão do PR #263 do Santa Fé (19/11, mesma regra nos dois sistemas): `{ semRegistro: true }` = o formulário abriu
// com os padrões, sem nada gravado. Nesse caso `salvo` fica falso até a primeira gravação; o botão (`salvar`) força essa
// gravação; o salvamento automático continua só depois de uma alteração (abrir a aba não grava nada).
export function useSalvamento<T>(dados: T | null, gravar: (dados: T, anterior: T) => Promise<unknown>, opcoes: OpcoesSalvamento = {}) {
  const id = useId();
  const informar = useContext(Contexto);
  const json = dados === null ? null : JSON.stringify(dados);
  const [gravado, setGravado] = useState(json);
  const [registrado, setRegistrado] = useState(!opcoes.semRegistro);
  const [pending, setPending] = useState(false);
  const [falha, setFalha] = useState<{ json: string; mensagem: string } | null>(null);
  const fila = useRef<FilaSalvamento<T>>({ atual: json, gravado: json, gravar, envio: null, registrado: !opcoes.semRegistro });

  useLayoutEffect(() => {
    const estado = fila.current;
    estado.atual = json;
    estado.gravar = gravar;
    if (estado.gravado === null && json !== null) {
      estado.gravado = json;
      setGravado(json);
    }
  }, [json, gravar]);

  const enviar = useCallback((forcar: boolean) => salvarFila(
    fila.current,
    (snapshot) => { setGravado(snapshot); setRegistrado(true); },
    (snapshot, erro) => setFalha({ json: snapshot, mensagem: erro instanceof Error ? erro.message : "Falha ao salvar." }),
    () => { setPending(true); setFalha(null); },
    () => setPending(false),
    forcar,
  ), []);
  // Botão "Salvar": grava na hora; sem registro no banco, grava mesmo sem alteração.
  const salvar = useCallback(() => enviar(true), [enviar]);
  const salvarAlteracao = useCallback(() => enviar(false), [enviar]);

  const alterado = json !== null && gravado !== null && json !== gravado;
  const erro = (alterado || !registrado) && falha?.json === json ? falha.mensagem : null;
  useEffect(() => {
    if (!alterado || pending || erro) return;
    const timer = window.setTimeout(() => { void salvarAlteracao(); }, 700);
    return () => window.clearTimeout(timer);
  }, [alterado, pending, erro, json, salvarAlteracao]);

  // Com registro (padrão) o erro só existe com alteração: sem mudança para os demais usos. Sem registro, a falha da
  // primeira gravação também aparece no aviso, com "Tentar novamente".
  useEffect(() => { informar?.(id, alterado || pending || erro ? { erro, salvar } : null); }, [informar, id, alterado, pending, erro, salvar]);
  useEffect(() => () => informar?.(id, null), [informar, id]);

  return { salvar, alterado, pending, erro, registrado, salvo: registrado && !alterado && !pending };
}

export function useSalvamentoJson<T>(dados: T, estudoId: string, gravar: (id: string, json: string) => Promise<{ ok: true } | ErroAcao>, aposSalvar?: () => void) {
  return useSalvamento(dados, async snapshot => {
    exigirResultado(await gravar(estudoId, JSON.stringify(snapshot)));
    aposSalvar?.();
  });
}
