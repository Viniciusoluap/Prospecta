// Maquete 3D (EPIC-028, Etapa 4) — dentro da tela do editor (só o administrador): lotes que mostram esta planta
// (N lotes → a mesma estrutura), a versão PUBLICADA de itens de cada lote, a unidade da Incorporação de onde vem o
// status (só leitura), e o link público com código: gerar/trocar e copiar. O servidor confere o papel em cada rota.
import { useCallback, useEffect, useState } from "react";
import { lerErro, type ConexaoLotes, type DadosSalvarLote, type ListaLotes, type LoteAdmin, type StatusLoteAdmin } from "./conexao";

const botao = "inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded border border-[#E4E4E0] bg-white px-3 text-[15px] text-[#111] transition-colors hover:bg-[#F4F4F1] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111]";
const campo = "min-h-[44px] w-full rounded border border-[#CFCFCA] bg-white px-3 text-[16px] text-[#111]";
const ROTULO: Record<Exclude<StatusLoteAdmin, null>, string> = { disponivel: "Disponível", reservado: "Reservado", vendido: "Vendido" };
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const nomeDoLote = (l: Pick<LoteAdmin, "quadra" | "lote">) => [l.lote ? `Lote ${l.lote}` : null, l.quadra ? `Quadra ${l.quadra}` : null].filter(Boolean).join(", ") || "Lote";

const dadosDe = (planta: string, l: LoteAdmin, mudar: Partial<DadosSalvarLote>): DadosSalvarLote => ({
  id: l.id, planta, empreendimentoSlug: l.empreendimentoSlug, loteSlug: l.loteSlug, empreendimentoNome: l.empreendimentoNome ?? l.empreendimentoSlug,
  quadra: l.quadra, lote: l.lote, itensVersao: l.itensVersao, unitId: l.unidade?.id ?? null, ativo: l.ativo, ...mudar,
});

function BuscaUnidade({ conexao, aoEscolher }: { conexao: ConexaoLotes; aoEscolher: (id: number | null) => void }) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Awaited<ReturnType<ConexaoLotes["unidades"]>> | null>(null);
  return (
    <div className="mt-2 rounded border border-[#E4E4E0] p-2">
      <div className="flex gap-2">
        <input className={campo} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Estudo ou código da unidade" aria-label="Buscar unidade da Incorporação" />
        <button type="button" className={botao} onClick={() => conexao.unidades(busca).then(setLista, () => setLista([]))}>Buscar</button>
      </div>
      {lista && (lista.length ? (
        <ul className="m-0 mt-2 list-none p-0">
          {lista.map(u => (
            <li key={u.id}><button type="button" className={`${botao} mb-1 w-full justify-between`} onClick={() => aoEscolher(u.id)}>
              <span>{u.estudo} · {u.codigo}</span><span className="text-[13px] text-[#6B6B66]">{u.status ? ROTULO[u.status] : "—"}</span>
            </button></li>
          ))}
        </ul>
      ) : <p className="m-0 mt-2 text-[14px] text-[#6B6B66]">Nenhuma unidade encontrada.</p>)}
      <button type="button" className={`${botao} mt-1`} onClick={() => aoEscolher(null)}>Sem unidade (não mostrar status)</button>
    </div>
  );
}

function CartaoLote({ planta, l, lista, conexao, recarregar, avisar }: {
  planta: string; l: LoteAdmin; lista: ListaLotes; conexao: ConexaoLotes; recarregar: () => void; avisar: (t: string, erro?: boolean) => void;
}) {
  const [unidadeAberta, setUnidadeAberta] = useState(false);
  const link = l.caminho && typeof window !== "undefined" ? `${window.location.origin}${l.caminho}` : null;
  const salvar = (mudar: Partial<DadosSalvarLote>, ok: string) =>
    conexao.salvar(dadosDe(planta, l, mudar)).then(() => { avisar(ok); recarregar(); }, e => avisar(lerErro(e).mensagem, true));
  const copiar = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); avisar("Link copiado."); } catch { avisar("Não foi possível copiar: selecione o link e copie.", true); }
  };
  const gerar = () => {
    if (l.caminho && !window.confirm("Gerar um link novo? O link atual deixa de abrir na hora (quem já recebeu precisa do novo).")) return;
    conexao.gerarCodigo(planta, l.id).then(() => { avisar("Link novo gerado."); recarregar(); }, e => avisar(lerErro(e).mensagem, true));
  };
  return (
    <li className="rounded border border-[#E4E4E0] p-3" data-teste="lote" data-lote={l.loteSlug}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-[16px]">{l.empreendimentoNome ?? l.empreendimentoSlug} · {nomeDoLote(l)}</strong>
        <span className="text-[14px] text-[#6B6B66]">
          {l.unidade ? `Status: ${l.unidade.status ? ROTULO[l.unidade.status] : "—"} (unidade ${l.unidade.codigo})` : "Sem unidade: a página não mostra status"}
        </span>
      </div>
      {l.pendencia && <p className="m-0 mt-1 text-[14px] font-medium text-[#B42318]" data-teste="pendencia">A página não abre: {l.pendencia}</p>}
      <label className="mt-2 block text-[14px] text-[#6B6B66]">Itens que este lote mostra
        <select className={campo} value={l.itensVersao ?? ""} onChange={e => salvar({ itensVersao: e.target.value ? Number(e.target.value) : null }, "Versão do lote salva.")}>
          <option value="">Seguir a publicada da maquete{lista.versaoPublicada ? ` (versão ${lista.versaoPublicada})` : " (nenhuma ainda)"}</option>
          {lista.versoes.filter(v => v.valeParaPlanta).map(v => (
            <option key={v.versao} value={v.versao}>Fixar na versão {v.versao}{v.situacao === "publicada" ? " (publicada agora)" : " (publicada antes)"}</option>
          ))}
        </select>
      </label>
      {link && (
        <input readOnly className={`${campo} mt-2 text-[14px]`} value={link} aria-label="Link público do lote" onFocus={e => e.currentTarget.select()} data-teste="link-lote" />
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {link && <button type="button" className={`${botao} border-[#111] font-medium`} onClick={copiar}>Copiar link</button>}
        <button type="button" className={botao} onClick={gerar}>{l.caminho ? "Gerar novo link" : "Gerar link"}</button>
        <button type="button" className={botao} onClick={() => setUnidadeAberta(v => !v)}>{l.unidade ? "Trocar unidade" : "Ligar unidade"}</button>
        <button type="button" className={botao} onClick={() => salvar({ ativo: !l.ativo }, l.ativo ? "Lote desligado: a página não abre." : "Lote religado.")}>{l.ativo ? "Desligar página" : "Religar página"}</button>
      </div>
      {unidadeAberta && <BuscaUnidade conexao={conexao} aoEscolher={id => { setUnidadeAberta(false); salvar({ unitId: id }, id ? "Unidade ligada." : "Unidade desligada."); }} />}
    </li>
  );
}

function NovoLote({ planta, conexao, aoCriar, avisar }: { planta: string; conexao: ConexaoLotes; aoCriar: () => void; avisar: (t: string, erro?: boolean) => void }) {
  const [f, setF] = useState({ empreendimentoNome: "", quadra: "", lote: "" });
  const empreendimentoSlug = slug(f.empreendimentoNome);
  const loteSlug = slug(`qd${f.quadra}-lote${f.lote}`);
  const pode = !!empreendimentoSlug && !!f.quadra.trim() && !!f.lote.trim();
  const criar = () => conexao.salvar({ planta, empreendimentoSlug, loteSlug, empreendimentoNome: f.empreendimentoNome.trim(), quadra: f.quadra.trim(), lote: f.lote.trim(), itensVersao: null, unitId: null, ativo: true })
    .then(() => { avisar("Lote ligado, com link."); setF({ empreendimentoNome: f.empreendimentoNome, quadra: "", lote: "" }); aoCriar(); }, e => avisar(lerErro(e).mensagem, true));
  return (
    <details className="mt-3 rounded border border-[#E4E4E0] p-3">
      <summary className="min-h-[44px] cursor-pointer py-2 text-[15px] font-medium">Ligar outro lote a esta planta</summary>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="text-[14px] text-[#6B6B66]">Empreendimento<input className={campo} value={f.empreendimentoNome} onChange={e => setF({ ...f, empreendimentoNome: e.target.value })} /></label>
        <label className="text-[14px] text-[#6B6B66]">Quadra<input className={campo} inputMode="numeric" value={f.quadra} onChange={e => setF({ ...f, quadra: e.target.value })} /></label>
        <label className="text-[14px] text-[#6B6B66]">Lote<input className={campo} inputMode="numeric" value={f.lote} onChange={e => setF({ ...f, lote: e.target.value })} /></label>
      </div>
      <p className="m-0 mt-1 text-[13px] text-[#6B6B66]">Endereço: /maquete/{empreendimentoSlug || "…"}/{loteSlug}-<em>código</em></p>
      <button type="button" className={`${botao} mt-2 border-[#111] font-medium`} disabled={!pode} onClick={criar}>Ligar lote</button>
    </details>
  );
}

/** `atualizacao`: muda a cada publicação no editor acima; o painel relê os lotes e as versões (sem sair do editor). */
export default function PainelLotes({ planta, conexao, atualizacao = 0 }: { planta: string; conexao: ConexaoLotes; atualizacao?: number }) {
  const [lista, setLista] = useState<ListaLotes | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const avisar = useCallback((texto: string, erro = false) => setAviso({ texto, erro }), []);
  const recarregar = useCallback(() => { conexao.listar(planta).then(setLista, e => avisar(lerErro(e).mensagem, true)); }, [conexao, planta, avisar]);
  // `atualizacao` entra só como sinal: cada publicação no editor faz o painel reler a lista.
  useEffect(recarregar, [recarregar, atualizacao]);
  const semear = () => conexao.semearPadrao(planta).then(r => {
    avisar(r.criado ? `Lote padrão ligado${r.unidadeLigada ? ", com a unidade da Incorporação" : " (sem unidade: ligue para mostrar o status)"}.` : "O lote padrão já estava ligado.");
    recarregar();
  }, e => avisar(lerErro(e).mensagem, true));
  return (
    <section className="mt-8 border-t border-[#E4E4E0] pt-5" data-teste="painel-lotes" aria-labelledby="titulo-lotes">
      <h2 id="titulo-lotes" className="m-0 text-xl font-medium">Lotes com esta planta · página do cliente</h2>
      <p className="m-0 mt-1 max-w-[70ch] text-[14px] text-[#6B6B66]">
        Cada lote abre a mesma planta com a versão de itens PUBLICADA que você escolher. O cliente vê o status (da Incorporação, só leitura) e o botão
        do WhatsApp da empresa. O link leva um código: sem ele a página não abre.
      </p>
      {aviso && <p className={`m-0 mt-2 text-[14px] ${aviso.erro ? "font-medium text-[#B42318]" : "text-[#14532D]"}`} role="status" data-teste="aviso-lotes">{aviso.texto}</p>}
      {!lista ? <p className="mt-3 text-[#6B6B66]">Carregando os lotes…</p> : (
        <>
          {lista.lotes.length === 0 && (
            <button type="button" className={`${botao} mt-3 border-[#111] font-medium`} onClick={semear} data-teste="semear-lote">Ligar o lote padrão desta planta</button>
          )}
          <ul className="m-0 mt-3 grid list-none gap-3 p-0">
            {lista.lotes.map(l => <CartaoLote key={l.id} planta={planta} l={l} lista={lista} conexao={conexao} recarregar={recarregar} avisar={avisar} />)}
          </ul>
          <NovoLote planta={planta} conexao={conexao} aoCriar={recarregar} avisar={avisar} />
        </>
      )}
    </section>
  );
}
