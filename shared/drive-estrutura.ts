// Estrutura de pastas do Google Drive: nomes legíveis em português, iguais na
// Prospecta e no Grupo Santa Fé (gêmeo em Grupo-Santa-Fe/web/src/lib/drive-estrutura.ts).
//
//   <raiz do sistema>/
//     Clientes/<Nome do cliente (nº id)>/<Atendimento|Financiamento|Jurídico|…>/<Tipo — dd-mm-aaaa.ext>
//     Incorporação/<Nome do estudo (nº id)>/<Etapa>/<Documento — dd-mm-aaaa.ext>
//     Imóveis/<Título do imóvel (nº id)>/01 - Fotos/<Foto 01 — dd-mm-aaaa.jpg>
//                                     /02 - Documentos do imóvel, 03 - Plantas e projetos, 04 - Propostas e contratos
//     Obras/<Nome da obra (nº id)>/Medições CAIXA/<PCI original | PLS … — dd-mm-aaaa.xls/.pdf>
//
// Cada pasta criada pelo sistema leva uma etiqueta interna do Drive
// (appProperties[PROPRIEDADE_PASTA] = chave). A pasta é achada pela etiqueta,
// nunca pelo nome: renomear o cliente renomeia a pasta, sem duplicar.

export const PROPRIEDADE_PASTA = "pastaSistema";
export const CHAVE_RAIZ = "raiz";
export const CHAVE_CLIENTES = "clientes";
export const CHAVE_INCORPORACAO = "incorporacao";
export const PASTA_CLIENTES = "Clientes";
export const PASTA_INCORPORACAO = "Incorporação";
export const CHAVE_IMOVEIS = "imoveis";
export const PASTA_IMOVEIS = "Imóveis";
export const CHAVE_OBRAS = "obras";
export const PASTA_OBRAS = "Obras";
export const PASTA_MEDICOES_CAIXA = "Medições CAIXA";

/**
 * Pedido de 15/10: checklist fixo de pastas de cada imóvel, numeradas para
 * aparecerem sempre na mesma ordem no Drive. O sistema grava as fotos em
 * "01 - Fotos"; as demais ficam prontas para uso manual.
 */
export const PASTAS_IMOVEL = [
  { chave: "fotos", nome: "01 - Fotos" },
  { chave: "documentos", nome: "02 - Documentos do imóvel" },
  { chave: "plantas", nome: "03 - Plantas e projetos" },
  { chave: "negociacao", nome: "04 - Propostas e contratos" },
] as const;
export type PastaImovel = (typeof PASTAS_IMOVEL)[number]["chave"];

export type AreaCliente =
  | "atendimento" | "financiamento" | "juridico" | "regularizacao"
  | "obras" | "projetos" | "avaliacao" | "outros";

export const NOME_AREA: Record<AreaCliente, string> = {
  atendimento: "Atendimento",
  financiamento: "Financiamento",
  juridico: "Jurídico",
  regularizacao: "Regularização",
  obras: "Obras",
  projetos: "Projetos",
  avaliacao: "Avaliação",
  outros: "Outros serviços",
};

const AREA_DO_SERVICO: Record<string, AreaCliente> = {
  financiamento_habitacional: "financiamento",
  consorcio: "financiamento",
  regularizacao: "regularizacao",
  despachante: "regularizacao",
  juridico: "juridico",
  obra_cliente: "obras",
  vistoria_medicao: "obras",
  projeto_tecnico: "projetos",
  avaliacao: "avaliacao",
};

/** Documento sem serviço vinculado fica em "Atendimento". */
export function areaDoServico(tipoServico: string | null | undefined): AreaCliente {
  if (!tipoServico) return "atendimento";
  return AREA_DO_SERVICO[tipoServico] ?? "outros";
}

/** Rótulos dos tipos de documento do cliente usados no nome do arquivo. */
export const ROTULO_DOCUMENTO: Record<string, string> = {
  rg: "RG ou CNH frente e verso",
  cnh: "CNH",
  address_proof: "Comprovante de endereço",
  income_proof_formal: "Comprovante de renda",
  income_proof_irpf: "Declaração de IR",
  fgts: "Extrato do FGTS",
  spouse_docs: "RG ou CNH frente e verso (Cônjuge)",
  spouse_income_proof: "Comprovante de renda atualizado (Cônjuge)",
  birth_marriage_certificate: "Certidão de Nascimento ou Casamento",
  pis: "PIS",
  other: "Outro documento",
};

/** Tira barras e caracteres de controle e limita o tamanho (nome de pasta/arquivo). */
export function limparNome(texto: string | null | undefined, maximo = 120): string {
  return (texto ?? "")
    .replace(/[\\/\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximo)
    .trim();
}

export function nomeComNumero(nome: string | null | undefined, numero: string | number): string {
  return `${limparNome(nome) || "Sem nome"} (nº ${numero})`;
}

/** dd-mm-aaaa no horário de Brasília. */
export function dataArquivo(data: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(data);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}-${parte("month")}-${parte("year")}`;
}

const EXTENSAO_DO_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.ms-excel": ".xls",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": ".xlsm",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12": ".xlsb",
  "image/gif": ".gif",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
};

export function extensaoArquivo(nomeOriginal: string | null | undefined, mime: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(nomeOriginal ?? "");
  if (m) return `.${m[1].toLowerCase()}`;
  return EXTENSAO_DO_MIME[(mime ?? "").split(";")[0].trim().toLowerCase()] ?? "";
}

/** "RG — 15-10-2026.jpg" */
export function nomeArquivo(rotulo: string, data: Date, nomeOriginal: string | null | undefined, mime: string): string {
  return `${limparNome(rotulo, 150) || "Documento"} — ${dataArquivo(data)}${extensaoArquivo(nomeOriginal, mime)}`;
}

export const chaveCliente = (id: string | number) => `cliente:${id}`;
export const chaveArea = (id: string | number, area: AreaCliente) => `cliente:${id}:${area}`;
export const chaveEstudo = (id: string | number) => `incorporacao:${id}`;
export const chaveEtapaEstudo = (id: string | number, etapa: string) => `incorporacao:${id}:${etapa}`;
export const chaveImovel = (id: string | number) => `imovel:${id}`;
export const chavePastaImovel = (id: string | number, pasta: PastaImovel) => `imovel:${id}:${pasta}`;
export const chaveObra = (id: string | number) => `obra:${id}`;
export const chaveMedicoesObra = (id: string | number) => `obra:${id}:medicoes-caixa`;

/** Um nível da árvore: a etiqueta interna e o nome exibido. */
export interface PastaAlvo { chave: string; nome: string }

export function caminhoCliente(cliente: { id: string | number; numero: string | number; nome: string | null }, area: AreaCliente): PastaAlvo[] {
  return [
    { chave: CHAVE_CLIENTES, nome: PASTA_CLIENTES },
    { chave: chaveCliente(cliente.id), nome: nomeComNumero(cliente.nome, cliente.numero) },
    { chave: chaveArea(cliente.id, area), nome: NOME_AREA[area] },
  ];
}

export function caminhoEstudo(estudo: { id: string | number; numero: string | number; nome: string | null }, etapa: { chave: string; nome: string }): PastaAlvo[] {
  return [
    { chave: CHAVE_INCORPORACAO, nome: PASTA_INCORPORACAO },
    { chave: chaveEstudo(estudo.id), nome: nomeComNumero(estudo.nome, estudo.numero) },
    { chave: chaveEtapaEstudo(estudo.id, etapa.chave), nome: limparNome(etapa.nome) || "Documentos" },
  ];
}

export function caminhoImovel(imovel: { id: string | number; numero: string | number; nome: string | null }, pasta: PastaImovel): PastaAlvo[] {
  const sub = PASTAS_IMOVEL.find((p) => p.chave === pasta)!;
  return [
    { chave: CHAVE_IMOVEIS, nome: PASTA_IMOVEIS },
    { chave: chaveImovel(imovel.id), nome: nomeComNumero(imovel.nome, imovel.numero) },
    { chave: chavePastaImovel(imovel.id, pasta), nome: sub.nome },
  ];
}

/**
 * Pedido de 18/10: a PCI enviada (original, intacta) e cada medição preenchida
 * (.xls e .pdf) ficam em Obras/<Obra (nº)>/Medições CAIXA, uma cópia por versão.
 */
export function caminhoMedicoesObra(obra: { id: string | number; numero: string | number; nome: string | null }): PastaAlvo[] {
  return [
    { chave: CHAVE_OBRAS, nome: PASTA_OBRAS },
    { chave: chaveObra(obra.id), nome: nomeComNumero(obra.nome, obra.numero) },
    { chave: chaveMedicoesObra(obra.id), nome: PASTA_MEDICOES_CAIXA },
  ];
}

/** "Foto 01 — 15-10-2026.jpg": numeradas na ordem em que aparecem no anúncio. */
export function nomeFotoImovel(ordem: number, data: Date, mime: string): string {
  return `Foto ${String(ordem).padStart(2, "0")} — ${dataArquivo(data)}${extensaoArquivo(null, mime)}`;
}

/** Nomes que o sistema dava às pastas antes desta estrutura (cliente-19, incorporacao-3/-ckx…). */
const NOME_LEGADO = /^(cliente-\d+|incorporacao-[A-Za-z0-9]+)$/;

/**
 * Pasta antiga criada pelo sistema: sem etiqueta E com nome do formato antigo.
 * Pasta criada pelo dono (sem etiqueta, outro nome) nunca entra na limpeza.
 */
export function pastaLegada(pasta: { name?: string; appProperties?: Record<string, string> | null }): boolean {
  return !pasta.appProperties?.[PROPRIEDADE_PASTA] && NOME_LEGADO.test(pasta.name ?? "");
}

// ─── Organização completa (pedido de 29/10) ──────────────────────────────────
// Mesmos nomes/chaves no Grupo Santa Fé (web/src/lib/drive-estrutura.ts).
//
//   Clientes/<Nome (nº id)>/Atendimento/WhatsApp/<Mídia — dd-mm-aaaa.ext>
//   WhatsApp sem cliente/<+55 número>/<Mídia — dd-mm-aaaa.ext>
//   Obras/<Obra (nº id)>/Fotos/<Medição 01 — dd-mm-aaaa | Sem medição>/<Foto 01 — dd-mm-aaaa.jpg>
//   Obras/<Obra (nº id)>/Gerador de PCI/<PCI gerada — dd-mm-aaaa.xls|.xlsm|.pdf>
//   Incorporação/<Estudo (nº id)>/Orçamento/<Planilha importada — dd-mm-aaaa.xlsx>
//   Equipe/<Nome do usuário (nº id)>/<Documento pessoal|Anuidade CREA|Carteirinha CREA|Outros>/<Rótulo — dd-mm-aaaa.ext>
//   Modelos/PCI CAIXA/<PCI modelo v01 — dd-mm-aaaa.ext>

export const CHAVE_EQUIPE = "equipe";
export const PASTA_EQUIPE = "Equipe";
export const CHAVE_MODELOS = "modelos";
export const PASTA_MODELOS = "Modelos";
export const CHAVE_MODELOS_PCI = "modelos:pci";
export const PASTA_MODELOS_PCI = "PCI CAIXA";
export const CHAVE_WHATSAPP_SEM_CLIENTE = "whatsapp-sem-cliente";
export const PASTA_WHATSAPP_SEM_CLIENTE = "WhatsApp sem cliente";
export const PASTA_WHATSAPP = "WhatsApp";
export const PASTA_FOTOS_OBRA = "Fotos";
export const PASTA_FOTOS_SEM_MEDICAO = "Sem medição";
export const PASTA_GERADOR_PCI = "Gerador de PCI";
export const PASTA_ORCAMENTO = "Orçamento";

/** Categorias dos documentos do usuário (shared/engenheiro.ts) → nome da subpasta em Equipe. */
export const NOME_CATEGORIA_EQUIPE: Record<string, string> = {
  documento_pessoal: "Documento pessoal",
  anuidade_crea: "Anuidade CREA",
  carteirinha_crea: "Carteirinha CREA",
  outros: "Outros",
};
export const categoriaEquipe = (categoria: string | null | undefined): string =>
  categoria && NOME_CATEGORIA_EQUIPE[categoria] ? categoria : "outros";

export const chaveEquipe = (id: string | number) => `equipe:${id}`;
export const chaveCategoriaEquipe = (id: string | number, categoria: string) => `equipe:${id}:${categoriaEquipe(categoria)}`;
export const chaveFotosObra = (id: string | number) => `obra:${id}:fotos`;
export const chaveFotosMedicao = (id: string | number, medicaoId: string | number | null) => `obra:${id}:fotos:medicao:${medicaoId ?? "sem"}`;
export const chaveGeradorPci = (id: string | number) => `obra:${id}:gerador-pci`;
export const chaveWhatsappCliente = (id: string | number) => `cliente:${id}:atendimento:whatsapp`;
export const chaveWhatsappSemCliente = (numero: string) => `whatsapp-sem-cliente:${digitosTelefone(numero)}`;
export const chaveOrcamentoEstudo = (id: string | number) => `incorporacao:${id}:orcamento`;

/** Só os dígitos do telefone (a etiqueta não depende da formatação). */
export function digitosTelefone(numero: string | null | undefined): string {
  return (numero ?? "").replace(/@.*$/, "").replace(/\D/g, "") || "sem-numero";
}

/** "+5511999990000" (pasta da conversa sem cliente). */
export function nomeNumeroWhatsapp(numero: string | null | undefined): string {
  const d = digitosTelefone(numero);
  return d === "sem-numero" ? "Sem número" : `+${d}`;
}

const doisDigitos = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(2, "0");

type Entidade = { id: string | number; numero: string | number; nome: string | null };

function baseObra(obra: Entidade): PastaAlvo[] {
  return [
    { chave: CHAVE_OBRAS, nome: PASTA_OBRAS },
    { chave: chaveObra(obra.id), nome: nomeComNumero(obra.nome, obra.numero) },
  ];
}

/** Equipe/<Nome do usuário (nº id)>/<Categoria> */
export function caminhoEquipe(usuario: Entidade, categoria: string): PastaAlvo[] {
  const cat = categoriaEquipe(categoria);
  return [
    { chave: CHAVE_EQUIPE, nome: PASTA_EQUIPE },
    { chave: chaveEquipe(usuario.id), nome: nomeComNumero(usuario.nome, usuario.numero) },
    { chave: chaveCategoriaEquipe(usuario.id, cat), nome: NOME_CATEGORIA_EQUIPE[cat] },
  ];
}

/** Modelos/PCI CAIXA */
export function caminhoModelosPci(): PastaAlvo[] {
  return [
    { chave: CHAVE_MODELOS, nome: PASTA_MODELOS },
    { chave: CHAVE_MODELOS_PCI, nome: PASTA_MODELOS_PCI },
  ];
}

/** "Medição 01 — 15-10-2026" (ordem da medição na obra e data em que foi lançada). */
export function nomePastaMedicaoFotos(ordem: number, data: Date): string {
  return `Medição ${doisDigitos(ordem)} — ${dataArquivo(data)}`;
}

/** Obras/<Obra (nº id)>/Fotos/<Medição 01 — dd-mm-aaaa | Sem medição> */
export function caminhoFotosObra(obra: Entidade, medicao: { id: string | number; ordem: number; data: Date } | null): PastaAlvo[] {
  return [
    ...baseObra(obra),
    { chave: chaveFotosObra(obra.id), nome: PASTA_FOTOS_OBRA },
    medicao
      ? { chave: chaveFotosMedicao(obra.id, medicao.id), nome: nomePastaMedicaoFotos(medicao.ordem, medicao.data) }
      : { chave: chaveFotosMedicao(obra.id, null), nome: PASTA_FOTOS_SEM_MEDICAO },
  ];
}

/** "Foto 01 — 15-10-2026.jpg" (mesmo padrão das fotos de imóveis). */
export function nomeFotoObra(ordem: number, data: Date, mime: string): string {
  return nomeFotoImovel(ordem, data, mime);
}

/** Obras/<Obra (nº id)>/Gerador de PCI */
export function caminhoGeradorPci(obra: Entidade): PastaAlvo[] {
  return [...baseObra(obra), { chave: chaveGeradorPci(obra.id), nome: PASTA_GERADOR_PCI }];
}

/** Clientes/<Nome (nº id)>/Atendimento/WhatsApp */
export function caminhoWhatsappCliente(cliente: Entidade): PastaAlvo[] {
  return [...caminhoCliente(cliente, "atendimento"), { chave: chaveWhatsappCliente(cliente.id), nome: PASTA_WHATSAPP }];
}

/** WhatsApp sem cliente/<+55 número> */
export function caminhoWhatsappSemCliente(numero: string | null | undefined): PastaAlvo[] {
  return [
    { chave: CHAVE_WHATSAPP_SEM_CLIENTE, nome: PASTA_WHATSAPP_SEM_CLIENTE },
    { chave: chaveWhatsappSemCliente(numero ?? ""), nome: nomeNumeroWhatsapp(numero) },
  ];
}

/** Incorporação/<Estudo (nº id)>/Orçamento */
export function caminhoOrcamentoEstudo(estudo: Entidade): PastaAlvo[] {
  return caminhoEstudo(estudo, { chave: "orcamento", nome: PASTA_ORCAMENTO });
}

export const nomeMidiaWhatsapp = (data: Date, nomeOriginal: string | null | undefined, mime: string) => nomeArquivo("Mídia", data, nomeOriginal, mime);
export const nomePciGerada = (data: Date, nomeOriginal: string | null | undefined, mime: string) => nomeArquivo("PCI gerada", data, nomeOriginal, mime);
export const nomeModeloPci = (versao: number, data: Date, nomeOriginal: string | null | undefined, mime: string) =>
  nomeArquivo(`PCI modelo v${doisDigitos(versao)}`, data, nomeOriginal, mime);
export const nomePlanilhaOrcamento = (data: Date, nomeOriginal: string | null | undefined, mime: string) => nomeArquivo("Planilha importada", data, nomeOriginal, mime);
export const nomeDocumentoEquipe = (categoria: string, data: Date, nomeOriginal: string | null | undefined, mime: string) =>
  nomeArquivo(NOME_CATEGORIA_EQUIPE[categoriaEquipe(categoria)], data, nomeOriginal, mime);

/**
 * Pastas de entidades (uma por registro do banco) dentro de cada categoria.
 * A etiqueta "<prefixo>:<id>" identifica o registro; usada para achar pastas
 * órfãs (registro excluído) no "Organizar Drive".
 */
export const CATEGORIAS_ENTIDADE = [
  { entidade: "cliente", chaveCategoria: CHAVE_CLIENTES },
  { entidade: "obra", chaveCategoria: CHAVE_OBRAS },
  { entidade: "incorporacao", chaveCategoria: CHAVE_INCORPORACAO },
  { entidade: "imovel", chaveCategoria: CHAVE_IMOVEIS },
  { entidade: "equipe", chaveCategoria: CHAVE_EQUIPE },
] as const;
export type EntidadeDrive = (typeof CATEGORIAS_ENTIDADE)[number]["entidade"];

export const chaveEntidade = (entidade: EntidadeDrive, id: string | number) => `${entidade}:${id}`;

/** "cliente:19" → 19 quando a etiqueta é exatamente a pasta da entidade; senão null. */
export function idDaChaveEntidade(entidade: EntidadeDrive, chave: string | null | undefined): number | null {
  const m = new RegExp(`^${entidade}:(\\d{1,9})$`).exec(chave ?? "");
  return m ? Number(m[1]) : null;
}
