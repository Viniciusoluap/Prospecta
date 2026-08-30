"use client";

import { useState } from "react";

type Profile = { name: string; email: string; cpf: string; phone: string; address: string; city: string; state: string; zipCode: string };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage("");
    const response = await fetch("/api/ecossistema/perfil", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Perfil atualizado." : (data.error ?? "Não foi possível atualizar.")); setLoading(false);
  }
  return <form onSubmit={submit} className="bg-white p-6 border border-gray-100 grid md:grid-cols-2 gap-4">
    {([['name','Nome'],['email','E-mail'],['cpf','CPF'],['phone','Telefone'],['address','Endereço'],['city','Cidade'],['state','Estado'],['zipCode','CEP']] as const).map(([name, label]) => <label key={name} className={name === "address" ? "md:col-span-2 text-sm font-bold" : "text-sm font-bold"}>{label}<input name={name} type={name === "email" ? "email" : "text"} defaultValue={profile[name]} className="mt-1 w-full border p-3 font-normal" /></label>)}
    <button disabled={loading} className="md:col-span-2 bg-[var(--brand-dark)] text-[var(--brand-yellow)] py-3 font-bold disabled:opacity-50">{loading ? "Salvando..." : "Salvar perfil"}</button>{message && <p className="md:col-span-2 text-sm" role="status">{message}</p>}
  </form>;
}
