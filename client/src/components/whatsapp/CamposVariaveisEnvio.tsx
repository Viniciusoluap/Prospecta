// Pedido de 25/10 (noite): campos das variáveis que faltam no envio (aba Enviar mensagem).
// Digitação livre (estado local); a validação acontece só na prévia (com atraso) e ao enviar.
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { DOCUMENTOS_CHECKLIST, VARIAVEIS_TEMPLATE, listaPorExtenso } from "@shared/whatsapp/variaveis";

const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";

/** {{imovel}}: imóvel cadastrado (busca por título/endereço) ou texto livre. */
export function CampoImovel({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const imoveis = trpc.whatsapp.imoveisParaEnvio.useQuery(undefined, { staleTime: 60_000 });
  const [aberto, setAberto] = useState(false);
  const opcoes = useMemo(() => (imoveis.data ?? []).map(i => ({
    id: i.id,
    texto: [i.titulo, i.endereco || [i.bairro, i.cidade && i.cidade !== "Não informada" ? i.cidade : null].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
  })), [imoveis.data]);
  const termo = valor.trim().toLowerCase();
  const filtradas = opcoes.filter(o => !termo || o.texto.toLowerCase().includes(termo)).slice(0, 8);
  return (
    <div className="relative">
      <Input value={valor} placeholder="Escolha um imóvel cadastrado ou digite" className={`${inputCls} mt-1`}
        onChange={e => { onChange(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)} />
      {aberto && filtradas.length > 0 && !opcoes.some(o => o.texto === valor) && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[#C9A961]/30 bg-[#0F1923] text-sm shadow-lg">
          {filtradas.map(o => (
            <li key={o.id}>
              <button type="button" role="option" aria-selected={false} className="w-full px-3 py-2 text-left text-gray-100 hover:bg-[#C9A961]/10"
                onMouseDown={e => e.preventDefault()} onClick={() => { onChange(o.texto); setAberto(false); }}>{o.texto}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** {{documentos}}: checklist do lead com marcação múltipla (+ texto livre opcional). */
export function CampoDocumentos({ marcados, livre, onChange, pendentes }: {
  marcados: string[]; livre: string; pendentes?: string[];
  onChange: (marcados: string[], livre: string) => void;
}) {
  return (
    <div className="mt-1 space-y-1 rounded border border-[#C9A961]/20 p-2">
      {DOCUMENTOS_CHECKLIST.map(d => (
        <label key={d.chave} className="flex items-center gap-2 text-xs text-gray-200">
          <input type="checkbox" className="accent-[#C9A961]" checked={marcados.includes(d.chave)}
            onChange={e => onChange(e.target.checked ? [...marcados, d.chave] : marcados.filter(x => x !== d.chave), livre)} />
          {d.rotulo}{pendentes?.includes(d.chave) && <span className="text-[10px] text-yellow-300">(pendente)</span>}
        </label>
      ))}
      <Input value={livre} placeholder="Outro documento (opcional)" className={`${inputCls} mt-1 h-8 text-xs`} onChange={e => onChange(marcados, e.target.value)} />
    </div>
  );
}

/** Texto final de {{documentos}}: itens marcados (na ordem do checklist) + texto livre, por extenso. */
export function textoDocumentosMarcados(marcados: string[], livre: string): string {
  return listaPorExtenso([...DOCUMENTOS_CHECKLIST.filter(d => marcados.includes(d.chave)).map(d => d.rotulo), livre.trim()]);
}

/** Campo genérico (horário, banco, endereço…): texto livre. */
export function CampoTexto({ nome, valor, onChange }: { nome: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-gray-300">{VARIAVEIS_TEMPLATE[nome] ?? nome}</Label>
      <Input value={valor} onChange={e => onChange(e.target.value)} className={`${inputCls} mt-1`} />
    </div>
  );
}
