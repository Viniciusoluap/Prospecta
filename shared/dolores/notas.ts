// EPIC-025 (Dolores, etapa 5) — regras PURAS das notas de obra: a saída fechada da leitura pela IA (zod), as conferências
// determinísticas (dígito verificador de CPF/CNPJ, soma dos itens × total, data plausível, chave de acesso da NF-e cruzada com
// CNPJ, número e mês), a limpeza dos textos lidos (filtro do registro, sem links, sem dados bancários), o reconhecimento da
// resposta do empreiteiro no grupo (POR CÓDIGO, nunca pelo modelo), a conciliação com os lançamentos do BPO (só aponta) e o
// texto sugerido para o DONO enviar. Sem banco nem rede.
// Regras fixas: o que não foi lido (ou não passou na conferência) fica VAZIO e vira dúvida — nunca é inventado nem "corrigido";
// nada do texto da nota vira ação, destino, nome de pasta ou link; a confirmação do empreiteiro é um INDÍCIO, não assinatura.
import { z } from "zod";
import { isValidCPF } from "../cpf.js";
import { SERVICOS_PROGRESSO } from "../financeiro/progresso.js";
import { textoDeDado, umaLinha } from "./fila.js";
import { nomeComparavel } from "./grupos.js";
import { tratarLinksDaResposta } from "./links.js";
import { BANCARIO_OMITIDO, sanitizarTexto } from "./sanitizar.js";
import { cnpjValido as cnpjValidoFiscal } from "../fiscal/documento.js";

export const TIPOS_NOTA = ["nfe", "nfse", "nfce", "recibo", "cupom", "outro"] as const;
export type TipoNota = (typeof TIPOS_NOTA)[number];
export const ROTULO_TIPO_NOTA: Record<TipoNota, string> = {
  nfe: "NF-e (produto)", nfse: "NFS-e (serviço)", nfce: "NFC-e (consumidor)", recibo: "Recibo", cupom: "Cupom fiscal", outro: "Outro documento",
};

/** Categorias do pagamento de obra (as mesmas de obra_movimentos / tipo de despesa de obra do BPO; sem terreno nem comissão). */
export const CATEGORIAS_NOTA = ["empreiteiro", "fornecedor", "material", "mao_de_obra", "outros"] as const;
export type CategoriaNota = (typeof CATEGORIAS_NOTA)[number];
export const ROTULO_CATEGORIA_NOTA: Record<CategoriaNota, string> = {
  empreiteiro: "Empreiteiro", fornecedor: "Fornecedor", material: "Material", mao_de_obra: "Mão de obra", outros: "Outros",
};

/** Etapas da obra (chaves de SERVICOS_PROGRESSO, as mesmas da tela de pagamentos da obra). */
export const ETAPAS_OBRA: readonly string[] = SERVICOS_PROGRESSO.map(s => s.chave);
export const NOME_ETAPA: Readonly<Record<string, string>> = Object.fromEntries(SERVICOS_PROGRESSO.map(s => [s.chave, s.nome]));

export const SITUACOES_NOTA = ["rascunho", "confira", "ilegivel", "nao_lida", "nao_e_nota"] as const;
export type SituacaoNota = (typeof SITUACOES_NOTA)[number];
export const ROTULO_SITUACAO_NOTA: Record<SituacaoNota, string> = {
  rascunho: "rascunho (lido; aguarda o dono)", confira: "rascunho — confira (dúvidas na leitura)", ilegivel: "ilegível",
  nao_lida: "não lida pela IA (fora dos limites de custo ou formato)", nao_e_nota: "não parece nota",
};

export type ItemNota = { descricao: string; quantidade: number | null; valorCentavos: number | null };

/** Abaixo disto, o campo lido vira dúvida ("confira"). */
export const LIMIAR_CONFIANCA_NOTA = 0.8;
/** Teto do valor aceito numa nota de obra (R$ 5 milhões): acima, o valor fica vazio e vira dúvida. */
export const TETO_VALOR_NOTA_CENTAVOS = 500_000_000;
/** Data plausível: até 1 dia no futuro (fuso) e no máximo 18 meses para trás. */
export const DIAS_MAXIMOS_PASSADO = 540;
export const MAX_ITENS_NOTA = 30;

const CAMPOS_CONFIANCA = ["tipo", "emitente", "documento", "numero", "data", "valor", "descricao", "itens", "chave"] as const;
export type CampoNota = (typeof CAMPOS_CONFIANCA)[number];
const confianca = z.number().min(0).max(1);

/** Saída da leitura: estrutura FECHADA (campo a mais, tipo fora do enum ou texto solto → leitura inválida). */
export const saidaNota = z.object({
  eNota: z.boolean(),
  tipo: z.enum(TIPOS_NOTA).nullable(),
  emitenteNome: z.string().max(300).nullable(),
  emitenteDocumento: z.string().max(40).nullable(),
  numero: z.string().max(60).nullable(),
  dataEmissao: z.string().max(20).nullable(),
  valorTotalCentavos: z.number().int().nullable(),
  descricao: z.string().max(800).nullable(),
  itens: z.array(z.object({
    descricao: z.string().max(300), quantidade: z.number().nullable(), valorCentavos: z.number().int().nullable(),
  }).strict()).max(MAX_ITENS_NOTA),
  chaveAcesso: z.string().max(80).nullable(),
  categoriaSugerida: z.enum(CATEGORIAS_NOTA).nullable(),
  etapaSugerida: z.string().max(60).nullable(),
  sinais: z.object({ ilegivel: z.boolean(), possivelAdulteracao: z.boolean(), temDadosBancarios: z.boolean() }).strict(),
  confianca: z.object(Object.fromEntries(CAMPOS_CONFIANCA.map(c => [c, confianca])) as Record<CampoNota, typeof confianca>).strict(),
}).strict();
export type SaidaNota = z.infer<typeof saidaNota>;

export function lerSaidaNota(bruta: unknown): SaidaNota | null {
  const r = saidaNota.safeParse(bruta);
  return r.success ? r.data : null;
}

const texto = (descricao: string, max: number) => ({ type: ["string", "null"], maxLength: max, description: descricao });
/** JSON Schema da ÚNICA ferramenta que o modelo pode (e é obrigado a) chamar na leitura de nota. */
export const FERRAMENTA_NOTA = {
  name: "registrar_leitura_nota",
  description: "Registra os dados lidos de UMA nota fiscal ou recibo de obra. É a única resposta possível.",
  input_schema: {
    type: "object",
    properties: {
      eNota: { type: "boolean", description: "O documento é nota fiscal, nota de serviço, recibo ou cupom de compra/serviço?" },
      tipo: { type: ["string", "null"], enum: [...TIPOS_NOTA, null] },
      emitenteNome: texto("Nome ou razão social de quem EMITIU (o fornecedor/empreiteiro), como está escrito.", 160),
      emitenteDocumento: texto("CPF ou CNPJ do emitente, como está escrito.", 30),
      numero: texto("Número da nota ou do recibo.", 30),
      dataEmissao: texto("Data de emissão no formato AAAA-MM-DD.", 10),
      valorTotalCentavos: { type: ["integer", "null"], description: "Valor TOTAL em centavos (R$ 1.234,56 = 123456)." },
      descricao: texto("Resumo do serviço ou dos produtos, em até 300 caracteres, sem dados bancários.", 300),
      itens: {
        type: "array", maxItems: MAX_ITENS_NOTA,
        items: {
          type: "object", additionalProperties: false, required: ["descricao", "quantidade", "valorCentavos"],
          properties: {
            descricao: { type: "string", maxLength: 120 }, quantidade: { type: ["number", "null"] },
            valorCentavos: { type: ["integer", "null"], description: "Valor total do item em centavos." },
          },
        },
      },
      chaveAcesso: texto("Chave de acesso de 44 dígitos (NF-e/NFC-e), se houver.", 60),
      categoriaSugerida: { type: ["string", "null"], enum: [...CATEGORIAS_NOTA, null] },
      etapaSugerida: { type: ["string", "null"], enum: [...ETAPAS_OBRA, null] },
      sinais: {
        type: "object", additionalProperties: false, required: ["ilegivel", "possivelAdulteracao", "temDadosBancarios"],
        properties: {
          ilegivel: { type: "boolean" }, possivelAdulteracao: { type: "boolean", description: "Rasura, montagem, campos que não batem." },
          temDadosBancarios: { type: "boolean", description: "A nota traz banco, agência, conta ou chave PIX? (NÃO copie esses dados.)" },
        },
      },
      confianca: {
        type: "object", additionalProperties: false, required: [...CAMPOS_CONFIANCA],
        properties: Object.fromEntries(CAMPOS_CONFIANCA.map(c => [c, { type: "number", minimum: 0, maximum: 1 }])),
        description: "0 a 1, POR CAMPO: quanto você tem certeza do que leu (0 se o campo não existe ou não deu para ler).",
      },
    },
    required: ["eNota", "tipo", "emitenteNome", "emitenteDocumento", "numero", "dataEmissao", "valorTotalCentavos", "descricao", "itens",
      "chaveAcesso", "categoriaSugerida", "etapaSugerida", "sinais", "confianca"],
    additionalProperties: false,
  },
} as const;

// ── Conferências determinísticas ──

/** CNPJ numérico conferido (as notas de grupo gravam só números: CHECK da 0128). Cálculo no validador único (EPIC-029 S-5). */
export function cnpjValido(d: string): boolean {
  return /^\d{14}$/.test(d) && cnpjValidoFiscal(d);
}
export const cpfValido = (d: string) => /^\d{11}$/.test(d) && isValidCPF(d);

/** CPF ou CNPJ lido: só dígitos e com o DV conferido; senão null (o campo fica vazio). */
export function documentoConferido(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  return (d.length === 11 && cpfValido(d)) || (d.length === 14 && cnpjValido(d)) ? d : null;
}

/** CPF/CNPJ para mostrar: CNPJ (empresa) inteiro e formatado; CPF (pessoa) só com os 2 últimos dígitos. */
export function documentoParaMostrar(d: string | null | undefined): string | null {
  if (!d) return null;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d.length === 11 ? `***.***.***-${d.slice(-2)}` : null;
}

function dvChaveNfe(d: string): boolean {
  let soma = 0, peso = 2;
  for (let k = 42; k >= 0; k--) { soma += Number(d[k]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(d[43]);
}

/** Partes da chave de acesso (layout da NF-e: UF, AAMM, CNPJ, modelo, série, número, forma, código, DV). */
export function partesDaChave(chave: string) {
  return { uf: chave.slice(0, 2), aamm: chave.slice(2, 6), cnpj: chave.slice(6, 20), modelo: chave.slice(20, 22), numero: chave.slice(25, 34) };
}

export type ConferenciaChave = { chave: string | null; problemas: string[] };
/**
 * Chave de acesso: 44 dígitos, DV certo, modelo 55/65, CNPJ do emitente válido nas posições 7–20 — e cruzada com o que foi lido:
 * mesmo CNPJ do emitente, mesmo número da nota e mesmo ano/mês da emissão. Divergência = possível adulteração (sinalizada).
 */
export function conferirChave(bruta: string | null | undefined, lido: { documento: string | null; numero: string | null; data: string | null }): ConferenciaChave {
  const d = String(bruta ?? "").replace(/\D/g, "");
  if (!d) return { chave: null, problemas: [] };
  if (d.length !== 44 || /^(\d)\1+$/.test(d) || !dvChaveNfe(d)) return { chave: null, problemas: ["chave de acesso inválida (dígito verificador ou tamanho)"] };
  const p = partesDaChave(d);
  const problemas: string[] = [];
  if (p.modelo !== "55" && p.modelo !== "65") problemas.push("chave de acesso com modelo que não é NF-e/NFC-e");
  if (!cnpjValido(p.cnpj)) problemas.push("chave de acesso com CNPJ inválido");
  if (lido.documento && lido.documento.length === 14 && lido.documento !== p.cnpj) problemas.push("o CNPJ da chave de acesso não é o do emitente lido");
  const numeroLido = numeroComparavel(lido.numero);
  if (numeroLido && numeroLido !== String(Number(p.numero))) problemas.push("o número na chave de acesso não é o número lido da nota");
  if (lido.data && `${lido.data.slice(2, 4)}${lido.data.slice(5, 7)}` !== p.aamm) problemas.push("o mês/ano na chave de acesso não é o da data de emissão lida");
  return { chave: problemas.length ? null : d, problemas };
}

/** Número da nota para comparar duplicidade: só os dígitos, sem zeros à esquerda (null se não houver dígito). */
export function numeroComparavel(n: string | null | undefined): string | null {
  const d = String(n ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return d ? d : null;
}

/** Número lido aceito: letras, dígitos, ponto, hífen e barra (até 30). Qualquer outra coisa → vazio. */
export function numeroConferido(n: string | null | undefined): string | null {
  const t = umaLinha(n, 60).replace(/\s+/g, "");
  return /^[0-9A-Za-z./-]{1,30}$/.test(t) && /\d/.test(t) ? t : null;
}

/** Data AAAA-MM-DD real, não futura (até 1 dia de folga) e não mais velha que DIAS_MAXIMOS_PASSADO. */
export function dataConferida(s: string | null | undefined, agora: Date): string | null {
  const t = String(s ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return null;
  const dif = (agora.getTime() - d.getTime()) / 86_400_000;
  return dif >= -1 && dif <= DIAS_MAXIMOS_PASSADO ? t : null;
}

export const valorConferido = (v: number | null | undefined) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= TETO_VALOR_NOTA_CENTAVOS ? v : null;

/**
 * Texto lido da nota (de TERCEIRO) para gravar e mostrar: uma linha, sem controle/invisíveis, colchetes trocados, filtro do
 * registro (dados pessoais mascarados; senhas e dados bancários sempre fora) e SEM links (link vira "[link removido]"; nada da
 * nota vira destino). `bancario` diz se o filtro tirou dado bancário (para o alerta).
 */
export function textoLido(s: string | null | undefined, max: number): { texto: string | null; bancario: boolean } {
  const base = umaLinha(s, 2000);
  if (!base) return { texto: null, bancario: false };
  const filtrado = sanitizarTexto(base, { mascararDadosPessoais: true });
  const semLink = tratarLinksDaResposta(filtrado, null);
  const t = textoDeDado(semLink, max).trim();
  return { texto: t || null, bancario: filtrado.includes(BANCARIO_OMITIDO) };
}

export type LeituraConferida = {
  situacao: SituacaoNota;
  tipo: TipoNota | null;
  emitenteNome: string | null;
  emitenteDocumento: string | null;
  numero: string | null;
  dataEmissao: string | null;
  valorCentavos: number | null;
  descricao: string | null;
  itens: ItemNota[];
  chaveAcesso: string | null;
  categoria: CategoriaNota | null;
  etapa: string | null;
  confianca: Record<string, number>;
  duvidas: string[];
  alertas: string[];
};

export const ALERTA_BANCARIO = "a nota traz dados bancários (banco, agência, conta ou PIX): NÃO foram gravados";

/**
 * Confere a saída da IA. Tudo o que falha (ou tem confiança baixa) fica VAZIO e vira dúvida; nada é completado nem corrigido.
 * Saída inválida (null) → "confira" sem nenhum campo.
 */
export function conferirLeitura(saida: SaidaNota | null, agora: Date): LeituraConferida {
  const vazia: LeituraConferida = {
    situacao: "confira", tipo: null, emitenteNome: null, emitenteDocumento: null, numero: null, dataEmissao: null, valorCentavos: null,
    descricao: null, itens: [], chaveAcesso: null, categoria: null, etapa: null, confianca: {}, duvidas: [], alertas: [],
  };
  if (!saida) return { ...vazia, duvidas: ["a IA não devolveu uma leitura válida: confira a nota no grupo"] };
  const c = saida.confianca;
  const duvidas: string[] = [];
  const alertas: string[] = [];
  const confiavel = (campo: CampoNota, rotulo: string, presente: boolean) => {
    if (!presente) { duvidas.push(`${rotulo}: não lido`); return false; }
    if (c[campo] < LIMIAR_CONFIANCA_NOTA) { duvidas.push(`${rotulo}: leitura com confiança baixa (${Math.round(c[campo] * 100)}%) — não gravado; confira`); return false; }
    return true;
  };
  let bancario = saida.sinais.temDadosBancarios;
  const lerTexto = (s: string | null, max: number) => { const r = textoLido(s, max); bancario ||= r.bancario; return r.texto; };

  if (!saida.eNota) {
    return { ...vazia, situacao: "nao_e_nota", confianca: { ...c }, duvidas: ["a IA leu que o documento não é nota nem recibo; confira"],
      alertas: bancario ? [ALERTA_BANCARIO] : [] };
  }
  const tipo = confiavel("tipo", "tipo", !!saida.tipo) ? saida.tipo : null;
  const nomeLido = lerTexto(saida.emitenteNome, 160);
  const emitenteNome = confiavel("emitente", "emitente", !!nomeLido) ? nomeLido : null;
  let emitenteDocumento: string | null = null;
  if (saida.emitenteDocumento && c.documento >= LIMIAR_CONFIANCA_NOTA) {
    emitenteDocumento = documentoConferido(saida.emitenteDocumento);
    if (!emitenteDocumento) duvidas.push("CPF/CNPJ do emitente: o dígito verificador não confere — não gravado");
  } else confiavel("documento", "CPF/CNPJ do emitente", !!saida.emitenteDocumento);
  let numero: string | null = null;
  if (confiavel("numero", "número", !!saida.numero)) {
    numero = numeroConferido(saida.numero);
    if (!numero) duvidas.push("número: formato não reconhecido — não gravado");
  }
  let dataEmissao: string | null = null;
  if (confiavel("data", "data de emissão", !!saida.dataEmissao)) {
    dataEmissao = dataConferida(saida.dataEmissao, agora);
    if (!dataEmissao) duvidas.push("data de emissão: data inválida, no futuro ou antiga demais — não gravada");
  }
  let valorCentavos: number | null = null;
  if (confiavel("valor", "valor total", saida.valorTotalCentavos !== null)) {
    valorCentavos = valorConferido(saida.valorTotalCentavos);
    if (!valorCentavos) duvidas.push("valor total: zero, negativo ou acima do teto — não gravado");
  }
  const descricaoLida = lerTexto(saida.descricao, 400);
  const descricao = confiavel("descricao", "descrição", !!descricaoLida) ? descricaoLida : null;
  const itens: ItemNota[] = [];
  if (saida.itens.length && c.itens >= LIMIAR_CONFIANCA_NOTA) {
    for (const i of saida.itens.slice(0, MAX_ITENS_NOTA)) {
      const d = lerTexto(i.descricao, 120);
      if (!d) continue;
      itens.push({ descricao: d, quantidade: typeof i.quantidade === "number" && Number.isFinite(i.quantidade) && i.quantidade > 0 ? i.quantidade : null,
        valorCentavos: valorConferido(i.valorCentavos) });
    }
  } else if (saida.itens.length) duvidas.push(`itens: leitura com confiança baixa (${Math.round(c.itens * 100)}%) — não gravados; confira`);
  // soma dos itens × total (só quando todos os itens têm valor)
  if (itens.length && valorCentavos !== null && itens.every(i => i.valorCentavos !== null)) {
    const soma = itens.reduce((t, i) => t + (i.valorCentavos ?? 0), 0);
    if (Math.abs(soma - valorCentavos) > itens.length) alertas.push(`a soma dos itens (${reais(soma)}) não bate com o total lido (${reais(valorCentavos)}): confira`);
  }
  let chaveAcesso: string | null = null;
  if (saida.chaveAcesso && c.chave >= LIMIAR_CONFIANCA_NOTA) {
    const r = conferirChave(saida.chaveAcesso, { documento: emitenteDocumento, numero, data: dataEmissao });
    chaveAcesso = r.chave;
    for (const p of r.problemas) alertas.push(`possível adulteração: ${p}`);
  } else if (saida.chaveAcesso) duvidas.push("chave de acesso: leitura com confiança baixa — não gravada");
  else if (tipo === "nfe" || tipo === "nfce") duvidas.push("chave de acesso: não lida (NF-e/NFC-e deveria ter)");
  if (saida.sinais.possivelAdulteracao) alertas.push("possível adulteração apontada na leitura (rasura, montagem ou campos que não batem): confira o original");
  if (bancario) alertas.push(ALERTA_BANCARIO);
  const etapa = saida.etapaSugerida && ETAPAS_OBRA.includes(saida.etapaSugerida) ? saida.etapaSugerida : null;
  const situacao: SituacaoNota = saida.sinais.ilegivel ? "ilegivel" : (duvidas.length || alertas.length ? "confira" : "rascunho");
  return {
    situacao, tipo, emitenteNome, emitenteDocumento, numero, dataEmissao, valorCentavos, descricao, itens, chaveAcesso,
    categoria: saida.categoriaSugerida, etapa, confianca: { ...c }, duvidas: duvidas.slice(0, 20), alertas: alertas.slice(0, 10),
  };
}

export const reais = (centavos: number | null | undefined) =>
  centavos === null || centavos === undefined ? "(sem valor)" : (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "17/11/2026" de "2026-11-17". */
export const dataBr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "(sem data)");

// ── Duplicidade ──

export type NotaParaDuplicidade = { id: number; arquivoSha256: string | null; chaveAcesso: string | null; emitenteDocumento: string | null; numero: string | null };
/** Nota anterior igual: mesmo arquivo (SHA-256), mesma chave de acesso ou mesmo número + mesmo emitente (CPF/CNPJ). */
export function motivoDuplicidade(nova: Omit<NotaParaDuplicidade, "id">, anterior: NotaParaDuplicidade): string | null {
  if (nova.arquivoSha256 && nova.arquivoSha256 === anterior.arquivoSha256) return `mesmo arquivo da nota ${anterior.id}`;
  if (nova.chaveAcesso && nova.chaveAcesso === anterior.chaveAcesso) return `mesma chave de acesso da nota ${anterior.id}`;
  const n = numeroComparavel(nova.numero);
  if (n && nova.emitenteDocumento && nova.emitenteDocumento === anterior.emitenteDocumento && n === numeroComparavel(anterior.numero)) {
    return `mesmo número e mesmo emitente da nota ${anterior.id}`;
  }
  return null;
}

// ── Resposta do empreiteiro no grupo (reconhecida por CÓDIGO) ──

export type RespostaEmpreiteiro =
  | { tipo: "confirmacao"; notaRef: number | null }
  | { tipo: "correcao"; notaRef: number | null; detalhe: string | null }
  | { tipo: "ambigua" };

const NUM_NOTA = String.raw`(?:\s+(?:a\s+)?nota\s*(?:n(?:[o.º°]|umero)?\s*\.?\s*)?#?\s*(\d{1,9}))?`;
const CONFIRMA = new RegExp(String.raw`^(?:sim[\s,]+)?(?:confirmo|confirmado|confirmada|confere|esta\s+corret[ao])${NUM_NOTA}\s*[.!]*$`);
const CORRIGE = new RegExp(String.raw`^(?:corrigir|corrige|correcao|nao\s+confere|esta\s+errad[ao])${NUM_NOTA}\s*[:,.\-]?\s*(.*)$`);

/**
 * Reconhece a resposta do empreiteiro (texto INTEIRO, já normalizado sem acento e minúsculo): "confirmo", "confirmo nota 45",
 * "sim, confirmo", "confere"… → confirmação; "corrigir nota 45 o valor é…" / "não confere…" → pedido de correção. Qualquer
 * outra coisa → null (não é resposta). Confirmação com negação, dúvida, pergunta ou dois números de nota → "ambigua".
 */
export function lerRespostaDoEmpreiteiro(bruto: string | null | undefined): RespostaEmpreiteiro | null {
  const t = umaLinha(String(bruto ?? "").normalize("NFKC"), 400).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!t || t.length > 300) return null;
  const corr = CORRIGE.exec(t);
  if (corr) {
    const detalhe = (corr[2] ?? "").trim();
    return { tipo: "correcao", notaRef: corr[1] ? Number(corr[1]) : null, detalhe: detalhe ? detalhe.slice(0, 300) : null };
  }
  const conf = CONFIRMA.exec(t);
  if (conf) return { tipo: "confirmacao", notaRef: conf[1] ? Number(conf[1]) : null };
  // começa como confirmação mas tem algo a mais (negação, dúvida, outro número): não é inequívoca
  if (/^(?:sim[\s,]+)?(?:confirm|confere)/.test(t) || /\bconfirmo\b/.test(t)) {
    return { tipo: "ambigua" };
  }
  return null;
}

/** Id (externo) da mensagem CITADA na resposta do WhatsApp (contextInfo.stanzaId), ou null. */
export function mensagemCitada(item: unknown): string | null {
  const m = ((item ?? {}) as { message?: Record<string, any> | null }).message ?? {};
  const raiz = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m;
  for (const k of ["extendedTextMessage", "imageMessage", "documentMessage", "videoMessage", "conversation"]) {
    const ctx = raiz?.[k]?.contextInfo;
    if (ctx && typeof ctx.stanzaId === "string" && ctx.stanzaId.trim()) return ctx.stanzaId.trim().slice(0, 160);
  }
  return null;
}

export type CandidataConfirmacao = { id: number; grupoId: number; externalIdMensagem: string; criadoEm: Date; confirmacao: "pendente" | "confirmada" | "correcao" };
export type ResultadoLigacao =
  | { ok: true; notaId: number; ligacao: "citacao" | "referencia" }
  | { ok: false; motivo: string };

/**
 * Liga a resposta à nota CERTA, sem adivinhar: citando a mensagem da nota (stanzaId) OU escrevendo "NOTA <número do sistema>".
 * Com as duas, têm de apontar para a mesma nota. A nota tem de ser do MESMO grupo, estar no prazo e ainda sem resposta.
 */
export function ligarRespostaANota(p: {
  grupoId: number; citada: string | null; notaRef: number | null; agora: Date; prazoDias: number;
  porCitacao: CandidataConfirmacao | null; porReferencia: CandidataConfirmacao | null;
}): ResultadoLigacao {
  if (!p.citada && p.notaRef === null) return { ok: false, motivo: "resposta sem referência à nota (não cita a mensagem da nota nem diz o número)" };
  if (p.citada && !p.porCitacao && p.notaRef === null) return { ok: false, motivo: "a mensagem citada não é uma nota registrada deste grupo" };
  if (p.notaRef !== null && !p.porReferencia && !p.porCitacao) return { ok: false, motivo: `a nota ${p.notaRef} não existe neste grupo` };
  if (p.citada && p.porCitacao && p.notaRef !== null && p.porCitacao.id !== p.notaRef) return { ok: false, motivo: "a mensagem citada é de outra nota que não a do número escrito (ambígua)" };
  const nota = p.porCitacao ?? p.porReferencia;
  if (!nota) return { ok: false, motivo: "nota não encontrada" };
  if (nota.grupoId !== p.grupoId) return { ok: false, motivo: "a nota é de outro grupo" };
  if (nota.confirmacao !== "pendente") return { ok: false, motivo: `a nota ${nota.id} já tem resposta registrada` };
  const idadeDias = (p.agora.getTime() - nota.criadoEm.getTime()) / 86_400_000;
  // folga de 1 dia para relógios diferentes (servidor × banco); resposta "antes" da nota além disso não vale
  if (idadeDias > p.prazoDias || idadeDias < -1) return { ok: false, motivo: `fora do prazo de ${p.prazoDias} dias para confirmar a nota ${nota.id}` };
  return { ok: true, notaId: nota.id, ligacao: p.porCitacao ? "citacao" : "referencia" };
}

/** Texto que o DONO (não a Dolores) pode enviar ao empreiteiro no grupo. Sem CPF, sem dados bancários. */
export function textoSugeridoAoEmpreiteiro(n: { id: number; numero: string | null; valorCentavos: number | null; dataEmissao: string | null }): string {
  const qual = `${n.numero ? `nº ${n.numero}` : "sem número lido"}${n.valorCentavos ? `, de ${reais(n.valorCentavos)}` : ""}${n.dataEmissao ? `, de ${dataBr(n.dataEmissao)}` : ""}`;
  return `Olá! Recebemos a nota ${qual} (no sistema: NOTA ${n.id}). Para confirmar que ela está certa, responda à mensagem da nota com "CONFIRMO NOTA ${n.id}". `
    + `Se algo estiver errado, responda "CORRIGIR NOTA ${n.id}" e diga o quê.`;
}

/** Aviso fixo (tela e leitura): a confirmação é indício, não assinatura. */
export const AVISO_CONFIRMACAO = "A confirmação do empreiteiro é um INDÍCIO registrado (resposta no grupo, reconhecida pelo sistema): não é assinatura, não lança, não paga e não dispensa a sua aprovação.";

// ── Conciliação com o BPO (só aponta) ──

export type LancamentoParaConciliar = {
  id: number; valorCentavos: number; data: string | null; pago: boolean; doBanco: boolean;
  fornecedorDocumento: string | null; fornecedorNome: string | null; obraId: number | null;
  /** Outra nota já conciliada com este lançamento. */
  notaLigada: number | null;
  descricao: string | null;
};
export type NotaParaConciliar = {
  id: number; obraId: number | null; valorCentavos: number | null; dataEmissao: string | null;
  emitenteDocumento: string | null; emitenteNome: string | null; duplicadaDe: number | null; bpoLancamentoId: number | null;
  /** EPIC-029 S-5b: a NFS-e foi cancelada (evento do ADN) — nunca é apontada como válida. */
  cancelada?: boolean;
  /** EPIC-029 S-5b: a mesma nota já registrada pela outra origem (ADN × grupo) — a conciliação fica na outra. */
  outraOrigemDe?: number | null;
};
export type Apontamento =
  | { situacao: "conciliada"; lancamentoId: number }
  | { situacao: "duplicada"; texto: string }
  | { situacao: "cancelada"; texto: string }
  | { situacao: "outra_origem"; texto: string }
  | { situacao: "sem_dados"; texto: string }
  | { situacao: "ja_lancado"; lancamentoId: number; podeConciliar: boolean; texto: string }
  | { situacao: "provavel_duplicata"; lancamentoId: number; notaLigada: number; texto: string }
  | { situacao: "varios"; lancamentoIds: number[]; texto: string }
  | { situacao: "divergente"; lancamentoId: number; divergencias: string[]; texto: string }
  | { situacao: "sem_lancamento"; texto: string };

export const ROTULO_APONTAMENTO: Record<Apontamento["situacao"], string> = {
  conciliada: "conciliada (vínculo aprovado pelo dono)", duplicada: "nota duplicada (não concilia)",
  cancelada: "NFS-e cancelada (não concilia)", outra_origem: "mesma nota da outra origem (concilia na outra)", sem_dados: "sem valor ou data lidos",
  ja_lancado: "já lançado no BPO", provavel_duplicata: "provável duplicata (pagamento já ligado a outra nota)",
  varios: "mais de um pagamento possível", divergente: "divergente", sem_lancamento: "sem lançamento no BPO",
};

const diasEntre = (a: string, b: string) => Math.abs(new Date(`${a.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${b.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000;

function fornecedor(n: NotaParaConciliar, l: LancamentoParaConciliar): "confere" | "diverge" | "sem_dado" {
  if (n.emitenteDocumento && l.fornecedorDocumento) return n.emitenteDocumento === l.fornecedorDocumento ? "confere" : "diverge";
  const a = nomeComparavel(n.emitenteNome), b = nomeComparavel(l.fornecedorNome);
  if (a.length >= 4 && b.length >= 4) return a === b || a.includes(b) || b.includes(a) ? "confere" : "diverge";
  return "sem_dado";
}

/**
 * Compara a nota com os lançamentos de DESPESA do BPO na janela de datas: valor (ao centavo), fornecedor (CPF/CNPJ do
 * cadastro do BPO ou o nome do titular) e obra. Só APONTA — nenhum lançamento é criado, ligado ou alterado aqui.
 */
export function apontarConciliacao(n: NotaParaConciliar, lancamentos: readonly LancamentoParaConciliar[], janelaDias: number): Apontamento {
  // EPIC-029 S-5b: cancelada vem ANTES de tudo — mesmo já ligada a um pagamento, ela não é mais válida (o dono confere)
  if (n.cancelada) {
    return { situacao: "cancelada", texto: n.bpoLancamentoId
      ? `a NFS-e foi CANCELADA pelo emitente, mas está ligada ao lançamento #${n.bpoLancamentoId} do BPO: confira esse pagamento`
      : "a NFS-e foi CANCELADA pelo emitente: não pode ser paga nem conciliada" };
  }
  if (n.bpoLancamentoId) return { situacao: "conciliada", lancamentoId: n.bpoLancamentoId };
  if (n.duplicadaDe) return { situacao: "duplicada", texto: `esta nota repete a nota ${n.duplicadaDe}: não é conciliada` };
  if (n.outraOrigemDe) return { situacao: "outra_origem", texto: `é a mesma nota ${n.outraOrigemDe}, registrada pela outra origem (ADN ou grupo): a conciliação fica na nota ${n.outraOrigemDe}` };
  if (!n.valorCentavos || !n.dataEmissao) return { situacao: "sem_dados", texto: "sem valor ou data lidos com segurança: a conciliação depende da conferência do dono" };
  const naJanela = lancamentos.filter(l => l.data && diasEntre(l.data, n.dataEmissao!) <= janelaDias);
  const avaliados = naJanela.map(l => {
    const valorIgual = Math.abs(l.valorCentavos - n.valorCentavos!) <= 1;
    const forn = fornecedor(n, l);
    const obra = l.obraId === null || n.obraId === null ? "sem_dado" : l.obraId === n.obraId ? "confere" : "diverge";
    return { l, valorIgual, forn, obra };
  });
  const exatos = avaliados.filter(a => a.valorIgual && a.forn !== "diverge" && a.obra !== "diverge" && (a.forn === "confere" || a.obra === "confere"));
  if (exatos.length > 1) return { situacao: "varios", lancamentoIds: exatos.map(a => a.l.id).slice(0, 10), texto: `${exatos.length} pagamentos possíveis no BPO (mesmo valor): diga qual é` };
  if (exatos.length === 1) {
    const { l } = exatos[0];
    if (l.notaLigada) return { situacao: "provavel_duplicata", lancamentoId: l.id, notaLigada: l.notaLigada, texto: `o pagamento #${l.id} do BPO já está ligado à nota ${l.notaLigada}: provável nota duplicada` };
    const podeConciliar = l.pago && l.doBanco;
    return { situacao: "ja_lancado", lancamentoId: l.id, podeConciliar,
      texto: `pagamento encontrado no BPO: lançamento #${l.id} (${reais(l.valorCentavos)}, ${dataBr(l.data)})${podeConciliar ? "" : " — ainda não pago pelo banco (não concilia até vir do extrato)"}` };
  }
  const parciais = avaliados.filter(a => (a.valorIgual && (a.forn === "diverge" || a.obra === "diverge"))
    || (!a.valorIgual && a.forn === "confere" && a.obra !== "diverge" && Math.abs(a.l.valorCentavos - n.valorCentavos!) <= n.valorCentavos! * 0.3));
  if (parciais.length) {
    const a = parciais[0];
    const divergencias = [
      ...(!a.valorIgual ? [`valor: nota ${reais(n.valorCentavos)} × BPO ${reais(a.l.valorCentavos)}`] : []),
      ...(a.forn === "diverge" ? ["fornecedor diferente do emitente da nota"] : []),
      ...(a.obra === "diverge" ? ["lançamento ligado a outra obra"] : []),
    ];
    return { situacao: "divergente", lancamentoId: a.l.id, divergencias, texto: `lançamento #${a.l.id} do BPO parecido, mas divergente: ${divergencias.join("; ")}` };
  }
  return { situacao: "sem_lancamento", texto: `nenhum pagamento no BPO com esse valor perto de ${dataBr(n.dataEmissao)} (±${janelaDias} dias)` };
}

/** Pagamentos da obra no BPO (pagos) sem nenhuma nota ligada nem apontada: "pagamento sem nota". */
export function pagamentosSemNota(obraId: number, lancamentos: readonly LancamentoParaConciliar[], apontados: ReadonlySet<number>) {
  return lancamentos.filter(l => l.obraId === obraId && l.pago && !l.notaLigada && !apontados.has(l.id));
}

/** Nome do arquivo da nota no Drive: montado SÓ pelo sistema (número do sistema + data), nunca com texto da nota. */
export function nomeArquivoNota(notaId: number, dataEmissao: string | null, criadoEm: Date, extensao: string): string {
  const d = dataEmissao ?? new Date(criadoEm.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return `Nota ${notaId} — ${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}.${extensao}`;
}
