import { AcoesExcluir } from "@/components/AcoesExcluir";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  Landmark,
  Pencil,
  Upload,
} from "lucide-react";
import { baixarPartes, enviarPartes, LIMITE_DOCUMENTO } from "@/lib/documentos-partes";
import { trpc } from "@/lib/trpc";
import { LinkedServiceQueue } from "./LinkedServiceQueue";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";
import { formatCurrency } from "@/lib/format";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  FINANCIAMENTO_BANCO_LABELS,
  FINANCIAMENTO_BANCOS,
  FINANCIAMENTO_STATUS,
  FINANCIAMENTO_STATUS_LABELS,
  FINANCIAMENTO_TIPO_LABELS,
  FINANCIAMENTO_TIPOS,
} from "../../../../shared/financiamento";

type Status = (typeof FINANCIAMENTO_STATUS)[number];
type Tipo = (typeof FINANCIAMENTO_TIPOS)[number];
type Banco = (typeof FINANCIAMENTO_BANCOS)[number];

function moeda(valor: string | number | null | undefined) {
  return formatCurrency(Number(valor ?? 0));
}

function numero(formData: FormData, nome: string) {
  return Number(formData.get(nome) || 0);
}

type ItemLista = {
  id: number;
  leadId: number | null;
  clienteNome: string;
  imovel: string | null;
  banco: Banco | null;
  status: Status;
  valorImovel: string;
  valorFinanciado: string;
};

/**
 * Pedido 14/10/2026: etapa, valor total e valor financiado editados direto na
 * lista, sem abrir janela. A etapa é só do financiamento (não muda o lead no CRM).
 */
function CartaoFinanciamento({ financiamento, checklistTotal, checklistConcluido, onEtapa, salvandoEtapa, onDetalhes }: {
  financiamento: ItemLista;
  checklistTotal: number;
  checklistConcluido: number;
  onEtapa: (status: Status) => void;
  salvandoEtapa: boolean;
  onDetalhes: () => void;
}) {
  const utils = trpc.useUtils();
  const [valorTotal, setValorTotal] = useState(Number(financiamento.valorImovel ?? 0));
  const [valorFinanciado, setValorFinanciado] = useState(Number(financiamento.valorFinanciado ?? 0));
  useEffect(() => {
    setValorTotal(Number(financiamento.valorImovel ?? 0));
    setValorFinanciado(Number(financiamento.valorFinanciado ?? 0));
  }, [financiamento.valorImovel, financiamento.valorFinanciado]);
  const alterado = valorTotal !== Number(financiamento.valorImovel ?? 0) || valorFinanciado !== Number(financiamento.valorFinanciado ?? 0);
  const invalido = valorFinanciado > valorTotal;
  const salvarValores = trpc.financiamentos.atualizarValores.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.financiamentos.list.invalidate(), utils.financiamentos.getById.invalidate()]);
      toast.success("Valores salvos");
    },
    onError: erro => toast.error(erro.message),
  });
  return (
    <div className="rounded-lg bg-[#1A2332] p-4 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <p className="font-semibold text-white">{financiamento.clienteNome}</p>
          <p className="text-xs text-gray-300">
            {financiamento.imovel || "Imóvel a definir"} •{" "}
            {financiamento.banco ? FINANCIAMENTO_BANCO_LABELS[financiamento.banco] : "Banco a definir"}
          </p>
          <p className="mt-1 text-xs text-gray-300">Checklist {checklistConcluido}/{checklistTotal}</p>
        </div>
        <div className="w-full sm:w-56">
          <Label className="text-xs text-gray-300">Etapa do financiamento</Label>
          <Select value={financiamento.status} onValueChange={valor => onEtapa(valor as Status)} disabled={salvandoEtapa}>
            <SelectTrigger className="mt-1 border-[#C9A961]/40 bg-[#2C3E50] text-white" aria-label={`Etapa de ${financiamento.clienteNome}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FINANCIAMENTO_STATUS.map(status => (
                <SelectItem key={status} value={status}>{FINANCIAMENTO_STATUS_LABELS[status]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="min-w-0">
          <Label className="text-xs text-gray-300">VGV simulado</Label>
          <CurrencyInput value={valorTotal} onChange={setValorTotal} aria-label={`VGV simulado de ${financiamento.clienteNome}`} className="mt-1 border-[#C9A961]/40 bg-[#2C3E50] text-white" />
        </div>
        <div className="min-w-0">
          <Label className="text-xs text-gray-300">Valor financiado aprovado</Label>
          <CurrencyInput value={valorFinanciado} onChange={setValorFinanciado} aria-label={`Valor financiado aprovado de ${financiamento.clienteNome}`} className="mt-1 border-[#C9A961]/40 bg-[#2C3E50] text-white" />
        </div>
        <Button
          type="button"
          className="bg-[#C9A961] text-[#1A2332] hover:bg-[#E6CA88]"
          disabled={!alterado || invalido || salvarValores.isPending}
          onClick={() => salvarValores.mutate({ id: financiamento.id, valorImovel: valorTotal, valorFinanciado })}
        >
          Salvar valores
        </Button>
      </div>
      {invalido && <p className="mt-2 text-xs text-red-300">O valor financiado não pode superar o valor total.</p>}
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={onDetalhes} className="text-[#E6CA88] underline">Checklist e demais dados</button>
        {financiamento.leadId && <Link href={`/admin/crm/${financiamento.leadId}`} className="text-[#E6CA88] underline">Abrir cadastro CRM</Link>}
      </div>
    </div>
  );
}

export default function AdminFinanciamentos() {
  const [editarAberto, setEditarAberto] = useState(false);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Status | "todos">("todos");
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadItemId, setUploadItemId] = useState<number | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const utils = trpc.useUtils();
  const { data: processos = [], isLoading } = trpc.financiamentos.list.useQuery(
    filtro === "todos" ? {} : { status: filtro }
  );
  const { data: detalhe } = trpc.financiamentos.getById.useQuery(
    { id: selecionado ?? 0 },
    { enabled: selecionado !== null }
  );
  const { data: options } = trpc.financiamentos.options.useQuery();

  const uploadDocument = trpc.financiamentos.uploadChecklistDocument.useMutation();
  const resendDocument = trpc.financiamentos.requestChecklistDocument.useMutation({ onSuccess: result => { if (result.emailWarning) toast.warning(result.emailWarning); else toast.success("Cliente avisado no portal e por email"); }, onError: error => toast.error(error.message) });
  async function enviarDocumento(file?: File) {
    if (!file || !uploadItemId || !selecionado) return;
    const mimeType = file.type || (/\.xls$/i.test(file.name) ? "application/vnd.ms-excel" : "");
    if (!["application/pdf", "image/jpeg", "image/png", "application/vnd.ms-excel"].includes(mimeType) || file.size > LIMITE_DOCUMENTO) { toast.error("Envie PDF, JPG, PNG ou XLS de até 20 MiB"); return; }
    setUploadBusy(true);
    try {
      const uploadId = await enviarPartes(file, `finance:${selecionado}:${uploadItemId}`);
      await uploadDocument.mutateAsync({ financiamentoId: selecionado, itemId: uploadItemId, fileName: file.name, mimeType: mimeType as "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.ms-excel", uploadId });
      toast.success("Documento salvo no Google Drive");
      await utils.financiamentos.getById.invalidate();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha no envio"); }
    finally { setUploadBusy(false); if (uploadRef.current) uploadRef.current.value = ""; }
  }

  async function abrirDocumento(id: number, nome: string) {
    try {
      await baixarPartes(offset => utils.financiamentos.checklistDocumentContent.fetch({ id, offset }), nome || "documento");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao consultar documento"); }
  }

  const atualizarStatus = trpc.financiamentos.updateStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.financiamentos.list.invalidate(),
        utils.financiamentos.getById.invalidate(),
      ]);
      toast.success("Etapa atualizada");
    },
    onError: erro => toast.error(erro.message),
  });
  const atualizarChecklist = trpc.financiamentos.updateChecklist.useMutation({
    onSuccess: async result => {
      if (result.emailWarning) toast.warning(result.emailWarning);
      await Promise.all([
        utils.financiamentos.list.invalidate(),
        utils.financiamentos.getById.invalidate(),
      ]);
    },
    onError: erro => toast.error(erro.message),
  });
  const excluir = trpc.financiamentos.delete.useMutation({
    onSuccess: async () => {
      await utils.financiamentos.list.invalidate();
      setSelecionado(null);
    },
  });
  const atualizar = trpc.financiamentos.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.financiamentos.list.invalidate(),
        utils.financiamentos.getById.invalidate(),
      ]);
      setEditarAberto(false);
      toast.success("Financiamento atualizado");
    },
    onError: erro => toast.error(erro.message),
  });

  function dadosFormulario(form: HTMLFormElement) {
    const dados = new FormData(form);
    const optionalId = (nome: string) => {
      const valor = String(dados.get(nome) || "");
      return valor && valor !== "none" ? Number(valor) : null;
    };
    return {
      clienteNome: String(dados.get("clienteNome") || ""),
      clienteCpf: String(dados.get("clienteCpf") || "") || null,
      clienteTel: String(dados.get("clienteTel") || ""),
      clienteEmail: String(dados.get("clienteEmail") || "") || null,
      tipo: String(dados.get("tipo")) as Tipo,
      banco: String(dados.get("banco")) as Banco,
      bancoOutro: String(dados.get("bancoOutro") || "") || null,
      valorImovel: numero(dados, "valorImovel"),
      valorFinanciado: numero(dados, "valorFinanciado"),
      observacoes: String(dados.get("observacoes") || "") || null,
      leadId: optionalId("leadId"),
      imovelVinculadoId: optionalId("imovelVinculadoId"),
      corretorId: optionalId("corretorId"),
    };
  }

  function dadosEdicao(form: HTMLFormElement, leadIdVinculado: number | null) {
    const dados = dadosFormulario(form);
    if (!leadIdVinculado) return dados;
    // Cliente vinculado: dados pessoais seguem o CRM e o vínculo não muda aqui.
    const {
      clienteNome: _nome,
      clienteCpf: _cpf,
      clienteTel: _tel,
      clienteEmail: _email,
      ...resto
    } = dados;
    return { ...resto, leadId: leadIdVinculado };
  }

  const total = processos.reduce(
    (soma, item) => soma + Number(item.financiamento.valorFinanciado),
    0
  );
  const ativos = processos.filter(
    ({ financiamento }) =>
      !["liberado", "cancelado"].includes(financiamento.status)
  ).length;
  const concluidos = processos.filter(
    ({ financiamento }) => financiamento.status === "liberado"
  ).length;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400">
                <ArrowLeft />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">
                Financiamentos
              </h1>
              <p className="text-sm text-gray-400">
                Crédito imobiliário e checklist documental
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6">
        <LinkedServiceQueue
          module="financiamentos"
          title="Financiamentos"
          onRecordsCreated={() => void utils.financiamentos.list.invalidate()}
        />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              titulo: "Em andamento",
              valor: String(ativos),
              icone: FileCheck2,
              cor: "text-blue-400",
            },
            {
              titulo: "Crédito concluído",
              valor: String(concluidos),
              icone: CheckCircle2,
              cor: "text-green-400",
            },
            {
              titulo: "Volume financiado",
              valor: moeda(total),
              icone: Landmark,
              cor: "text-[#C9A961]",
            },
          ].map(({ titulo, valor, icone: Icone, cor }) => (
            <Card key={titulo} className="border-[#C9A961]/20 bg-[#2C3E50]">
              <CardContent className="flex items-center gap-3 pt-6">
                <Icone className={`h-8 w-8 ${cor}`} />
                <div>
                  <p className="text-sm text-gray-300">{titulo}</p>
                  <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filtro === "todos" ? "default" : "outline"}
            onClick={() => setFiltro("todos")}
          >
            Todos
          </Button>
          {FINANCIAMENTO_STATUS.map(status => (
            <Button
              key={status}
              size="sm"
              variant={filtro === status ? "default" : "outline"}
              onClick={() => setFiltro(status)}
            >
              {FINANCIAMENTO_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>

        <Card className="border-[#C9A961]/20 bg-[#2C3E50]">
          <CardContent className="pt-6">
            {isLoading ? (
              <p className="py-10 text-center text-gray-300">Carregando…</p>
            ) : processos.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Building2 className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>Nenhum financiamento encontrado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {processos.map(
                  ({ financiamento, checklistTotal, checklistConcluido }) => (
                    <CartaoFinanciamento
                      key={financiamento.id}
                      financiamento={financiamento}
                      checklistTotal={checklistTotal}
                      checklistConcluido={checklistConcluido}
                      onEtapa={status => atualizarStatus.mutate({ id: financiamento.id, status })}
                      salvandoEtapa={atualizarStatus.isPending}
                      onDetalhes={() => setSelecionado(financiamento.id)}
                    />
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog
        open={selecionado !== null}
        onOpenChange={aberto => !aberto && setSelecionado(null)}
      >
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">
          {detalhe && (
            <>
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">
                  {detalhe.financiamento.clienteNome}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 rounded-lg bg-[#2C3E50] p-4 text-sm md:grid-cols-3">
                <div>
                  <p className="text-gray-300">Imóvel</p>
                  <p>{detalhe.financiamento.imovel || "A definir"}</p>
                </div>
                <div>
                  <p className="text-gray-300">Financiado</p>
                  <p>{moeda(detalhe.financiamento.valorFinanciado)}</p>
                </div>
                <div>
                  <p className="text-gray-300">Banco</p>
                  <p>
                    {detalhe.financiamento.banco
                      ? FINANCIAMENTO_BANCO_LABELS[detalhe.financiamento.banco]
                      : "A definir"}
                  </p>
                </div>
              </div>
              <div>
                <Label>Etapa atual</Label>
                <Select
                  value={detalhe.financiamento.status}
                  onValueChange={(status: Status) =>
                    atualizarStatus.mutate({
                      id: detalhe.financiamento.id,
                      status,
                    })
                  }
                >
                  <SelectTrigger className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FINANCIAMENTO_STATUS.map(status => (
                      <SelectItem key={status} value={status}>
                        {FINANCIAMENTO_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-[#C9A961]">
                  Checklist documental e portal do cliente
                </h3>
                <p className="text-xs text-gray-300">Todos os documentos são opcionais.</p>
                <input ref={uploadRef} type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,.xls,application/vnd.ms-excel" onChange={event => void enviarDocumento(event.target.files?.[0])} aria-label="Selecionar documento do financiamento" />
                {detalhe.checklist.map(item => (
                  <div key={item.id} className="rounded-lg bg-[#2C3E50] p-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={item.concluido}
                        onChange={evento =>
                          atualizarChecklist.mutate({
                            id: item.id,
                            financiamentoId: detalhe.financiamento.id,
                            concluido: evento.target.checked,
                            notas: item.notas ?? undefined,
                            visivelCliente: item.visivelCliente,
                            solicitarDocumento: item.solicitarDocumento,
                          })
                        }
                        className="mt-1 accent-[#C9A961]"
                      />
                      <span>
                        <strong>{item.item}</strong>
                        <span className="block text-xs text-gray-300">
                          {item.grupo}
                        </span>
                      </span>
                    </label>
                    <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-white/10 pt-3 text-sm">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.visivelCliente}
                          onChange={evento =>
                            atualizarChecklist.mutate({
                              id: item.id,
                              financiamentoId: detalhe.financiamento.id,
                              concluido: item.concluido,
                              notas: item.notas ?? undefined,
                              visivelCliente: evento.target.checked,
                              solicitarDocumento: item.solicitarDocumento,
                            })
                          }
                          className="accent-[#C9A961]"
                        />
                        <Eye className="h-4 w-4" /> Visível ao cliente
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.solicitarDocumento}
                          disabled={!item.visivelCliente}
                          onChange={evento =>
                            atualizarChecklist.mutate({
                              id: item.id,
                              financiamentoId: detalhe.financiamento.id,
                              concluido: item.concluido,
                              notas: item.notas ?? undefined,
                              visivelCliente: item.visivelCliente,
                              solicitarDocumento: evento.target.checked,
                            })
                          }
                          className="accent-[#C9A961]"
                        />
                        <Upload className="h-4 w-4" /> Solicitar documento
                      </label>
                      <Button size="sm" type="button" variant="outline" disabled={uploadBusy} onClick={() => { setUploadItemId(item.id); uploadRef.current?.click(); }}>Enviar</Button>
                      {item.solicitarDocumento && item.visivelCliente && <Button size="sm" type="button" variant="outline" disabled={resendDocument.isPending} onClick={() => resendDocument.mutate({ financiamentoId: detalhe.financiamento.id, itemId: item.id })}>Reenviar aviso</Button>}
                      {item.documentoNome && (item.documentoDriveFileId || !item.documentoUrl) && (
                        <button
                          type="button"
                          onClick={() => void abrirDocumento(item.id, item.documentoNome || "documento")}
                          className="ml-auto inline-flex items-center gap-1 text-[#C9A961] underline"
                        >
                          <Download className="h-4 w-4" />
                          {item.documentoNome || "Documento enviado"}
                        </button>
                      )}
                      {item.documentoUrl && !item.documentoDriveFileId && (
                        <a
                          href={item.documentoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto inline-flex items-center gap-1 text-[#C9A961] underline"
                        >
                          <Download className="h-4 w-4" />
                          {item.documentoNome || "Documento enviado"}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {detalhe.legacyChecklist.some(item => item.documentoNome) && <details className="rounded border border-white/20 p-3"><summary>Documentos anteriores</summary>{detalhe.legacyChecklist.filter(item => item.documentoNome).map(item => <button type="button" className="block py-2 text-[#E6CA88] underline" key={item.id} onClick={() => void abrirDocumento(item.id, item.documentoNome || "documento")}>{item.item} — {item.documentoNome}</button>)}</details>}
              <div className="flex gap-2">
                <Button
                  onClick={() => setEditarAberto(true)}
                  className="flex-1 bg-[#C9A961] text-[#1A2332]"
                >
                  <Pencil className="mr-2 h-4 w-4" /> Editar dados e vínculos
                </Button>
                <AcoesExcluir
                  compacto
                  rotulo={detalhe.financiamento.clienteNome ?? "financiamento"}
                  onExcluir={async () => { await excluir.mutateAsync({ id: detalhe.financiamento.id }); }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editarAberto} onOpenChange={setEditarAberto}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">
          <DialogHeader>
            <DialogTitle className="text-[#C9A961]">
              Editar financiamento
            </DialogTitle>
          </DialogHeader>
          {detalhe && (
            <form
              onSubmit={event => {
                event.preventDefault();
                atualizar.mutate({
                  id: detalhe.financiamento.id,
                  data: dadosEdicao(
                    event.currentTarget,
                    detalhe.financiamento.leadId
                  ),
                });
              }}
              className="grid gap-4 md:grid-cols-2"
            >
              <Campo
                nome="clienteNome"
                desabilitado={Boolean(detalhe.financiamento.leadId)}
                rotulo="Cliente"
                obrigatorio
                valorPadrao={detalhe.financiamento.clienteNome}
              />
              <Campo
                nome="clienteTel"
                desabilitado={Boolean(detalhe.financiamento.leadId)}
                rotulo="Telefone"
                obrigatorio
                valorPadrao={detalhe.financiamento.clienteTel}
              />
              <Campo
                nome="clienteEmail"
                desabilitado={Boolean(detalhe.financiamento.leadId)}
                rotulo="E-mail"
                tipo="email"
                valorPadrao={detalhe.financiamento.clienteEmail || ""}
              />
              <Campo
                nome="clienteCpf"
                desabilitado={Boolean(detalhe.financiamento.leadId)}
                rotulo="CPF"
                valorPadrao={detalhe.financiamento.clienteCpf || ""}
              />
              <Selecao
                nome="tipo"
                rotulo="Tipo"
                valorPadrao={detalhe.financiamento.tipo ?? undefined}
                opcoes={FINANCIAMENTO_TIPOS.map(v => [
                  v,
                  FINANCIAMENTO_TIPO_LABELS[v],
                ])}
              />
              <Selecao
                nome="banco"
                rotulo="Banco"
                valorPadrao={detalhe.financiamento.banco ?? undefined}
                opcoes={FINANCIAMENTO_BANCOS.map(v => [
                  v,
                  FINANCIAMENTO_BANCO_LABELS[v],
                ])}
              />
              <Campo
                nome="bancoOutro"
                rotulo="Outro banco"
                valorPadrao={detalhe.financiamento.bancoOutro || ""}
              />
              <Vinculos
                options={options}
                initial={detalhe.financiamento}
                semLead={Boolean(detalhe.financiamento.leadId)}
              />
              {detalhe.financiamento.leadId && (
                <p className="md:col-span-2 text-xs text-gray-300">
                  Cliente vinculado ao{" "}
                  <Link
                    href={`/admin/crm/${detalhe.financiamento.leadId}`}
                    className="underline"
                  >
                    lead do CRM
                  </Link>
                  : nome, CPF, telefone e e-mail são atualizados a partir do cadastro do lead.
                </p>
              )}
              <CampoMoeda
                nome="valorImovel"
                rotulo="VGV simulado"
                obrigatorio
                valorPadrao={Number(detalhe.financiamento.valorImovel)}
              />
              <CampoMoeda
                nome="valorFinanciado"
                rotulo="Valor financiado aprovado"
                obrigatorio
                valorPadrao={Number(detalhe.financiamento.valorFinanciado)}
              />
              <div className="md:col-span-2">
                <Label>Observações</Label>
                <Textarea
                  name="observacoes"
                  defaultValue={detalhe.financiamento.observacoes || ""}
                />
              </div>
              <Button
                type="submit"
                className="md:col-span-2 bg-[#C9A961] text-[#1A2332]"
              >
                Salvar alterações
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Campo({
  nome,
  rotulo,
  tipo = "text",
  obrigatorio = false,
  passo,
  valorPadrao,
  desabilitado = false,
}: {
  nome: string;
  rotulo: string;
  tipo?: string;
  obrigatorio?: boolean;
  passo?: string;
  valorPadrao?: string;
  desabilitado?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={nome}>
        {rotulo}
        {obrigatorio ? " *" : ""}
      </Label>
      <Input
        id={nome}
        name={nome}
        type={tipo}
        required={obrigatorio && !desabilitado}
        disabled={desabilitado}
        step={passo ?? (tipo === "number" ? "0.01" : undefined)}
        min={tipo === "number" ? 0 : undefined}
        defaultValue={valorPadrao}
        className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]"
      />
    </div>
  );
}

// Variante de `Campo` para dinheiro/percentual: mesmo visual (Label +
// moldura), mas usando `CurrencyInput`/`PercentInput` (buffer de texto +
// `parseNumeroBR`) em vez de `<Input type="number">` — que mastiga a
// vírgula decimal durante a digitação. `name`+`defaultValue` seguem
// alimentando o `FormData` do submit via `<input type="hidden">` interno,
// então `dadosFormulario()`/`numero()` continuam funcionando sem mudança.
function CampoMoeda({
  nome,
  rotulo,
  obrigatorio = false,
  valorPadrao,
}: {
  nome: string;
  rotulo: string;
  obrigatorio?: boolean;
  valorPadrao?: number | null;
}) {
  return (
    <div>
      <Label htmlFor={nome}>
        {rotulo}
        {obrigatorio ? " *" : ""}
      </Label>
      <CurrencyInput
        id={nome}
        name={nome}
        defaultValue={valorPadrao}
        required={obrigatorio}
        className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]"
      />
    </div>
  );
}

function CampoPercentual({
  nome,
  rotulo,
  obrigatorio = false,
  valorPadrao,
}: {
  nome: string;
  rotulo: string;
  obrigatorio?: boolean;
  valorPadrao?: number | null;
}) {
  return (
    <div>
      <Label htmlFor={nome}>
        {rotulo}
        {obrigatorio ? " *" : ""}
      </Label>
      <PercentInput
        id={nome}
        name={nome}
        defaultValue={valorPadrao}
        required={obrigatorio}
        maximumFractionDigits={4}
        className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]"
      />
    </div>
  );
}

function Selecao({
  nome,
  rotulo,
  opcoes,
  valorPadrao,
}: {
  nome: string;
  rotulo: string;
  opcoes: readonly (readonly [string, string])[];
  valorPadrao?: string;
}) {
  return (
    <div>
      <Label>{rotulo}</Label>
      <Select name={nome} defaultValue={valorPadrao || opcoes[0][0]}>
        <SelectTrigger className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map(([valor, texto]) => (
            <SelectItem key={valor} value={valor}>
              {texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Vinculos({
  options,
  initial,
  semLead = false,
}: {
  semLead?: boolean;
  options?: {
    leads: { id: number; name: string }[];
    properties: { id: number; title: string }[];
    brokers: { id: number; name: string | null; email: string | null }[];
  };
  initial?: {
    leadId: number | null;
    imovelVinculadoId: number | null;
    corretorId: number | null;
  };
}) {
  return (
    <>
      {!semLead && <div>
        <Label>Lead vinculado</Label>
        <Select
          name="leadId"
          defaultValue={initial?.leadId ? String(initial.leadId) : "none"}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem vínculo</SelectItem>
            {options?.leads.map(item => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>}
      <div>
        <Label>Imóvel vinculado</Label>
        <Select
          name="imovelVinculadoId"
          defaultValue={
            initial?.imovelVinculadoId
              ? String(initial.imovelVinculadoId)
              : "none"
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem vínculo</SelectItem>
            {options?.properties.map(item => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label>Corretor responsável</Label>
        <Select
          name="corretorId"
          defaultValue={
            initial?.corretorId ? String(initial.corretorId) : "none"
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem responsável</SelectItem>
            {options?.brokers.map(item => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.name || item.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
