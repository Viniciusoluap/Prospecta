"use client";

/* eslint-disable @next/next/no-img-element -- O QR Code é uma data URL efêmera devolvida pelo provedor de pagamento. */

import { useState } from "react";

type PaymentResult = {
  invoiceUrl?: string;
  bankSlipUrl?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  error?: string;
};

export function TicketPurchaseForm({ drawId, ticketPrice }: { drawId: number; ticketPrice: number }) {
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    const response = await fetch("/api/ecossistema/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drawId, quantity, paymentMethod }),
    });
    const data = (await response.json()) as PaymentResult;
    setResult(response.ok ? data : { error: data.error ?? "Não foi possível criar a cobrança." });
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className="bg-white border border-gray-100 shadow-sm p-6 space-y-5">
      <label className="block text-sm font-bold text-[var(--brand-dark)]">
        Quantidade
        <input type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-2 w-full border border-gray-200 p-3 font-normal" />
      </label>
      <label className="block text-sm font-bold text-[var(--brand-dark)]">
        Pagamento
        <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-2 w-full border border-gray-200 p-3 font-normal bg-white">
          <option value="pix">PIX</option>
          <option value="credit_card">Cartão de crédito</option>
          <option value="boleto">Boleto</option>
        </select>
      </label>
      <div className="flex justify-between border-t pt-4"><span>Total</span><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((ticketPrice * quantity) / 100)}</strong></div>
      <button disabled={loading} className="w-full bg-[var(--brand-accent)] text-[var(--brand-dark)] py-3 font-black uppercase tracking-wide disabled:opacity-50">
        {loading ? "Gerando cobrança..." : "Continuar para pagamento"}
      </button>
      {result?.error && <p role="alert" className="bg-red-50 text-red-700 p-3 text-sm">{result.error}</p>}
      {result?.pixQrCode && <img src={`data:image/png;base64,${result.pixQrCode}`} alt="QR Code PIX" className="w-56 h-56 mx-auto" />}
      {result?.pixCopyPaste && <textarea readOnly value={result.pixCopyPaste} className="w-full min-h-28 border p-3 text-xs" aria-label="Código PIX copia e cola" />}
      {(result?.invoiceUrl || result?.bankSlipUrl) && <a href={result.bankSlipUrl ?? result.invoiceUrl} target="_blank" rel="noreferrer" className="block text-center bg-[var(--brand-dark)] text-white py-3 font-bold">Abrir cobrança</a>}
    </form>
  );
}
