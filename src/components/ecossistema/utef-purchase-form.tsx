"use client";

/* eslint-disable @next/next/no-img-element -- O QR Code é uma data URL efêmera devolvida pelo provedor de pagamento. */

import { useState } from "react";

type Result = { error?: string; pixQrCode?: string; pixCopyPaste?: string; invoiceUrl?: string; bankSlipUrl?: string };

export function UtefPurchaseForm() {
  const [amount, setAmount] = useState(100);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    const response = await fetch("/api/ecossistema/utef/comprar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, paymentMethod }),
    });
    const data = (await response.json()) as Result;
    setResult(data);
    setLoading(false);
  }

  return <form onSubmit={submit} className="bg-white p-6 border border-gray-100 shadow-sm space-y-5">
    <label className="block text-sm font-bold">Quantidade de UTEFs<input type="number" min={1} max={1000000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} className="mt-2 w-full border border-gray-200 p-3 font-normal" /></label>
    <label className="block text-sm font-bold">Pagamento<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-2 w-full border border-gray-200 p-3 bg-white font-normal"><option value="pix">PIX</option><option value="credit_card">Cartão de crédito</option><option value="boleto">Boleto</option></select></label>
    <p className="text-sm text-gray-500">1 UTEF = R$ 1,00. Compras a partir de 1.000 UTEFs recebem 10% de bônus após a confirmação.</p>
    <button disabled={loading} className="w-full bg-[var(--brand-accent)] text-[var(--brand-dark)] py-3 font-black uppercase disabled:opacity-50">{loading ? "Gerando cobrança..." : `Comprar ${amount.toLocaleString("pt-BR")} UTEF`}</button>
    {result?.error && <p role="alert" className="bg-red-50 text-red-700 p-3">{result.error}</p>}
    {result?.pixQrCode && <img src={`data:image/png;base64,${result.pixQrCode}`} alt="QR Code PIX" className="w-56 h-56 mx-auto" />}
    {result?.pixCopyPaste && <textarea readOnly value={result.pixCopyPaste} className="w-full min-h-28 border p-3 text-xs" aria-label="Código PIX copia e cola" />}
    {(result?.invoiceUrl || result?.bankSlipUrl) && <a href={result.bankSlipUrl ?? result.invoiceUrl} target="_blank" rel="noreferrer" className="block text-center bg-[var(--brand-dark)] text-white py-3 font-bold">Abrir cobrança</a>}
  </form>;
}
