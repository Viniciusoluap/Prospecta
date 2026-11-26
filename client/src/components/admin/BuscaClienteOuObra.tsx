// E12 (EPIC-025) — pedido do dono de 26/11/2026: "eu quero poder procurar pelo nome e não só pelo número que eu nem sei decorar".
// Campo de busca do cliente do CRM (ou da obra) pelo NOME, usado ao cadastrar/classificar grupos (cartão da Dolores e Central
// WhatsApp). O que vai ao servidor continua sendo o id. A busca é a rota `dolores.grupos.buscarVinculo` (só admin; só id + nome).
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export type TipoVinculo = "cliente" | "obra";

export function BuscaClienteOuObra({
  id,
  tipo,
  value,
  nomeAtual,
  onChange,
  className = "",
}: {
  id: string;
  tipo: TipoVinculo;
  value: number | null;
  /** nome do vínculo atual, quando a tela já tem (sem ele aparece "nº N" até escolher outro) */
  nomeAtual?: string | null;
  onChange: (id: number | null) => void;
  className?: string;
}) {
  const [termo, setTermo] = useState("");
  const [buscado, setBuscado] = useState("");
  const [escolhido, setEscolhido] = useState<{ id: number; nome: string } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setBuscado(termo.trim()), 300);
    return () => clearTimeout(t);
  }, [termo]);
  const pronto = buscado.length >= 2;
  const achados = trpc.dolores.grupos.buscarVinculo.useQuery({ tipo, termo: buscado }, { enabled: pronto && value == null, retry: false });
  const rotulo = tipo === "cliente" ? "cliente" : "obra";

  if (value != null) {
    const nome = escolhido?.id === value ? escolhido.nome : nomeAtual || `${rotulo} nº ${value}`;
    return (
      <div className={`mt-1 flex min-h-8 w-64 max-w-full items-center justify-between gap-2 rounded border border-[#C9A961]/50 bg-[#1A2332] px-2 py-1 text-xs text-white ${className}`}>
        <span className="truncate" title={nome}>{nome}</span>
        <button type="button" onClick={() => { setEscolhido(null); setTermo(""); setBuscado(""); onChange(null); }}
          className="shrink-0 rounded p-1 text-gray-300 hover:bg-white/10 hover:text-white" aria-label={`Trocar ${rotulo}`}>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const lista = achados.data ?? [];
  return (
    <div className={`mt-1 w-64 max-w-full ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <Input id={id} value={termo} onChange={e => setTermo(e.target.value)} autoComplete="off"
          placeholder={tipo === "cliente" ? "Digite o nome do cliente" : "Digite o nome da obra"}
          className="h-8 border-[#C9A961]/30 bg-[#1A2332] pl-7 text-xs text-white placeholder:text-gray-400" />
      </div>
      {termo.trim().length > 0 && (
        <ul role="listbox" aria-label={tipo === "cliente" ? "Clientes encontrados" : "Obras encontradas"}
          className="mt-1 max-h-52 overflow-y-auto rounded border border-white/10 bg-[#1A2332] text-xs">
          {termo.trim().length < 2 && <li className="px-2 py-2 text-gray-400">Digite ao menos 2 letras.</li>}
          {termo.trim().length >= 2 && (!pronto || achados.isLoading) && <li className="px-2 py-2 text-gray-400">Procurando…</li>}
          {pronto && achados.error && <li className="px-2 py-2 text-red-300">{achados.error.message}</li>}
          {pronto && !achados.isLoading && !achados.error && lista.length === 0 && (
            <li className="px-2 py-2 text-gray-400">{tipo === "cliente" ? "Nenhum cliente com esse nome no CRM." : "Nenhuma obra com esse nome."}</li>
          )}
          {pronto && lista.map(item => (
            <li key={item.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => { setEscolhido(item); onChange(item.id); }}
                className="w-full px-2 py-2 text-left text-white hover:bg-[#C9A961]/15 active:bg-[#C9A961]/25">
                {item.nome} <span className="text-gray-400">· nº {item.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
