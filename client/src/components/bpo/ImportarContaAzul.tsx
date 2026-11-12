// Pedido de 12/11: botão "Importar backup Conta Azul" no BPO Financeiro.
// O ZIP baixado em Conta Azul Pro > Meu Plano > Backup é aberto aqui no navegador (só os .csv);
// o servidor relê os CSVs, mostra a prévia e só grava depois da confirmação.
import { useRef, useState } from "react";
import { unzipSync } from "fflate";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";

const LIMITE_ZIP = 30 * 1024 * 1024;

/** CSV em UTF-8 (padrão do backup); se não for UTF-8 válido, Windows-1252 (planilhas antigas). */
function decodificar(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

export async function lerZipContaAzul(arquivo: File): Promise<Record<string, string>> {
  if (arquivo.size > LIMITE_ZIP) throw new Error("O arquivo passa de 30 MB.");
  let conteudo: Record<string, Uint8Array>;
  try {
    conteudo = unzipSync(new Uint8Array(await arquivo.arrayBuffer()), { filter: f => /\.csv$/i.test(f.name) && !f.name.startsWith("__MACOSX/") });
  } catch {
    throw new Error("Não foi possível abrir o ZIP. Envie o arquivo do backup do Conta Azul sem alterar.");
  }
  const arquivos: Record<string, string> = {};
  for (const [nome, bytes] of Object.entries(conteudo)) arquivos[nome.split("/").pop()!] = decodificar(bytes);
  if (!Object.keys(arquivos).length) throw new Error("O ZIP não tem arquivos .csv do Conta Azul.");
  return arquivos;
}

const ROTULO_ARQUIVO: Record<string, string> = {
  "propostas_comerciais.csv": "Propostas comerciais", "lista_precos.csv": "Lista de preços", "nfes.csv": "Notas fiscais (NF-e)",
  "negociacoes.csv": "Vendas/notas com itens", "produtos.csv": "Produtos",
};

export function ImportarContaAzul() {
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = useState<Record<string, string> | null>(null);
  const [lendo, setLendo] = useState(false);
  const utils = trpc.useUtils();
  const previa = trpc.bpo.contaAzul.previa.useMutation({ onError: e => toast.error(e.message) });
  const importar = trpc.bpo.contaAzul.importar.useMutation({
    onSuccess: r => {
      toast.success(`Conta Azul importado: ${r.lancamentosCriados} lançamento(s) e ${r.clientesCriados} cliente(s) novos${r.lancamentosJaImportados ? `; ${r.lancamentosJaImportados} já existiam` : ""}.`);
      setArquivos(null);
      previa.reset();
      void Promise.all([utils.bpo.lancamentos.list.invalidate(), utils.bpo.clientes.list.invalidate(), utils.bpo.dre.invalidate(), utils.bpo.dreCategorias.invalidate(), utils.bpo.dreAnos.invalidate()]);
    },
    onError: e => toast.error(e.message),
  });

  async function escolher(f: File | undefined) {
    if (entrada.current) entrada.current.value = "";
    if (!f) return;
    setLendo(true);
    try {
      const lidos = await lerZipContaAzul(f);
      setArquivos(lidos);
      previa.mutate({ arquivos: lidos });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    } finally {
      setLendo(false);
    }
  }

  const p = previa.data;
  const nadaNovo = p && p.lancamentos.novos === 0 && p.clientesNovos === 0;
  return (
    <>
      <input ref={entrada} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden"
        aria-label="Arquivo ZIP do backup do Conta Azul" onChange={e => void escolher(e.target.files?.[0])} />
      <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961]" disabled={lendo || previa.isPending || importar.isPending}
        onClick={() => entrada.current?.click()}>
        <Upload className="h-4 w-4 mr-2" />
        {lendo || previa.isPending ? "Lendo backup…" : "Importar backup Conta Azul"}
      </Button>
      <Dialog open={Boolean(arquivos && p)} onOpenChange={o => { if (!o && !importar.isPending) { setArquivos(null); previa.reset(); } }}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Importar backup do Conta Azul</DialogTitle></DialogHeader>
          {p && (
            <div className="space-y-4 text-sm min-w-0">
              {p.lancamentosDoExtratoNoPeriodo > 0 && (
                <p role="alert" className="rounded border border-amber-400/40 bg-amber-900/20 p-2 text-xs text-amber-200">
                  Atenção: já existem {p.lancamentosDoExtratoNoPeriodo} lançamento(s) importados do extrato bancário nesse período. As mesmas
                  movimentações podem entrar duas vezes no DRE — confira antes de importar.
                </p>
              )}
              {p.lancamentos.periodo && <p className="text-gray-300">Período do backup: competências de {p.lancamentos.periodo.de} a {p.lancamentos.periodo.ate}.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Resumo titulo="Lançamentos novos" valor={String(p.lancamentos.novos)} detalhe={`${p.lancamentos.pagos} pago(s) · ${p.lancamentos.emAberto} em aberto (vão para A classificar)`} />
                <Resumo titulo="Já importados" valor={String(p.lancamentos.jaImportados)} detalhe="não serão duplicados" />
                <Resumo titulo="Receitas (aba Cobranças)" valor={formatCurrency(Number(p.lancamentos.receitas.total))} detalhe={`${p.lancamentos.receitas.quantidade} lançamento(s)`} />
                <Resumo titulo="Despesas" valor={formatCurrency(Number(p.lancamentos.despesas.total))} detalhe={`${p.lancamentos.despesas.quantidade} lançamento(s)`} />
                <Resumo titulo="Clientes BPO novos" valor={String(p.clientesNovos)} detalhe={`${p.clientesExistentes} já cadastrado(s) · ${p.pessoas.clientes} cliente(s) no backup`} />
                <Resumo titulo="Fornecedores" valor={String(p.pessoas.fornecedores)} detalhe="entram como nome nos lançamentos" />
              </div>
              {p.lancamentos.porCategoria.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">Categoria no BPO (a do Conta Azul fica nas observações)</p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-gray-300">
                    {p.lancamentos.porCategoria.map(c => <li key={c.categoria} className="flex justify-between gap-2"><span className="truncate">{c.categoria}</span><span>{c.quantidade}</span></li>)}
                  </ul>
                </div>
              )}
              <ul className="list-disc pl-5 space-y-1 text-xs text-gray-400">
                {p.transferencias.quantidade > 0 && <li>{p.transferencias.quantidade} transferência(s) entre contas ou empresas do grupo ({formatCurrency(Number(p.transferencias.total))}) não entram: não são receita nem despesa, como no extrato bancário.</li>}
                {p.repetidasPorCentro > 0 && <li>{p.repetidasPorCentro} linha(s) repetidas em outro centro de custo com o mesmo valor entram uma vez só, com os centros de custo juntos (sem dobrar o valor).</li>}
                {p.outrosArquivos.filter(a => a.linhas > 0).map(a => <li key={a.arquivo}>{ROTULO_ARQUIVO[a.arquivo] ?? a.arquivo}: {a.linhas} linha(s) — sem equivalente no BPO, não importado.</li>)}
                {p.arquivosAusentes.map(a => <li key={a} className="text-amber-300">{a} não está no ZIP.</li>)}
              </ul>
              {p.totalErros > 0 && (
                <div role="alert" className="rounded border border-red-400/40 bg-red-900/20 p-2 text-xs text-red-200 space-y-1">
                  <p>{p.totalErros} linha(s) com problema não serão importadas:</p>
                  <ul className="list-disc pl-5">{p.erros.map(e => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              <Button className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                disabled={!arquivos || importar.isPending || nadaNovo}
                onClick={() => arquivos && importar.mutate({ arquivos })}>
                {importar.isPending ? "Importando…" : nadaNovo ? "Nada novo para importar" : `Importar ${p.lancamentos.novos} lançamento(s) e ${p.clientesNovos} cliente(s)`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Resumo({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50]/40 p-3 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{titulo}</p>
      <p className="text-lg font-bold text-white break-words">{valor}</p>
      <p className="text-xs text-gray-400">{detalhe}</p>
    </div>
  );
}
