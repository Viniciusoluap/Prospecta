"use client";

import { useState } from "react";

export function BudgetRequestForm() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/orcamentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const result = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Solicitação enviada. Nossa equipe entrará em contato." : (result.error ?? "Não foi possível enviar."));
    if (response.ok) event.currentTarget.reset();
    setLoading(false);
  }
  return <form onSubmit={submit} className="bg-white border border-gray-100 shadow-sm p-6 grid md:grid-cols-2 gap-4">
    <input name="name" required placeholder="Nome completo" className="border p-3" /><input name="email" required type="email" placeholder="E-mail" className="border p-3" /><input name="phone" placeholder="Telefone / WhatsApp" className="border p-3" /><input name="city" placeholder="Cidade" className="border p-3" />
    <select name="projectType" className="border p-3 bg-white"><option value="">Tipo de projeto</option><option value="residencial">Residencial</option><option value="comercial">Comercial</option><option value="reforma">Reforma</option><option value="avaliacao">Avaliação imobiliária</option></select>
    <select name="hasLot" defaultValue="not_sure" className="border p-3 bg-white"><option value="yes">Já tenho terreno</option><option value="no">Ainda não tenho terreno</option><option value="not_sure">Quero orientação</option></select>
    <textarea name="message" placeholder="Conte um pouco sobre o seu projeto" className="border p-3 md:col-span-2 min-h-32" />
    <button disabled={loading} className="md:col-span-2 bg-[var(--brand-accent)] text-[var(--brand-dark)] py-3 font-black uppercase disabled:opacity-50">{loading ? "Enviando..." : "Solicitar orçamento"}</button>
    {message && <p className="md:col-span-2 text-sm" role="status">{message}</p>}
  </form>;
}
