"use client";

import { useState } from "react";

export function PaymentSettingsClient({ configured, environment }: { configured: boolean; environment: "sandbox" | "production" }) {
  const [apiKey, setApiKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [env, setEnv] = useState(environment);
  const [message, setMessage] = useState(configured ? "Asaas configurado e ativo." : "Asaas ainda não configurado.");
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("Validando credenciais...");
    const response = await fetch("/api/admin/payment-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, webhookToken, environment: env }),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Credenciais validadas, criptografadas e salvas." : (data.error ?? "Falha ao salvar."));
    if (response.ok) { setApiKey(""); setWebhookToken(""); }
    setSaving(false);
  }

  return <form onSubmit={save} className="bg-white border border-gray-100 p-5 space-y-4">
    <div><p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Pagamentos Asaas</p><p className="text-xs text-gray-400 mt-1">As credenciais são validadas antes de serem armazenadas com criptografia AES-256-GCM.</p></div>
    <label className="block text-xs font-bold text-gray-500 uppercase">Ambiente<select value={env} onChange={(event) => setEnv(event.target.value as "sandbox" | "production")} className="mt-1 w-full border border-gray-200 p-2.5 bg-gray-50 font-normal normal-case"><option value="sandbox">Sandbox</option><option value="production">Produção</option></select></label>
    <label className="block text-xs font-bold text-gray-500 uppercase">Nova chave de API<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="mt-1 w-full border border-gray-200 p-2.5 bg-gray-50 font-normal normal-case" /></label>
    <label className="block text-xs font-bold text-gray-500 uppercase">Token do webhook<input type="password" autoComplete="new-password" value={webhookToken} onChange={(event) => setWebhookToken(event.target.value)} className="mt-1 w-full border border-gray-200 p-2.5 bg-gray-50 font-normal normal-case" /></label>
    <button disabled={saving} className="bg-[var(--brand-yellow)] text-[var(--brand-dark)] px-6 py-2.5 text-xs font-bold uppercase tracking-wide disabled:opacity-50">{saving ? "Salvando..." : "Validar e salvar"}</button>
    <p className="text-xs text-gray-500" role="status">{message}</p>
  </form>;
}
