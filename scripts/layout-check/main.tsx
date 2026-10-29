import "./harness.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Casos reproduzem a marcação das telas de foco (BPO › Editar lançamento,
// modal tributário, filtros do DRE, tabela de movimentações) com os
// componentes reais da base compartilhada.
const caso = new URLSearchParams(location.search).get("caso") ?? "editar";
const campo = "bg-[#2C3E50] border-[#C9A961]/30 text-white";

function EditarLancamento() {
  const [valor, setValor] = useState(1234567.89);
  return (
    <Dialog open>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-[#C9A961]">Editar lançamento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-teste="grade">
          <div className="sm:col-span-2"><Label>Descrição</Label><Input defaultValue="Honorários de regularização de obra — parcela muito longa para caber" className={campo} /></div>
          <div><Label>Valor (R$)</Label><CurrencyInput value={valor} onChange={setValor} className={campo} /></div>
          <div><Label>Vencimento</Label><Input type="date" defaultValue="2026-10-29" className={campo} /></div>
          <div><Label>Competência</Label><Input type="month" defaultValue="2026-10" className={campo} /></div>
          <div><Label>Categoria operacional</Label>
            <Select defaultValue="obras"><SelectTrigger className={`w-full ${campo}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="obras">Obras</SelectItem><SelectItem value="regularizacoes">Regularizações</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Observações</Label><Textarea className={campo} /></div>
          <div className="sm:col-span-2"><Label>Motivo da alteração *</Label><Textarea className={campo} /></div>
          <Button className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]">Salvar edição</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModalTributario() {
  return (
    <Dialog open>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
        <DialogHeader><DialogTitle>Registrar guia de imposto</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2" data-teste="grade">
          <div><Label>Tributo</Label><Input defaultValue="DAS — Simples Nacional" className={campo} /></div>
          <div><Label>Competência</Label><Input type="month" defaultValue="2026-09" className={campo} /></div>
          <div><Label>Vencimento</Label><Input type="date" defaultValue="2026-10-20" className={campo} /></div>
          <div><Label>Pagamento</Label><Input type="date" defaultValue="2026-10-19" className={campo} /></div>
          <div><Label>Valor</Label><CurrencyInput value={98765.43} onChange={() => {}} className={campo} /></div>
          <div><Label>Alíquota</Label><PercentInput value={6} onChange={() => {}} className={campo} /></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FiltrosETabela() {
  return (
    <div className="min-h-screen bg-[#0F1419] p-4 text-white">
      <div className="mb-4 flex flex-wrap items-end gap-3" data-teste="filtros">
        <div className="min-w-[160px] flex-1 sm:flex-none"><Label>Mês</Label><select className="mt-1 h-10 w-full rounded-md border bg-[#1A2332] px-2"><option>Todos os meses</option></select></div>
        <div className="min-w-[120px] flex-1 sm:flex-none"><Label>Ano</Label><select className="mt-1 h-10 w-full rounded-md border bg-[#1A2332] px-2"><option>Todos os anos</option></select></div>
        <div className="flex-1 min-w-[140px]"><Label>De</Label><Input type="date" defaultValue="2026-01-01" className={campo} /></div>
        <div className="flex-1 min-w-[140px]"><Label>Até</Label><Input type="date" defaultValue="2026-12-31" className={campo} /></div>
      </div>
      <div className="max-h-96 overflow-auto rounded border" data-teste="rolagem-tabela">
        <table className="w-full min-w-[640px] text-xs">
          <thead><tr><th className="p-1 text-left">Data</th><th className="p-1 text-left">Descrição</th><th className="p-1 text-left">Titular</th><th className="p-1 text-left">Categoria</th><th className="p-1 text-left">Cliente BPO</th><th className="p-1 text-right">Valor</th></tr></thead>
          <tbody>{Array.from({ length: 8 }, (_, i) => <tr key={i}><td className="p-1 whitespace-nowrap">29/10/2026</td><td className="p-1">PIX recebido de cliente com descrição longa {i}</td><td className="p-1">Fulano de Tal</td><td className="p-1">Recebimento</td><td className="p-1">Cliente {i}</td><td className="p-1 text-right">R$ 1.000.000,00</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

const Caso = caso === "tributario" ? ModalTributario : caso === "filtros" ? FiltrosETabela : EditarLancamento;
createRoot(document.getElementById("root")!).render(<Caso />);
