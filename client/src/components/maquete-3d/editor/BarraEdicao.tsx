// Maquete 3D (EPIC-028, Etapa 3) — barra do editor: desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z), restaurar o padrão da
// planta, salvar rascunho e publicar, com o estado (alterações não salvas, rascunho não publicado, publicado).
import { botao } from "./PainelItem";

export type EstadoBarra = {
  podeDesfazer: boolean; podeRefazer: boolean;
  podeSalvar: boolean; podePublicar: boolean;
  ocupado: null | "salvar" | "publicar";
  estado: string; tomEstado: "neutro" | "pendente" | "ok";
  motivoBloqueio: string | null;
};

export function BarraEdicao({ e, aoDesfazer, aoRefazer, aoRestaurar, aoSalvar, aoPublicar, aoSair }: {
  e: EstadoBarra; aoDesfazer: () => void; aoRefazer: () => void; aoRestaurar: () => void; aoSalvar: () => void; aoPublicar: () => void; aoSair: () => void;
}) {
  const tom = e.tomEstado === "pendente" ? "bg-[#FFF4D6] text-[#7A4B00] border-[#F2D58A]" : e.tomEstado === "ok" ? "bg-[#E7F6EC] text-[#1E5B32] border-[#B5DEC2]" : "bg-[#F4F4F1] text-[#3D3D39] border-[#E4E4E0]";
  return (
    <div className="grid gap-2" data-teste="barra-edicao">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={botao} onClick={aoDesfazer} disabled={!e.podeDesfazer} title="Desfazer (Ctrl+Z)" aria-keyshortcuts="Control+Z">↶ Desfazer</button>
        <button type="button" className={botao} onClick={aoRefazer} disabled={!e.podeRefazer} title="Refazer (Ctrl+Shift+Z)" aria-keyshortcuts="Control+Shift+Z">↷ Refazer</button>
        <button type="button" className={botao} onClick={aoRestaurar}>Restaurar padrão da planta</button>
        <span className="mx-1 hidden h-6 w-px bg-[#E4E4E0] md:block" aria-hidden />
        <button type="button" className={`${botao} border-[#111] font-medium`} onClick={aoSalvar} disabled={!e.podeSalvar} data-teste="salvar">
          {e.ocupado === "salvar" ? "Salvando…" : "Salvar rascunho"}
        </button>
        <button type="button" className={`${botao} border-[#111] bg-[#FFE600] font-medium hover:bg-[#F5DC00]`} onClick={aoPublicar} disabled={!e.podePublicar} data-teste="publicar">
          {e.ocupado === "publicar" ? "Publicando…" : "Publicar"}
        </button>
        <button type="button" className={`${botao} md:ml-auto`} onClick={aoSair}>Sair da edição</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[14px]" aria-live="polite">
        <span className={`rounded border px-2 py-0.5 ${tom}`} data-teste="estado-edicao">{e.estado}</span>
      </div>
      {/* Linha sempre reservada: o aviso aparecer não empurra a tela durante o arraste. */}
      <p className="m-0 min-h-[22px] text-[14px] font-medium leading-[22px] text-[#B42318]" data-teste="motivo-bloqueio">{e.motivoBloqueio ?? ""}</p>
    </div>
  );
}
