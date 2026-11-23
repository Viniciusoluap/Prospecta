// EPIC-029 S-3 (22/11/2026) — a Dolores no fluxo fiscal, regras PURAS (sem banco nem rede).
// Decisão do dono (22/11): "Eu não quero ter que decorar comandos pra Dolores, eu quero conversar com ela". Por isso NADA aqui é
// palavra-comando: VER / EMITIR / NÃO / DEPOIS não são reconhecidos como ordem. O código só decide QUANDO as ferramentas fiscais são
// OFERECIDAS ao modelo (a mensagem do dono fala de nota/fiscal, ou a conversa recente citou um rascunho de nota) — como as mesas fazem.
// Quem escolhe ler, propor "sem nota", adiar, editar ou emitir é o modelo; quem decide o nível ("pode" × "confirmo") e o que é
// gravado é o código (shared/dolores/confirmacao.ts#nivelDoItem e server/dolores/acoes/fiscal.ts).

/** As duas leituras fiscais (só na conversa direta do dono: server/dolores/funcoes.ts#LEITURAS_DO_DONO). */
export const LEITURAS_FISCAIS = ["listar_notas_fiscais", "ver_nota_fiscal"] as const;
/** As ações fiscais (de FILA: nada grava sem a resposta do dono no WhatsApp). S-7: + cancelar_nota_fiscal (sério). */
export const ACOES_FISCAIS = ["decidir_nota_fiscal", "editar_rascunho_nota", "emitir_nota_fiscal", "cancelar_nota_fiscal"] as const;
/** Todas as ferramentas fiscais: só oferecidas ao modelo quando o assunto é nota fiscal (`abreFiscal`, por código). */
export const FERRAMENTAS_FISCAIS: ReadonlySet<string> = new Set<string>([...LEITURAS_FISCAIS, ...ACOES_FISCAIS]);

const normalizar = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Assunto fiscal no trecho do DONO (por código, linear, sem IA): "nota", "notas", "NFS-e", "fiscal", "rascunho", "prévia", "emitir",
 * "tomador", "sem nota". Não é comando: só abre as ferramentas fiscais para o modelo decidir. Falso positivo ("nota de obra") só custa
 * algumas ferramentas a mais na chamada; nada é feito sem a confirmação do dono.
 */
const ASSUNTO_FISCAL = /\b(?:notas?|nfs\s?-?\s?e|nfse|nf|fiscal|fiscais|rascunhos?|previas?|emit\w*|emissao|tomador\w*)\b/;
export function intencaoFiscal(trechoDoDono: string | null | undefined): boolean {
  return ASSUNTO_FISCAL.test(normalizar(trechoDoDono).slice(0, 400));
}

/** "R$ 1.200,00" (centavos inteiros). */
export const reaisDeCentavos = (c: number) => (Math.round(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

/** Valor em reais dito pelo dono (número do modelo) → centavos inteiros; null se não for um valor de dinheiro válido (> 0, 2 casas). */
export function centavosDoValor(reais: number): number | null {
  if (!Number.isFinite(reais) || reais <= 0 || reais > 1_000_000_000) return null;
  const c = Math.round(reais * 100);
  return Math.abs(c - reais * 100) < 0.001 ? c : null;
}

/** A pergunta natural do fim do aviso de rascunho (sem lista de comandos). */
export const perguntaDoAvisoFiscal = (quantidade: number) => quantidade === 1
  ? "Quer que eu te mostre a prévia ou já sabe o que fazer com ela?"
  : "Quer que eu te mostre a prévia de alguma delas ou já sabe o que fazer com elas?";

/**
 * Palavras-comando que o aviso fiscal NUNCA traz (decisão do dono: sem comandos para decorar). Vale para o texto fixo e para o texto
 * escrito pela IA dos avisos (server/dolores/avisos.ts recusa o texto da IA que as tiver e usa o fixo).
 */
const COMANDO_EM_MAIUSCULAS = /(?:^|[^A-Za-zÀ-ú])(?:VER|EMITIR|EMITA|N[ÃA]O|DEPOIS|ADIAR|SIM|CONFIRMO)(?![A-Za-zÀ-ú])/;
// QA S-3 (B1): também "diga/me diga/dizer/fale/mande/manda" (ensinar a resposta) e qualquer palavra de comando ENTRE ASPAS, em qualquer caixa
const PEDIDO_DE_RESPOSTA = /\b(?:responda|respondendo|responder|digite|digitar|escreva|escrever|diga|dizer|me\s+diz|fale|falar|mande|manda|mandar)\b/i;
const COMANDO_ENTRE_ASPAS = /["“'‘«]\s*(?:ver|veja|emit\w*|depois|adi[ae]\w*|sim|n[ãa]o|confirm\w*|pode|sem\s+nota|deixa\w*)\b[^"”'’»]{0,20}["”'’»]/i;
/** A frase FIXA de silenciar (shared/dolores/avisos.ts#FRASE_SILENCIAR) tem "me diga" com um exemplo natural: não é ensinar comando. */
const FRASE_DE_SILENCIAR = /Se não quiser mais um desses avisos, me diga \(ex\.: "pare de me avisar de [^"\n]{1,80}"\)\./g;
export const temPalavraComando = (texto: string) => {
  const t = texto.replace(FRASE_DE_SILENCIAR, " ");
  return COMANDO_EM_MAIUSCULAS.test(t) || PEDIDO_DE_RESPOSTA.test(t) || COMANDO_ENTRE_ASPAS.test(t);
};

/** Hora (Brasília) a partir da qual o aviso de rascunho vira o RESUMO do dia (a rota dos avisos das 18h já existe; sem cron novo). */
export const HORA_RESUMO_FISCAL = 18;

/** Frase da execução de "emitir" enquanto a emissão não existe (S-4/S-5). Nada sai do sistema. */
export const FRASE_EMISSAO_INATIVA = "a emissão de nota fiscal ainda não está ativa (só depois da homologação com o contador); nada foi emitido e o rascunho continua como estava";
