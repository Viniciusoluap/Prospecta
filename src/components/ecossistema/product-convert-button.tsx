"use client";

import { useState } from "react";

export function ProductConvertButton({ productId }: { productId: number }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function convert() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/ecossistema/produtos/${productId}/converter`, { method: "POST" });
    const data = (await response.json()) as { error?: string; message?: string };
    setMessage(data.error ?? data.message ?? "Solicitação registrada.");
    setLoading(false);
  }

  return (
    <div>
      <button type="button" onClick={convert} disabled={loading} className="w-full bg-[var(--brand-dark)] text-[var(--brand-yellow)] py-3 font-bold uppercase tracking-wide text-sm disabled:opacity-50">
        {loading ? "Convertendo..." : "Converter UTEFs"}
      </button>
      {message && <p className="text-sm mt-3 text-gray-600" role="status">{message}</p>}
    </div>
  );
}
