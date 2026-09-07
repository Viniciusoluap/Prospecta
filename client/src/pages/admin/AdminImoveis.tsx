import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Building2, Plus, Search, Pencil, Eye, Ban } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  alugado: "Alugado",
};

const STATUS_COLORS: Record<string, string> = {
  disponivel: "bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/40",
  reservado: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  vendido: "bg-red-500/20 text-red-400 border border-red-500/40",
  alugado: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
};

function formatCurrencyBR(value: string | number) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

export default function AdminImoveis() {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");

  const { data: imoveis = [], isLoading, refetch } = trpc.imoveis.list.useQuery({ adminView: true });

  const updateMutation = trpc.imoveis.update.useMutation({
    onSuccess: () => { toast.success("Imóvel excluído."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const filtrados = useMemo(() => {
    return imoveis.filter((i: any) => {
      if (status !== "todos" && i.status !== status) return false;
      if (busca.trim()) {
        const termo = busca.trim().toLowerCase();
        if (!`${i.titulo} ${i.bairro ?? ""} ${i.cidade} ${i.tipo}`.toLowerCase().includes(termo)) return false;
      }
      return true;
    });
  }, [imoveis, busca, status]);

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">Imóveis</h1>
              <p className="text-gray-400 text-sm">{imoveis.length} imóveis cadastrados</p>
            </div>
          </div>
          <Link href="/admin/imoveis/novo">
            <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              <Plus className="h-4 w-4 mr-2" /> Novo Imóvel
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Buscar por título, bairro, tipo..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9 bg-[#2C3E50] border-[#C9A961]/30 text-white placeholder:text-gray-500"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-48 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as situações</SelectItem>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-[#2C3E50]/40 border border-[#C9A961]/20 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0F1923] text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-gray-400 uppercase tracking-wide">Imóvel</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-400 uppercase tracking-wide hidden md:table-cell">Tipo</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-400 uppercase tracking-wide hidden lg:table-cell">Localização</th>
                  <th className="px-4 py-3 text-right font-bold text-gray-400 uppercase tracking-wide">Preço</th>
                  <th className="px-4 py-3 text-center font-bold text-gray-400 uppercase tracking-wide hidden md:table-cell">Situação</th>
                  <th className="px-4 py-3 text-center font-bold text-gray-400 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9A961]/10">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
                ) : filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <Building2 className="h-12 w-12 text-[#C9A961]/40 mx-auto mb-3" />
                      <p className="text-gray-400">Nenhum imóvel encontrado</p>
                    </td>
                  </tr>
                ) : (
                  filtrados.map((imovel: any) => (
                    <tr key={imovel.id} className="hover:bg-[#C9A961]/5 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white leading-tight">{imovel.titulo}</p>
                        {imovel.destaque && (
                          <span className="text-[10px] bg-[#C9A961] text-[#1A2332] font-black px-1.5 py-0.5 uppercase">Destaque</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-300">{imovel.tipo}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-gray-300">
                        {[imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#00FF00]">{formatCurrencyBR(imovel.preco)}</td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <Badge className={STATUS_COLORS[imovel.status] ?? ""}>{STATUS_LABELS[imovel.status] ?? imovel.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <a href={`/imoveis/${imovel.slug}`} target="_blank" rel="noopener noreferrer" title="Ver no site">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </a>
                          <Link href={`/admin/imoveis/${imovel.id}/editar`} title="Editar">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-blue-400">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-red-400 disabled:opacity-30"
                            title="Marcar como vendido e despublicar"
                            disabled={imovel.status === "vendido"}
                            onClick={() => {
                              if (!confirm(`Marcar "${imovel.titulo}" como vendido e remover da publicação no site?`)) return;
                              updateMutation.mutate({ id: imovel.id, status: "vendido", publicadoSite: false });
                            }}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
