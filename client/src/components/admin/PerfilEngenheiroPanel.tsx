// Lote 2, correção 04 (AD-02): dados profissionais e documentos do Engenheiro, em
// Configurações › Usuários. Só o admin edita; o próprio usuário pode consultar.
import { FormEvent, useEffect, useState } from "react";
import { Download, Eye, FileArchive, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { enviarPartes } from "@/lib/documentos-partes";
import { baixarDocumentoUsuario, baixarTodosDocumentosUsuario, visualizarDocumentoUsuario } from "@/lib/documentos-usuario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACCEPT_DOCUMENTO_USUARIO, CATEGORIAS_DOCUMENTO_USUARIO, LIMITE_DOCUMENTO_USUARIO_BYTES, ROTULO_CATEGORIA_DOCUMENTO, UFS,
  type CategoriaDocumentoUsuario,
} from "@shared/engenheiro";

type Form = { telefone: string; cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; crea: string; creaUf: string; creasAdicionais: { numero: string; uf: string }[] };
const VAZIO: Form = { telefone: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", crea: "", creaUf: "", creasAdicionais: [] };
const campo = "mt-1 border-[#C9A961]/30 bg-[#2C3E50] text-white placeholder:text-gray-400";
const seletor = "mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-sm text-white";
const tamanho = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export function PerfilEngenheiroPanel({ userId }: { userId: number }) {
  const utils = trpc.useUtils();
  const consulta = trpc.engenheiros.perfil.useQuery({ userId });
  const dados = consulta.data;
  const [form, setForm] = useState<Form>(VAZIO);
  const [categoria, setCategoria] = useState<CategoriaDocumentoUsuario>("documento_pessoal");
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    if (!dados) return;
    const p = dados.perfil;
    setForm({ telefone: p.telefone ?? "", cep: p.cep ?? "", logradouro: p.logradouro ?? "", numero: p.numero ?? "", complemento: p.complemento ?? "", bairro: p.bairro ?? "", cidade: p.cidade ?? "", uf: p.uf ?? "", crea: p.crea ?? "", creaUf: p.creaUf ?? "", creasAdicionais: p.creasAdicionais });
  }, [dados]);

  const recarregar = () => utils.engenheiros.perfil.invalidate({ userId });
  const salvar = trpc.engenheiros.salvarPerfil.useMutation({ onSuccess: async () => { await recarregar(); toast.success("Dados do engenheiro salvos"); }, onError: e => toast.error(e.message) });
  const enviar = trpc.engenheiros.enviarDocumento.useMutation();
  const excluir = trpc.engenheiros.excluirDocumento.useMutation();
  const pode = !!dados?.podeGerenciar;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  function onSalvar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate({ userId, ...form, creasAdicionais: form.creasAdicionais.filter(c => c.numero.trim() || c.uf) });
  }

  async function enviarArquivos(arquivos: File[], cat: CategoriaDocumentoUsuario, substituirId?: number) {
    if (!arquivos.length) return;
    const grandes = arquivos.filter(f => !f.size || f.size > LIMITE_DOCUMENTO_USUARIO_BYTES);
    if (grandes.length) { toast.error(`Envie arquivos de até 15 MB: ${grandes.map(f => f.name).join(", ")}`); return; }
    let ok = 0;
    for (let i = 0; i < arquivos.length; i++) {
      const file = arquivos[i];
      setOcupado(`Enviando ${i + 1}/${arquivos.length}: ${file.name}`);
      try {
        const uploadId = await enviarPartes(file, `usuario:${userId}:${cat}`);
        await enviar.mutateAsync({ userId, categoria: cat, uploadId, fileName: file.name, substituirId });
        ok++;
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "falha no envio"}`);
      }
    }
    setOcupado(null);
    await recarregar();
    if (ok) toast.success(substituirId ? "Documento substituído" : `${ok} documento(s) enviado(s)`);
  }

  async function executar(rotulo: string, fn: () => Promise<unknown>) {
    setOcupado(rotulo);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Falha na operação"); } finally { setOcupado(null); }
  }

  if (consulta.isLoading) return <p className="text-sm text-gray-300">Carregando dados do engenheiro…</p>;
  if (consulta.error || !dados) return <p className="text-sm text-red-300">{consulta.error?.message ?? "Não foi possível carregar o perfil."}</p>;
  const docs = dados.documentos;

  return <div className="space-y-5 rounded-lg border border-[#C9A961]/30 p-4">
    <form onSubmit={onSalvar} className="space-y-3">
      <h3 className="font-semibold text-[#C9A961]">Dados do engenheiro</h3>
      <p className="text-xs text-gray-300">Nome e e-mail vêm do cadastro do usuário ({dados.usuario.nome} · {dados.usuario.email}).</p>
      <fieldset disabled={!pode} className="grid gap-3 md:grid-cols-3">
        <div><Label>Telefone</Label><Input value={form.telefone} onChange={set("telefone")} className={campo} inputMode="tel" /></div>
        <div><Label>Nº do CREA</Label><Input value={form.crea} onChange={set("crea")} className={campo} /></div>
        <div><Label>UF do CREA</Label><select aria-label="UF do CREA" value={form.creaUf} onChange={set("creaUf")} className={seletor}><option value="">—</option>{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></div>
        <div><Label>CEP</Label><Input value={form.cep} onChange={set("cep")} className={campo} inputMode="numeric" placeholder="00000-000" /></div>
        <div className="md:col-span-2"><Label>Logradouro</Label><Input value={form.logradouro} onChange={set("logradouro")} className={campo} /></div>
        <div><Label>Número</Label><Input value={form.numero} onChange={set("numero")} className={campo} /></div>
        <div><Label>Complemento</Label><Input value={form.complemento} onChange={set("complemento")} className={campo} /></div>
        <div><Label>Bairro</Label><Input value={form.bairro} onChange={set("bairro")} className={campo} /></div>
        <div><Label>Cidade</Label><Input value={form.cidade} onChange={set("cidade")} className={campo} /></div>
        <div><Label>UF</Label><select aria-label="UF do endereço" value={form.uf} onChange={set("uf")} className={seletor}><option value="">—</option>{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></div>
        <div className="md:col-span-3 space-y-2">
          <Label>CREAs adicionais (outros estados)</Label>
          {form.creasAdicionais.map((c, i) => <div key={i} className="flex gap-2">
            <Input aria-label={`Nº do CREA adicional ${i + 1}`} value={c.numero} onChange={e => setForm(f => ({ ...f, creasAdicionais: f.creasAdicionais.map((x, j) => j === i ? { ...x, numero: e.target.value } : x) }))} className={campo} placeholder="Número" />
            <select aria-label={`UF do CREA adicional ${i + 1}`} value={c.uf} onChange={e => setForm(f => ({ ...f, creasAdicionais: f.creasAdicionais.map((x, j) => j === i ? { ...x, uf: e.target.value } : x) }))} className={`${seletor} max-w-[6rem]`}><option value="">UF</option>{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select>
            <Button type="button" variant="ghost" size="icon" aria-label="Remover CREA adicional" onClick={() => setForm(f => ({ ...f, creasAdicionais: f.creasAdicionais.filter((_, j) => j !== i) }))}><X className="h-4 w-4" /></Button>
          </div>)}
          <Button type="button" variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, creasAdicionais: [...f.creasAdicionais, { numero: "", uf: "" }] }))}><Plus className="mr-1 h-4 w-4" /> Adicionar CREA de outro estado</Button>
        </div>
      </fieldset>
      {pode && <Button type="submit" disabled={salvar.isPending} className="bg-[#C9A961] text-[#1A2332]">Salvar dados do engenheiro</Button>}
    </form>

    <div className="space-y-3 border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-[#C9A961]">Documentos</h3>
        <Button type="button" variant="outline" size="sm" disabled={!docs.length || !!ocupado} onClick={() => executar("Montando o ZIP…", () => baixarTodosDocumentosUsuario(userId, dados.usuario.nome, docs))}><FileArchive className="mr-1 h-4 w-4" /> Baixar todos (ZIP)</Button>
      </div>
      {pode && <div className="flex flex-wrap items-end gap-2">
        <div><Label>Categoria</Label><select aria-label="Categoria do documento" value={categoria} onChange={e => setCategoria(e.target.value as CategoriaDocumentoUsuario)} className={seletor}>{CATEGORIAS_DOCUMENTO_USUARIO.map(c => <option key={c} value={c}>{ROTULO_CATEGORIA_DOCUMENTO[c]}</option>)}</select></div>
        <label className="inline-flex cursor-pointer items-center rounded-md bg-[#C9A961] px-3 py-2 text-sm font-semibold text-[#1A2332]"><Upload className="mr-1 h-4 w-4" /> Enviar arquivos<input type="file" multiple className="sr-only" accept={ACCEPT_DOCUMENTO_USUARIO} disabled={!!ocupado} onChange={e => { const lista = Array.from(e.target.files ?? []); e.currentTarget.value = ""; void enviarArquivos(lista, categoria); }} /></label>
        <p className="text-xs text-gray-400">PDF, imagem, Word ou Excel · até 15 MB cada · vários de uma vez.</p>
      </div>}
      {ocupado && <p role="status" className="text-sm text-[#C9A961]">{ocupado}</p>}
      {!docs.length && <p className="text-sm text-gray-400">Nenhum documento enviado.</p>}
      {CATEGORIAS_DOCUMENTO_USUARIO.filter(c => docs.some(d => d.categoria === c)).map(c => <div key={c} className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">{ROTULO_CATEGORIA_DOCUMENTO[c]}</p>
        {docs.filter(d => d.categoria === c).map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#2C3E50] p-2 text-sm">
          <div className="min-w-0"><p className="break-all font-medium">{d.nome}</p><p className="text-xs text-gray-400">{tamanho(d.tamanho)} · {new Date(d.enviadoEm).toLocaleString("pt-BR")}{d.enviadoPorNome ? ` · por ${d.enviadoPorNome}` : ""}</p></div>
          <div className="flex flex-wrap gap-1">
            {d.visualizavel && <Button type="button" size="sm" variant="ghost" disabled={!!ocupado} onClick={() => executar("Abrindo…", () => visualizarDocumentoUsuario(userId, d))}><Eye className="mr-1 h-4 w-4" />Visualizar</Button>}
            <Button type="button" size="sm" variant="ghost" disabled={!!ocupado} onClick={() => executar("Baixando…", () => baixarDocumentoUsuario(userId, d))}><Download className="mr-1 h-4 w-4" />Baixar</Button>
            {pode && <label className="inline-flex cursor-pointer items-center rounded-md px-2 text-sm hover:bg-white/10"><RefreshCw className="mr-1 h-4 w-4" />Substituir<input type="file" className="sr-only" accept={ACCEPT_DOCUMENTO_USUARIO} disabled={!!ocupado} onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f && window.confirm(`Substituir "${d.nome}" por "${f.name}"? O arquivo anterior será descartado.`)) void enviarArquivos([f], c, d.id); }} /></label>}
            {pode && <Button type="button" size="sm" variant="ghost" className="text-red-300" disabled={!!ocupado} onClick={() => { if (window.confirm(`Excluir "${d.nome}"? O arquivo será apagado definitivamente.`)) void executar("Excluindo…", async () => { await excluir.mutateAsync({ userId, id: d.id }); await recarregar(); toast.success("Documento excluído"); }); }}><Trash2 className="mr-1 h-4 w-4" />Excluir</Button>}
          </div>
        </div>)}
      </div>)}
    </div>
  </div>;
}
