import { useEffect, useMemo, useRef, useState } from "react";
import { formatarPercentual, progressoDaObra } from "@shared/financeiro/progresso";
import { Link, useLocation } from "wouter";
import { FINANCIAMENTO_STATUS } from "@shared/financiamento";
import { obraStatusLabel } from "@shared/obra-status";
import { rotulo } from "@shared/rotulos";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Download,
  FileCheck2,
  FileText,
  Home,
  MessageSquare,
  Send,
  ShoppingBag,
  Ticket,
  Upload,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { LeadDocuments } from "@/components/LeadDocuments";
import { PortalHeader } from "@/components/PortalHeader";
import { mutarComProgresso } from "@/lib/envio-progresso";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const baseNav = [
  ["/portal", "Início", Home],
  ["/portal/documentos", "Documentos", FileText],
  ["/portal/visitas", "Visitas", CalendarDays],
  ["/portal/acompanhamento", "Acompanhamento", CheckCircle2],
  ["/portal/chat", "Chat", MessageSquare],
] as const;

const ecosystemNav = [
  ["/portal/bilhetes", "Meus bilhetes", Ticket],
  ["/portal/saldo", "Meu saldo", Coins],
  ["/portal/conversoes", "Minhas conversões", ShoppingBag],
] as const;

const date = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const money = (value: string | number | null | undefined) =>
  Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

function routeId(path: string, prefix: string): number | undefined {
  const raw = path.startsWith(prefix)
    ? path.slice(prefix.length).split("/")[0]
    : "";
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function openDocument(base64: string, mimeType: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName || "documento";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function Portal() {
  const [path] = useLocation();
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const navigation = trpc.portal.navigation.useQuery();
  const workId = routeId(path, "/portal/obras/");
  const financingId = routeId(path, "/portal/financiamento/");

  const dashboard = trpc.portal.dashboard.useQuery(undefined, {
    enabled: path === "/portal",
  });
  const activities = trpc.portal.activities.useQuery(undefined, {
    enabled: path === "/portal/acompanhamento",
  });
  const visits = trpc.portal.visits.useQuery(undefined, {
    enabled: path === "/portal/visitas",
  });
  const contracts = trpc.portal.contracts.useQuery(undefined, {
    enabled: path === "/portal/documentos",
  });
  const messages = trpc.portal.messages.useQuery(undefined, {
    enabled: path === "/portal/chat",
    refetchInterval: 4000,
  });
  const works = trpc.portal.works.useQuery(undefined, {
    enabled: path === "/portal/obras",
  });
  const work = trpc.portal.work.useQuery(
    { projectId: workId ?? 0 },
    { enabled: Boolean(workId) }
  );
  const financings = trpc.portal.financings.useQuery(undefined, {
    enabled: path === "/portal/financiamento",
  });
  const financing = trpc.portal.financing.useQuery(
    { financingId: financingId ?? 0 },
    { enabled: Boolean(financingId) }
  );
  const tickets = trpc.tickets.myTickets.useQuery(undefined, {
    enabled: path === "/portal/bilhetes",
  });
  const balance = trpc.utef.balance.useQuery(undefined, {
    enabled: path === "/portal/saldo",
  });
  const transactions = trpc.utef.transactions.useQuery(undefined, {
    enabled: path === "/portal/saldo",
  });
  const conversions = trpc.products.myConversions.useQuery(undefined, {
    enabled: path === "/portal/conversoes",
  });

  const [text, setText] = useState("");
  const contractFileRef = useRef<HTMLInputElement>(null);
  const financingFileRef = useRef<HTMLInputElement>(null);
  const [uploadContractId, setUploadContractId] = useState<number | null>(null);
  const [uploadChecklistId, setUploadChecklistId] = useState<number | null>(
    null
  );
  const send = trpc.portal.sendMessage.useMutation({
    onSuccess: () => {
      setText("");
      messages.refetch();
    },
  });
  const [enviando, setEnviando] = useState(false);
  const nav = useMemo(() => {
    const items: Array<readonly [string, string, typeof Home]> = [...baseNav];
    if (navigation.data?.hasWorks)
      items.splice(1, 0, ["/portal/obras", "Minha obra", Building2]);
    if (navigation.data?.hasActiveFinancing)
      items.splice(navigation.data.hasWorks ? 2 : 1, 0, [
        "/portal/financiamento",
        "Financiamento",
        CircleDollarSign,
      ]);
    if (navigation.data?.hasProspectaEcosystem) items.push(...ecosystemNav);
    return items;
  }, [navigation.data]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  async function onContractFile(file?: File) {
    if (contractFileRef.current) contractFileRef.current.value = "";
    if (!file || !uploadContractId) return;
    if (file.type !== "application/pdf" || file.size > 10 * 1024 * 1024) {
      toast.error("Envie um PDF de até 10 MiB");
      return;
    }
    setEnviando(true);
    try {
      await mutarComProgresso("portal.uploadSignedContract", {
        contractId: uploadContractId,
        fileName: file.name,
        mimeType: "application/pdf",
        base64: await toBase64(file),
      }, { item: "contrato" });
      toast.success("Contrato assinado enviado");
      await contracts.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar o contrato");
    } finally {
      setEnviando(false);
    }
  }

  async function onFinancingFile(file?: File) {
    if (financingFileRef.current) financingFileRef.current.value = "";
    if (!file || !uploadChecklistId || !financingId) return;
    if (
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast.error("Envie PDF, JPG ou PNG de até 10 MiB");
      return;
    }
    setEnviando(true);
    try {
      await mutarComProgresso("portal.uploadFinancingDocument", {
        financingId,
        checklistItemId: uploadChecklistId,
        fileName: file.name,
        mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png",
        base64: await toBase64(file),
      }, { item: "documento" });
      toast.success("Documento enviado para análise");
      await financing.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar o documento");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-[#1A2332]">
      <PortalHeader
        subtitle="Portal do Cliente"
        fallback="/portal"
        onLogout={() => logout().then(() => window.location.assign("/login"))}
      />
      <nav className="bg-white border-b overflow-x-auto">
        <div className="max-w-6xl mx-auto px-4 flex min-w-max">
          {nav.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 ${path === href || (href !== "/portal" && path.startsWith(`${href}/`)) ? "border-[#C9A961] text-[#1A2332]" : "border-transparent text-slate-500"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-4 md:p-8">
        {path === "/portal" && (
          <div className="space-y-5">
            <Card className="bg-[#1A2332] text-white border-0">
              <CardContent className="p-6">
                <p className="text-sm text-slate-400">Bem-vindo de volta</p>
                <h1 className="text-2xl font-bold text-[#C9A961]">
                  {dashboard.data?.lead.name ?? user?.name}
                </h1>
                {dashboard.data?.lead.stage && (
                  <Badge className="mt-3 bg-[#C9A961] text-[#1A2332]">
                    {rotulo(dashboard.data.lead.stage)}
                  </Badge>
                )}
              </CardContent>
            </Card>
            {dashboard.data?.project && (
              <Card>
                <CardHeader>
                  <CardTitle>{dashboard.data.project.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Andamento da obra</span>
                    <b>{formatarPercentual(progressoDaObra(dashboard.data.project.progressMeasuredPct, dashboard.data.project.progress))}</b>
                  </div>
                  <Progress value={progressoDaObra(dashboard.data.project.progressMeasuredPct, dashboard.data.project.progress)} />
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Última atualização</CardTitle>
              </CardHeader>
              <CardContent>
                {dashboard.data?.lastActivity ? (
                  <>
                    <p>{dashboard.data.lastActivity.description}</p>
                    <p className="text-sm text-slate-500 mt-2">
                      {date(dashboard.data.lastActivity.createdAt)}
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500">
                    As atualizações do seu processo aparecerão aqui.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {path === "/portal/obras" && (
          <Section title="Minhas obras">
            <div className="grid md:grid-cols-2 gap-4">
              {works.data?.map(project => (
                <Link key={project.id} href={`/portal/obras/${project.id}`}>
                  <Card className="h-full hover:border-[#C9A961] transition-colors cursor-pointer">
                    <CardHeader>
                      <CardTitle>{project.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Badge>{obraStatusLabel(project.status)}</Badge>
                      <p className="text-sm text-slate-500">
                        {[project.address, project.city, project.state]
                          .filter(Boolean)
                          .join(" — ")}
                      </p>
                      <Progress value={progressoDaObra(project.progressMeasuredPct, project.progress)} />
                      <p className="text-sm font-semibold">
                        {formatarPercentual(progressoDaObra(project.progressMeasuredPct, project.progress))} concluído
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {works.data?.length === 0 && (
                <Empty text="Nenhuma obra vinculada ao seu cadastro." />
              )}
            </div>
          </Section>
        )}
        {workId && (
          <Section title={work.data?.project.title ?? "Detalhes da obra"}>
            <div className="space-y-5">
              {work.isLoading && <p className="text-slate-500">Carregando obra...</p>}
              {work.error && <Empty text="Não foi possível abrir esta obra. Volte e tente novamente." />}
              {work.data && (
                <>
                  <Card>
                    <CardContent className="p-5 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge>{obraStatusLabel(work.data.project.status)}</Badge>
                        <Badge variant="outline">Somente acompanhamento</Badge>
                      </div>
                      <Progress value={progressoDaObra(work.data.project.progressMeasuredPct, work.data.project.progress)} />
                      <p className="font-semibold">
                        {formatarPercentual(progressoDaObra(work.data.project.progressMeasuredPct, work.data.project.progress))} concluído
                      </p>
                      <p className="text-sm text-slate-500">
                        Previsão: {date(work.data.project.estimatedEndDate)}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Pedido de 18/10: as mesmas etapas por incidência da tela da equipe, só leitura. */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Etapas da obra</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {work.data.etapas.length === 0 && (
                        <p className="text-sm text-slate-500">As etapas aparecerão aqui assim que a equipe registrar a primeira medição.</p>
                      )}
                      {work.data.etapas.map(etapa => (
                        <div key={etapa.chave} className="space-y-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ETAPA_COR[etapa.situacao]}`} aria-hidden />
                              <b className="break-words">{etapa.nome}</b>
                            </div>
                            <span className="shrink-0 text-sm font-semibold">{formatarPercentual(etapa.execucao)}</span>
                          </div>
                          <Progress value={etapa.execucao} />
                          <p className="text-xs text-slate-500">
                            {ETAPA_SITUACAO[etapa.situacao]} · Incidência {formatarPercentual(etapa.incidencia)} · Representa {formatarPercentual(etapa.execucaoObra)} da obra
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Medições salvas</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {work.data.medicoes.length === 0 ? (
                        <p className="text-sm text-slate-500">Nenhuma medição registrada ainda.</p>
                      ) : (
                        <ul className="divide-y">
                          {work.data.medicoes.map(medicao => (
                            <li key={medicao.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                              <span>{date(medicao.criadoEm)}</span>
                              <b>{formatarPercentual(Number(medicao.progresso))}</b>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  {work.data.photos.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Fotos da obra</CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        {work.data.photos.map(photo => (
                          <a key={photo.id} href={photo.imageUrl} target="_blank" rel="noreferrer">
                            <img
                              src={photo.imageUrl}
                              alt={photo.caption ?? "Foto da obra"}
                              className="rounded h-28 w-full object-cover"
                            />
                          </a>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </Section>
        )}

        {path === "/portal/financiamento" && (
          <Section title="Financiamentos ativos">
            <div className="grid md:grid-cols-2 gap-4">
              {financings.data?.map(item => (
                <Link key={item.id} href={`/portal/financiamento/${item.id}`}>
                  <Card className="h-full hover:border-[#C9A961] transition-colors cursor-pointer">
                    <CardHeader>
                      <CardTitle>
                        {item.imovel || "Financiamento imobiliário"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Badge>{rotulo(item.status)}</Badge>
                      <p>
                        {item.bancoOutro || (item.banco ? rotulo(item.banco) : "Banco em definição")}
                      </p>
                      <p className="text-sm text-slate-500">
                        Valor financiado: {money(item.valorFinanciado)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {financings.data?.length === 0 && (
                <Empty text="Nenhum financiamento ativo vinculado ao seu cadastro." />
              )}
            </div>
          </Section>
        )}
        {financingId && (
          <Section
            title={
              financing.data?.financing.imovel ||
              "Acompanhamento do financiamento"
            }
          >
            <div className="space-y-5">
              {financing.data && (
                <>
                  <FinanciamentoEtapas status={financing.data.financing.status} />
                  <Card>
                    <CardContent className="p-5 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                      <Info label="Etapa atual" value={rotulo(financing.data.financing.status)} />
                      <Info
                        label="Banco"
                        value={
                          financing.data.financing.bancoOutro ||
                          (financing.data.financing.banco ? rotulo(financing.data.financing.banco) : "Em definição")
                        }
                      />
                      <Info
                        label="Modalidade"
                        value={financing.data.financing.tipo ? rotulo(financing.data.financing.tipo) : "Em definição"}
                      />
                      <Info label="Valor do imóvel" value={money(financing.data.financing.valorImovel)} />
                      <Info label="Valor financiado" value={money(financing.data.financing.valorFinanciado)} />
                    </CardContent>
                  </Card>
                  <h2 className="text-lg font-bold">Documentos</h2>
                  {financing.data.checklist.length === 0 && (
                    <Empty text="A equipe ainda não liberou documentos para você enviar." />
                  )}
                  <div className="space-y-3">
                    {financing.data.checklist.map(item => (
                      <Card key={item.id}>
                        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <FileCheck2
                                className={`h-5 w-5 ${item.concluido ? "text-emerald-600" : "text-slate-400"}`}
                              />
                              <b>{item.item}</b>
                              <Badge
                                variant={item.concluido ? "default" : "outline"}
                              >
                                {item.concluido ? "Aprovado" : item.documentoNome ? "Enviado — em análise" : "Pendente"}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                              {item.grupo}
                            </p>
                            {item.documentoNome && (item.documentoDriveFileId || !item.documentoUrl) && (
                              <button
                                type="button"
                                className="text-sm underline mt-2 inline-flex items-center gap-1"
                                onClick={() => {
                                  void utils.portal.checklistDocumentContent.fetch({ checklistItemId: item.id }).then(content =>
                                    openDocument(content.base64, item.documentoMime || "application/octet-stream", content.fileName)
                                  ).catch(() => toast.error("Falha ao consultar documento"));
                                }}
                              >
                                <Download className="h-4 w-4" />
                                {item.documentoNome}
                              </button>
                            )}
                            {item.documentoNome && item.documentoUrl && !item.documentoDriveFileId && (
                              <a
                                className="text-sm underline mt-2 inline-flex items-center gap-1"
                                href={item.documentoUrl ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Download className="h-4 w-4" />
                                {item.documentoNome}
                              </a>
                            )}
                          </div>
                          {item.solicitarDocumento && (
                            <Button
                              onClick={() => {
                                setUploadChecklistId(item.id);
                                financingFileRef.current?.click();
                              }}
                              disabled={enviando}
                            >
                              <Upload className="h-4 w-4 mr-2" />
                              {item.documentoNome
                                ? "Substituir documento"
                                : "Enviar documento"}
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <input
                    ref={financingFileRef}
                    hidden
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    capture="environment"
                    onChange={event => onFinancingFile(event.target.files?.[0])}
                  />
                </>
              )}
            </div>
          </Section>
        )}

        {path === "/portal/acompanhamento" && (
          <Section title="Acompanhamento">
            <div className="space-y-3">
              {activities.data?.map(item => (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between gap-3">
                      <p>{item.description}</p>
                      <Badge variant="outline">{rotulo(item.type)}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {date(item.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              ))}
              {activities.data?.length === 0 && (
                <Empty text="Nenhuma atualização publicada." />
              )}
            </div>
          </Section>
        )}
        {path === "/portal/visitas" && (
          <Section title="Visitas">
            <div className="space-y-3">
              {visits.data?.map(({ visit, property }) => (
                <Card key={visit.id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between">
                      <div>
                        <p className="font-bold">{date(visit.scheduledAt)}</p>
                        <p className="text-sm text-slate-500">
                          {property
                            ? `${property.titulo} — ${property.bairro ?? property.cidade}`
                            : rotulo(visit.visitType)}
                        </p>
                        {visit.responsibleName && (
                          <p className="text-sm">
                            Responsável: {visit.responsibleName}
                          </p>
                        )}
                      </div>
                      <Badge>{rotulo(visit.status)}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {visits.data?.length === 0 && (
                <Empty text="Nenhuma visita registrada." />
              )}
            </div>
          </Section>
        )}
        {path === "/portal/documentos" && (
          <Section title="Documentos e contratos">
            <div className="space-y-4">
              <LeadDocuments />
              {contracts.data?.map(contract => (
                <Card key={contract.id}>
                  <CardHeader>
                    <div className="flex justify-between">
                      <CardTitle className="text-lg">
                        Contrato {contract.number}
                      </CardTitle>
                      <Badge>{rotulo(contract.signatureStatus)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {contract.documents.map(document => (document.driveFileId || !document.url) ? (
                      <button
                        key={document.id}
                        type="button"
                        onClick={() => {
                          void utils.portal.contractDocumentContent.fetch({ id: document.id }).then(content =>
                            openDocument(content.base64, "application/pdf", content.fileName)
                          ).catch(() => toast.error("Falha ao consultar documento"));
                        }}
                        className="flex items-center gap-2 text-sm underline"
                      >
                        <Download className="h-4 w-4" />
                        {document.name}
                      </button>
                    ) : (
                      <a
                        key={document.id}
                        href={document.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 text-sm underline"
                      >
                        <Download className="h-4 w-4" />
                        {document.name}
                      </a>
                    ))}
                    {contract.signatureStatus === "solicitado" && (
                      <div className="rounded bg-amber-50 p-4 text-sm space-y-2">
                        <p className="font-bold">Assine em 3 passos</p>
                        <p>Baixe, assine e envie o contrato em PDF.</p>
                        <Button
                          size="sm"
                          onClick={() => {
                            setUploadContractId(contract.id);
                            contractFileRef.current?.click();
                          }}
                          disabled={enviando}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Enviar PDF
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {contracts.data?.length === 0 && (
                <Empty text="Nenhum documento disponível." />
              )}
              <input
                ref={contractFileRef}
                hidden
                type="file"
                accept="application/pdf"
                onChange={event => onContractFile(event.target.files?.[0])}
              />
            </div>
          </Section>
        )}
        {path === "/portal/chat" && (
          <Section title="Chat com a equipe">
            <Card>
              <CardContent className="p-4">
                <div className="h-[420px] overflow-y-auto space-y-3 mb-4">
                  {messages.data?.map(message => (
                    <div
                      key={message.id}
                      className={`max-w-[80%] rounded-lg p-3 ${message.sender === "cliente" ? "ml-auto bg-[#1A2332] text-white" : "bg-slate-100"}`}
                    >
                      <p>{message.text}</p>
                      <p className="text-[10px] opacity-60 mt-1">
                        {date(message.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    if (text.trim()) send.mutate({ text });
                  }}
                >
                  <Input
                    maxLength={2000}
                    value={text}
                    onChange={event => setText(event.target.value)}
                    placeholder="Digite sua mensagem"
                  />
                  <Button disabled={!text.trim() || send.isPending}>
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </Section>
        )}

        {path === "/portal/bilhetes" && (
          <Section title="Meus bilhetes">
            <div className="space-y-3">
              {tickets.data?.map(item => (
                <Card key={item.id}>
                  <CardContent className="p-4 flex justify-between gap-3">
                    <div>
                      <b>Bilhete #{item.ticketNumber}</b>
                      <p className="text-sm text-slate-500">
                        {item.quantity} unidade(s) • {date(item.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge>{rotulo(item.paymentStatus)}</Badge>
                      <p className="text-sm mt-2">
                        {money(Number(item.totalPaid) / 100)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {tickets.data?.length === 0 && (
                <Empty text="Você ainda não possui bilhetes." />
              )}
            </div>
          </Section>
        )}
        {path === "/portal/saldo" && (
          <Section title="Meu saldo">
            <div className="space-y-5">
              <Card className="bg-[#1A2332] text-white">
                <CardContent className="p-6">
                  <p className="text-slate-400">Saldo disponível</p>
                  <p className="text-4xl font-black text-[#C9A961]">
                    {Number(balance.data ?? 0).toLocaleString("pt-BR")} UTEF
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Movimentações</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {transactions.data?.map(item => (
                    <div
                      key={item.id}
                      className="flex justify-between border-b pb-3"
                    >
                      <div>
                        <b>{item.description}</b>
                        <p className="text-xs text-slate-500">
                          {date(item.createdAt)}
                        </p>
                      </div>
                      <span
                        className={
                          item.amount >= 0 ? "text-emerald-600" : "text-red-600"
                        }
                      >
                        {item.amount > 0 ? "+" : ""}
                        {item.amount.toLocaleString("pt-BR")} UTEF
                      </span>
                    </div>
                  ))}
                  {transactions.data?.length === 0 && (
                    <p className="text-slate-500">Nenhuma movimentação.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </Section>
        )}
        {path === "/portal/conversoes" && (
          <Section title="Minhas conversões">
            <div className="space-y-3">
              {conversions.data?.map(item => (
                <Card key={item.id}>
                  <CardContent className="p-4 flex justify-between gap-3">
                    <div>
                      <b>{item.product?.title ?? "Produto"}</b>
                      <p className="text-sm text-slate-500">
                        {item.utefAmount.toLocaleString("pt-BR")} UTEF •{" "}
                        {date(item.createdAt)}
                      </p>
                    </div>
                    <Badge>{rotulo(item.status)}</Badge>
                  </CardContent>
                </Card>
              ))}
              {conversions.data?.length === 0 && (
                <Empty text="Nenhuma conversão realizada." />
              )}
            </div>
          </Section>
        )}
      </main>
    </div>
  );
}

const ETAPA_COR = { concluida: "bg-green-500", em_andamento: "bg-[#C9A961]", pendente: "bg-slate-400" } as const;
const ETAPA_SITUACAO = { concluida: "Concluída", em_andamento: "Em andamento", pendente: "Não iniciada" } as const;

/** Etapas do financiamento (só leitura): a atual em destaque, as anteriores concluídas. */
function FinanciamentoEtapas({ status }: { status: string }) {
  if (status === "cancelado") {
    return (
      <Card>
        <CardContent className="p-4 text-sm font-semibold text-red-700">Financiamento cancelado.</CardContent>
      </Card>
    );
  }
  const etapas = FINANCIAMENTO_STATUS.filter(etapa => etapa !== "cancelado");
  const atual = etapas.indexOf(status as (typeof etapas)[number]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Etapas do financiamento</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {etapas.map((etapa, index) => {
            const feita = atual >= 0 && index < atual;
            const corrente = index === atual;
            return (
              <li
                key={etapa}
                aria-current={corrente ? "step" : undefined}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${corrente ? "border-[#C9A961] bg-[#1A2332] font-bold text-[#C9A961]" : feita ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${corrente ? "bg-[#C9A961] text-[#1A2332]" : feita ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}
                >
                  {feita ? "✓" : index + 1}
                </span>
                {rotulo(etapa)}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-2xl font-black mb-5">{title}</h1>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="md:col-span-2">
      <CardContent className="p-10 text-center text-slate-500">
        {text}
      </CardContent>
    </Card>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="h-3 rounded bg-slate-200 overflow-hidden">
      <div
        className="h-full bg-[#C9A961]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="font-semibold mt-1">{value}</p>
    </div>
  );
}
