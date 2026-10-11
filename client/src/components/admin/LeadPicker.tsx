import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export type LeadPickerOption = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * EPIC-017 — seletor buscável de lead já cadastrado no CRM. Substitui o
 * cadastro manual de cliente nos módulos operacionais (os dados migram do lead).
 */
export function LeadPicker({
  leads,
  value,
  onChange,
  loading = false,
  disabled = false,
  label = "Lead do CRM",
}: {
  leads: LeadPickerOption[];
  value: number | null;
  onChange: (leadId: number | null) => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const selected = leads.find(lead => lead.id === value) ?? null;
  const matches = useMemo(() => {
    const term = normalize(search.trim());
    const list = term
      ? leads.filter(lead =>
          normalize(`${lead.name} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.city ?? ""} #${lead.id}`).includes(term)
        )
      : leads;
    return list.slice(0, 8);
  }, [leads, search]);

  if (selected) {
    return (
      <div className="space-y-1">
        <span className="text-sm text-gray-300">{label} *</span>
        <div className="flex items-center justify-between gap-2 rounded-md border border-[#C9A961]/50 bg-[#2C3E50] px-3 py-2 text-white">
          <div className="min-w-0">
            <p className="truncate font-medium">{selected.name}</p>
            <p className="truncate text-xs text-gray-300">
              {[selected.phone, selected.email, selected.city].filter(Boolean).join(" · ") || `Lead #${selected.id}`}
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded p-1 text-gray-300 hover:bg-white/10 hover:text-white"
              aria-label="Trocar lead"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-300" htmlFor="lead-picker-search">{label} *</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          id="lead-picker-search"
          value={search}
          disabled={disabled}
          onChange={event => setSearch(event.target.value)}
          placeholder="Buscar por nome, telefone, e-mail ou cidade"
          className="border-[#C9A961]/30 bg-[#2C3E50] pl-9 text-white placeholder:text-gray-400"
        />
      </div>
      <ul role="listbox" aria-label="Leads encontrados" className="max-h-56 overflow-y-auto rounded-md border border-white/10 bg-[#1A2332]">
        {loading && <li className="px-3 py-2 text-sm text-gray-300">Carregando leads…</li>}
        {!loading && matches.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-300">
            Nenhum lead encontrado. Cadastre o cliente no CRM antes de abrir o serviço.
          </li>
        )}
        {matches.map(lead => (
          <li key={lead.id} role="option" aria-selected={false}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => { onChange(lead.id); setSearch(""); }}
              className="w-full px-3 py-2 text-left text-sm text-white hover:bg-[#C9A961]/15"
            >
              <span className="font-medium">{lead.name}</span>
              <span className="ml-2 text-xs text-gray-400">
                {[lead.phone, lead.city].filter(Boolean).join(" · ") || `#${lead.id}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
