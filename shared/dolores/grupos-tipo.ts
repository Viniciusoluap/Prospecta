// EPIC-025 (Dolores, etapa 7) — grupos entram sozinhos, POR TIPO (regra do dono de 19/11/2026: "eu não quero ter que cadastrar
// grupo por grupo; todos os grupos que a Dolores participar é porque ela deve participar"). Regras puras, sem banco nem rede:
// - O tipo do grupo é descoberto POR CÓDIGO, pelo NOME do grupo (metadado do WhatsApp) — nunca pela IA, nunca pelo texto das
//   mensagens. Nome com Jurídico/Administrativo/Parceiros/Engenharia (palavra inteira, sem acento nem caixa) → grupo interno
//   daquele tipo; senão, nome igual ao de UM ÚNICO cliente do CRM (ou contendo o nome completo dele) → cliente, ou pós-atendimento
//   se o nome também tiver "pós"/"pós-atendimento"/"pós venda". Dois clientes, nenhum, nome curto → indefinido (o dono decide).
// - O comando do dono para corrigir ("grupo <código> <tipo> [nº]") é reconhecido por CÓDIGO: a mensagem inteira, regex estrita.
// - O aviso ao dono é montado pelo SISTEMA (nome do grupo e do cliente são texto de terceiro: limpos e entre aspas angulares).
import { limparNomeDeTerceiro } from "./operacao.js";
import { ehNumeroDoDono } from "./whatsapp.js";

export const TIPOS_GRUPO = ["cliente", "pos_atendimento", "juridico", "administrativo", "parceiros", "engenharia", "indefinido"] as const;
export type TipoGrupo = (typeof TIPOS_GRUPO)[number];
export const ORIGENS_GRUPO = ["manual", "automatico"] as const;
export type OrigemGrupo = (typeof ORIGENS_GRUPO)[number];
export const SITUACOES_CONFIRMACAO = ["confirmado", "avisado", "aguardando_dono", "recusado"] as const;
export type SituacaoConfirmacao = (typeof SITUACOES_CONFIRMACAO)[number];

export const ROTULO_TIPO_GRUPO: Record<TipoGrupo, string> = {
  cliente: "cliente", pos_atendimento: "pós-atendimento", juridico: "jurídico", administrativo: "administrativo (sócios)",
  parceiros: "parceiros comerciais", engenharia: "engenharia", indefinido: "não identificado",
};
export const ROTULO_SITUACAO_CONFIRMACAO: Record<SituacaoConfirmacao, string> = {
  confirmado: "confirmado", avisado: "avisado ao dono", aguardando_dono: "aguardando o dono", recusado: "recusado (não ficou provado que foi o dono)",
};
/** Rótulo do grupo que espera o dono dizer se foi ele quem colocou a Dolores (QA-SEG E7, achado 1b). */
export const ROTULO_AUTORIA_PENDENTE = "aguardando você: não sei quem me colocou";

/**
 * EPIC-027 C3 — a ÚNICA lista das categorias de grupo (tela, aviso/pergunta da Dolores ao dono e comando do WhatsApp usam esta):
 * número da opção, tipo, rótulo e uma linha do que a Dolores pode responder ali quando é marcada (o escopo de verdade é travado no
 * servidor, em server/dolores/marcacao.ts `escopoDoGrupo`). `vinculo`: o que o número depois da opção significa.
 */
export const CATEGORIAS_GRUPO = [
  { opcao: 1, tipo: "cliente", rotulo: ROTULO_TIPO_GRUPO.cliente, vinculo: "cliente",
    explica: "fala só daquele cliente: andamento, pendências e documentos que faltam (sem valores)" },
  { opcao: 2, tipo: "pos_atendimento", rotulo: ROTULO_TIPO_GRUPO.pos_atendimento, vinculo: "cliente",
    explica: "igual ao de cliente, depois da entrega: só aquele cliente (sem valores)" },
  { opcao: 3, tipo: "juridico", rotulo: ROTULO_TIPO_GRUPO.juridico, vinculo: null,
    explica: "processos, regularizações e documentos (sem valores)" },
  { opcao: 4, tipo: "administrativo", rotulo: ROTULO_TIPO_GRUPO.administrativo, vinculo: null,
    explica: "tudo da operação, menos dados de acesso (logins e chaves do sistema) e dados bancários" },
  { opcao: 5, tipo: "parceiros", rotulo: ROTULO_TIPO_GRUPO.parceiros, vinculo: null,
    explica: "só o andamento dos clientes indicados por quem perguntou (corretor ou correspondente)" },
  { opcao: 6, tipo: "engenharia", rotulo: ROTULO_TIPO_GRUPO.engenharia, vinculo: "obra",
    explica: "obras, medições e notas (sem valores); com o nº de uma obra, só aquela obra" },
] as const satisfies ReadonlyArray<{ opcao: number; tipo: Exclude<TipoGrupo, "indefinido">; rotulo: string; vinculo: "cliente" | "obra" | null; explica: string }>;
export type CategoriaGrupo = (typeof CATEGORIAS_GRUPO)[number];
export const categoriaDoTipo = (tipo: string) => CATEGORIAS_GRUPO.find(c => c.tipo === tipo) ?? null;

/** Quem colocou a Dolores no grupo: provado o dono, provado outra pessoa, ou não provado (QA-SEG E7). Vazio = cadastro à mão. */
export const ADICIONADO_POR = ["dono", "outra_pessoa", "desconhecido"] as const;
export type AdicionadoPor = (typeof ADICIONADO_POR)[number];

/** Como ficou provado, por código, quem colocou a Dolores no grupo (regra do dono de 19/11/2026). */
export const PROVAS_ADICAO = ["evento_add", "criador", "metadado", "sem_prova", "aceito_pelo_dono"] as const;
export type ProvaAdicao = (typeof PROVAS_ADICAO)[number];

/**
 * QA-SEG E7 (achados 1b e 6c) — o grupo espera o DONO dizer se foi ele quem colocou a Dolores: entrou pelo caminho de reserva
 * (dados do grupo na Evolution, sem o aviso de quem a adicionou) e ninguém aceitou ainda. Só observa (não fala, não chama a IA,
 * interruptor do grupo desligado) e só sai daqui pelo comando do dono no WhatsApp ("grupo <código> aceitar"/tipo) ou pela prova
 * positiva (aviso de "add" com o autor = número do dono). A mesma regra está no gatilho da 0133.
 */
export function autoriaPendente(g: { origem?: string | null; situacaoConfirmacao?: string | null; adicionadoPor?: string | null; provaAdicao?: string | null }): boolean {
  return g.origem === "automatico" && g.situacaoConfirmacao === "aguardando_dono" && g.adicionadoPor !== "dono" && g.provaAdicao !== "aceito_pelo_dono";
}
/**
 * Recusado, ou grupo automático "aguardando o dono" (seja porque não se sabe quem colocou a Dolores, seja porque o dono a colocou
 * mas o tipo ficou indefinido — QA-SEG E7 r2, R2-3): só o comando do dono no WhatsApp tira daqui (nunca a tela, nunca a fila).
 * A mesma regra está em `sqlSemAceitePendente` (server/dolores/grupos.ts) e no gatilho da 0133.
 */
export const precisaDoAceiteDoDono = (g: Parameters<typeof autoriaPendente>[0]) =>
  g.situacaoConfirmacao === "recusado" || (g.origem === "automatico" && g.situacaoConfirmacao === "aguardando_dono");
/** Recusado ou sem prova de quem colocou a Dolores (o que o "grupo <código> aceitar" resolve). */
export const semProvaDoDono = (g: Parameters<typeof autoriaPendente>[0]) => g.situacaoConfirmacao === "recusado" || autoriaPendente(g);

/**
 * EPIC-027 C4 — o interruptor "responder quando marcada" de um grupo SEM linha própria em dolores_marcacoes_grupo (ninguém mexeu
 * nele). Etapa 7 (AC9): nasce LIGADO para grupo aceito e de tipo conhecido. Desligado: desativado, recusado, aguardando o dono,
 * tipo indefinido e grupo manual antigo da etapa 4b (origem "manual" e tipo vazio: lá o interruptor do grupo nascia desligado).
 * O interruptor GERAL continua valendo por cima.
 */
export function ligadoPorPadrao(g: { ativo: boolean; origem?: string | null; tipo?: string | null; leadId: number | null; obraId: number | null; situacaoConfirmacao?: string | null; adicionadoPor?: string | null; provaAdicao?: string | null }): boolean {
  if (!g.ativo || precisaDoAceiteDoDono(g) || g.situacaoConfirmacao === "aguardando_dono") return false;
  if (g.origem !== "automatico" && !g.tipo) return false;
  return tipoEfetivo(g) !== "indefinido";
}

/**
 * EPIC-027 C3 — o tipo deste grupo pode ser definido/corrigido pela TELA (admin, ou colaborador com o módulo WhatsApp)? Sim para
 * grupo já ACEITO — inclusive o "não identificado · aguardando o dono" que o dono adicionou ou aceitou. NUNCA para grupo recusado
 * ou cuja entrada não foi provada e o dono ainda não aceitou: aceitar esses continua só do dono, pelo WhatsApp (regra de 19/11).
 */
export const telaPodeClassificar = (g: Parameters<typeof autoriaPendente>[0]) => !semProvaDoDono(g);

/** Padrões da entrada automática (os mesmos da migração 0133). */
export const PADRAO_ENTRADA = { entradaAutomaticaLigada: true, tetoGruposNovosDia: 20, tetoAvisosGruposDia: 25 } as const;
export const LIMITES_ENTRADA = { tetoGruposNovosDia: { min: 0, max: 200 }, tetoAvisosGruposDia: { min: 0, max: 200 } } as const;

/**
 * Tipo que vale para um grupo. Grupos cadastrados à mão antes da etapa 7 têm o tipo vazio (a migração não preenche em massa): com
 * cliente ligado valem como "cliente", com obra como "engenharia" e, sem vínculo, continuam como na etapa 4 — grupo de cliente
 * "sem card ainda" (o admin o cadastrou como grupo de cliente; o card vem pela fila). Grupo que entra sozinho sempre tem o tipo
 * gravado (o que não bate com nada nasce "indefinido").
 */
export function tipoEfetivo(g: { tipo?: string | null; leadId: number | null; obraId: number | null }): TipoGrupo {
  if (g.tipo && (TIPOS_GRUPO as readonly string[]).includes(g.tipo)) return g.tipo as TipoGrupo;
  if (g.tipo) return "indefinido"; // valor desconhecido: falha fechada (só observa)
  return g.obraId ? "engenharia" : "cliente";
}

// ── 1) Normalização do nome ──

/** Sem acento, minúsculo, só letras/dígitos separados por um espaço. */
export function normalizarNome(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const palavras = (n: string) => (n ? n.split(" ") : []);
const letras = (n: string) => n.replace(/[^a-z]/g, "").length;

/** Nome de cliente bom o bastante para ligar sozinho: pelo menos 2 palavras e 6 letras. */
export const MIN_PALAVRAS_NOME = 2;
export const MIN_LETRAS_NOME = 6;
export const nomeLigavel = (normalizado: string) => palavras(normalizado).length >= MIN_PALAVRAS_NOME && letras(normalizado) >= MIN_LETRAS_NOME;

/** Palavras dos tipos internos (palavra inteira, já normalizada). */
const INTERNOS: Array<[Exclude<TipoGrupo, "cliente" | "pos_atendimento" | "indefinido">, readonly string[]]> = [
  ["juridico", ["juridico"]],
  ["administrativo", ["administrativo"]],
  ["parceiros", ["parceiros", "parceiro"]],
  ["engenharia", ["engenharia"]],
];
/** "pós", "pós-atendimento", "pós venda", "pós-venda", "posvenda" (já normalizados). */
const POS = new Set(["pos", "posvenda", "posatendimento"]);
/** Palavras que só indicam pós-atendimento (saem antes de comparar com o nome do cliente). */
const PALAVRAS_POS = new Set(["pos", "posvenda", "posatendimento", "venda", "vendas", "atendimento"]);

export type ClienteParaTipo = { id: number; nome: string | null };
export type TipoDescoberto = { tipo: TipoGrupo; leadId: number | null; motivo: string };

/**
 * Descobre o tipo do grupo pelo NOME do WhatsApp. Puro e determinístico. `clientes` = clientes ATIVOS do CRM (id e nome).
 * Homônimos, mais de um cliente casando, nome curto ou nada casando → "indefinido" (nunca liga sozinho na dúvida).
 */
export function descobrirTipoDoGrupo(nomeDoGrupo: string | null | undefined, clientes: readonly ClienteParaTipo[]): TipoDescoberto {
  const n = normalizarNome(nomeDoGrupo);
  if (!n) return { tipo: "indefinido", leadId: null, motivo: "grupo sem nome" };
  const ps = palavras(n);
  const internos = INTERNOS.filter(([, chaves]) => chaves.some(c => ps.includes(c))).map(([t]) => t);
  if (internos.length > 1) return { tipo: "indefinido", leadId: null, motivo: "nome com mais de um tipo interno" };
  if (internos.length === 1) return { tipo: internos[0], leadId: null, motivo: "nome com a palavra do tipo interno" };
  const pos = ps.some(p => POS.has(p)) || /\bpos (venda|vendas|atendimento)\b/.test(n);
  // o nome sem as palavras de pós-atendimento é o que precisa bater com o cliente
  const nucleo = ps.filter(p => !(pos && PALAVRAS_POS.has(p))).join(" ");
  if (!nomeLigavel(nucleo)) return { tipo: "indefinido", leadId: null, motivo: "nome do grupo curto demais para ligar a um cliente" };
  const comEspaco = ` ${nucleo} `;
  const casados = new Set<number>();
  for (const c of clientes) {
    const nc = normalizarNome(c.nome);
    if (!nc || !nomeLigavel(nc)) continue;
    if (nucleo === nc || comEspaco.includes(` ${nc} `)) casados.add(c.id);
  }
  if (casados.size > 1) return { tipo: "indefinido", leadId: null, motivo: "o nome bate com mais de um cliente do CRM" };
  if (casados.size === 0) return { tipo: "indefinido", leadId: null, motivo: "o nome não bate com nenhum cliente do CRM nem com um tipo interno" };
  const [leadId] = Array.from(casados);
  return { tipo: pos ? "pos_atendimento" : "cliente", leadId, motivo: pos ? "nome de um único cliente, com pós-atendimento" : "nome de um único cliente do CRM" };
}

// ── 2) Código curto do grupo (gerado pelo servidor) ──

/** Sem letras/dígitos que se confundem (0/O, 1/I/L, 5/S, 8/B). */
export const ALFABETO_CODIGO_GRUPO = "ACDEFGHJKMNPRTUVWXY234679";
export const TAMANHO_CODIGO_GRUPO = 4;
const CODIGO_GRUPO = new RegExp(`^[${ALFABETO_CODIGO_GRUPO}]{${TAMANHO_CODIGO_GRUPO}}$`);
export const codigoDeGrupoValido = (c: unknown): c is string => typeof c === "string" && CODIGO_GRUPO.test(c);
/** `aleatorio` devolve números em [0, 1) (crypto no servidor). */
export function gerarCodigoDeGrupo(aleatorio: () => number): string {
  let c = "";
  for (let i = 0; i < TAMANHO_CODIGO_GRUPO; i++) c += ALFABETO_CODIGO_GRUPO[Math.floor(aleatorio() * ALFABETO_CODIGO_GRUPO.length) % ALFABETO_CODIGO_GRUPO.length];
  return c;
}

// ── 3) O comando do dono ──

export type DecisaoDeGrupo = { codigo: string; tipo: Exclude<TipoGrupo, "indefinido">; numero: number | null } | { codigo: string; tipo: "ignorar" | "aceitar"; numero: null };

/** Opção numerada (1 a 6, da lista CATEGORIAS_GRUPO) → tipo. */
const TIPO_DA_OPCAO: Record<string, Exclude<TipoGrupo, "indefinido">> = Object.fromEntries(CATEGORIAS_GRUPO.map(c => [String(c.opcao), c.tipo]));

const TIPO_DO_COMANDO: Record<string, Exclude<TipoGrupo, "indefinido"> | "ignorar" | "aceitar"> = {
  aceitar: "aceitar",
  cliente: "cliente", pos: "pos_atendimento", "pos atendimento": "pos_atendimento", "pos venda": "pos_atendimento", posvenda: "pos_atendimento",
  juridico: "juridico", administrativo: "administrativo", parceiros: "parceiros", parceiro: "parceiros", engenharia: "engenharia", ignorar: "ignorar",
};
// a mensagem INTEIRA (já normalizada: sem acento, minúscula, pontuação virou espaço): "grupo <código> <tipo> [nº]"
const COMANDO = /^grupo ([a-z0-9]{4}) (cliente|pos atendimento|pos venda|posvenda|pos|juridico|administrativo|parceiros|parceiro|engenharia|ignorar|aceitar|[1-6])(?: (?:n|no|numero)? ?(\d{1,9}))?$/;

/**
 * "grupo K7QM cliente 456", "grupo K7QM pós 456", "grupo K7QM jurídico", "grupo K7QM engenharia 12" (obra nº 12, opcional),
 * "grupo K7QM ignorar". Só a mensagem inteira; cliente e pós exigem o nº do cliente; jurídico, administrativo, parceiros e
 * ignorar não aceitam número. Qualquer outra coisa → null (a mensagem segue o caminho normal).
 */
export function lerDecisaoDeGrupo(texto: string | null | undefined): DecisaoDeGrupo | null {
  const bruto = String(texto ?? "");
  if (bruto.length > 80 || /[\r\n]/.test(bruto)) return null;
  const n = normalizarNome(bruto.replace(/[º°]/g, " "));
  const m = COMANDO.exec(n);
  if (!m) return null;
  // código fora do alfabeto ainda é o comando (o dono errou o código): a resposta é "não achei", nunca a IA
  const codigo = m[1].toUpperCase();
  const tipo = TIPO_DO_COMANDO[m[2]] ?? TIPO_DA_OPCAO[m[2]];
  const numero = m[3] ? Number(m[3]) : null;
  if (numero !== null && (!Number.isSafeInteger(numero) || numero <= 0 || numero > 2_147_483_647)) return null;
  if (tipo === "cliente" || tipo === "pos_atendimento") return numero ? { codigo, tipo, numero } : null;
  if (tipo === "engenharia") return { codigo, tipo, numero };
  if (numero !== null) return null;
  return { codigo, tipo, numero: null };
}

/**
 * EPIC-027 C3 — a resposta do dono SÓ com o número da opção ("3", "1 456", "6 12"), sem o código do grupo: vale para o ÚNICO grupo
 * que espera o tipo (quem resolve é o servidor). A mensagem inteira; cliente e pós exigem o nº do cliente; 3, 4 e 5 não aceitam
 * número. Qualquer outra coisa → null (a mensagem segue o caminho normal).
 */
export type RespostaNumerada = { tipo: Exclude<TipoGrupo, "indefinido">; numero: number | null } | { tipo: Exclude<TipoGrupo, "indefinido">; numero: null; faltaNumero: true };
const SO_OPCAO = /^([1-6])(?: (?:n|no|numero)? ?(\d{1,9}))?$/;
export function lerRespostaNumerada(texto: string | null | undefined): RespostaNumerada | null {
  const bruto = String(texto ?? "");
  if (bruto.length > 30 || /[\r\n]/.test(bruto)) return null;
  const m = SO_OPCAO.exec(normalizarNome(bruto.replace(/[º°]/g, " ")));
  if (!m) return null;
  const tipo = TIPO_DA_OPCAO[m[1]];
  const numero = m[2] ? Number(m[2]) : null;
  if (numero !== null && (!Number.isSafeInteger(numero) || numero <= 0 || numero > 2_147_483_647)) return null;
  const c = categoriaDoTipo(tipo)!;
  if (c.vinculo === "cliente") return numero ? { tipo, numero } : { tipo, numero: null, faltaNumero: true };
  if (c.vinculo === "obra") return { tipo, numero };
  return numero === null ? { tipo, numero: null } : null;
}

/** As opções numeradas, uma por linha, com a explicação (o texto do sistema; nada de terceiro). */
export function textoDasOpcoes(codigo: string, o: { soComNumero?: boolean } = {}): string {
  const linhas = CATEGORIAS_GRUPO.map(c => `${c.opcao}. ${c.rotulo} — ${c.explica}${c.vinculo === "cliente" ? ` (responda «${c.opcao} <nº do cliente no CRM>»)` : c.vinculo === "obra" ? ` (nº da obra opcional: «${c.opcao} <nº da obra>»)` : ""}`);
  const como = o.soComNumero
    ? `Responda só com o número da opção. Se houver mais de um grupo esperando, use «grupo ${codigo} <número>».`
    : `Responda «grupo ${codigo} <número da opção>».`;
  return `${linhas.join("\n")}\n${como} Para eu não participar: «grupo ${codigo} ignorar».`;
}

// ── 4) O aviso ao dono (texto do SISTEMA) ──

const entreAspas = (s: string | null | undefined, padrao: string) => {
  const t = limparNomeDeTerceiro(s);
  return t ? `«${t}»` : padrao;
};
/** Aviso de grupo novo. Tipo conhecido: "Entendi: …; se estiver errado, responda …". Indefinido: pergunta e fica em silêncio. */
export function textoDoAvisoDeEntrada(p: { nomeDoGrupo: string | null; codigo: string; tipo: TipoGrupo; cliente?: { id: number; nome: string | null } | null }): string {
  const grupo = entreAspas(p.nomeDoGrupo, "(sem nome)");
  if (p.tipo === "indefinido") {
    return `Dolores: entrei no grupo ${grupo} (código ${p.codigo}) e não consegui saber de que tipo ele é. Enquanto você não responder, só observo — não falo nada lá, nem se me marcarem. De que tipo ele é?\n${textoDasOpcoes(p.codigo, { soComNumero: true })}`;
  }
  const entendi = (p.tipo === "cliente" || p.tipo === "pos_atendimento") && p.cliente
    ? `${ROTULO_TIPO_GRUPO[p.tipo]} ${entreAspas(p.cliente.nome, "(sem nome)")} (nº ${p.cliente.id})`
    : `grupo ${ROTULO_TIPO_GRUPO[p.tipo]}`;
  return `Dolores: entrei no grupo ${grupo} (código ${p.codigo}). Entendi: ${entendi}. Se estiver errado, escolha o tipo certo:\n${textoDasOpcoes(p.codigo)}`;
}

/** A pergunta do tipo para um grupo já aceito que ficou sem tipo (depois do "aceitar" e na tela). */
export const perguntaDoTipo = (nomeDoGrupo: string | null, codigo: string) =>
  `De que tipo é o grupo ${entreAspas(nomeDoGrupo, "(sem nome)")} (código ${codigo})?\n${textoDasOpcoes(codigo, { soComNumero: true })}`;

/** Aviso único do dia quando o teto de grupos novos foi atingido. */
export const avisoDoTetoDeEntrada = (teto: number) =>
  `Dolores: hoje já entrei em ${teto} grupos novos (o teto do dia). Os próximos grupos novos de hoje ficam de fora — não leio nem falo neles — até amanhã, ou até você aumentar o teto em Dolores › Grupos.`;

/** Aviso único do grupo RECUSADO (outra pessoa colocou a Dolores, ou o aviso de quem a colocou não provou que foi o dono). */
export function textoDoAvisoDeRecusa(p: { nomeDoGrupo: string | null; codigo: string; provado?: boolean }): string {
  const grupo = entreAspas(p.nomeDoGrupo, "(sem nome)");
  const como = p.provado === false ? `fui colocada no grupo ${grupo} e não consegui confirmar que foi você` : `fui colocada no grupo ${grupo} por outra pessoa`;
  return `Dolores: ${como}; ignorei (não leio nem falo nada lá). Se quiser que eu participe, me adicione você mesmo ou responda: grupo ${p.codigo} aceitar`;
}

/** QA-SEG E7 (achado 1b) — o grupo entrou pelo caminho de reserva: só observa até o dono dizer que foi ele. */
export function textoDoAvisoDeAutoriaDesconhecida(p: { nomeDoGrupo: string | null; codigo: string }): string {
  return `Dolores: estou no grupo ${entreAspas(p.nomeDoGrupo, "(sem nome)")} e não sei quem me colocou. Se foi você, responda: grupo ${p.codigo} aceitar. Até lá só observo — não falo nada lá, nem se me marcarem.`;
}

/** Máximo de avisos individuais por dia de grupos recusados/sem prova; depois, um resumo único no dia (QA-SEG E7, achado 4). */
export const MAX_AVISOS_SEM_PROVA_DIA = 5;
export const textoDoResumoDeSemProva = (n: number) =>
  `Dolores: hoje já avisei de ${n} grupos em que não ficou provado que foi você quem me colocou. Os próximos de hoje não vou avisar um a um: eles aparecem em Dolores › Grupos, com o código de cada um ("grupo <código> aceitar").`;
export const avisoDoTetoSemProva = (teto: number) =>
  `Dolores: hoje já chegaram ${teto} grupos em que não ficou provado que foi você quem me colocou (o teto do dia). Os próximos desse tipo ficam de fora até amanhã; os grupos em que VOCÊ me adicionar continuam entrando normalmente.`;

/** QA-SEG E7 (achado 6d) — alguém entrou num grupo ADMINISTRATIVO (sócios) já aceito. Sem número nem nome de quem entrou. */
export const textoDoAvisoDeEntradaNoAdministrativo = (p: { nomeDoGrupo: string | null; quantos: number; codigo: string | null }) =>
  `Dolores: ${p.quantos === 1 ? "uma pessoa foi adicionada" : `${p.quantos} pessoas foram adicionadas`} ao grupo administrativo ${entreAspas(p.nomeDoGrupo, "(sem nome)")}. Lá eu respondo sobre tudo da operação (menos senhas e dados bancários). Se não foi você quem autorizou, confira o grupo${p.codigo ? ` ou responda: grupo ${p.codigo} ignorar` : ""}.`;

/**
 * QA-SEG E7 r2 (R2-2) — alguém que não é o dono recolocou a Dolores num grupo que o DONO já decidiu (adicionou ou aceitou): o
 * grupo continua como ele decidiu (não é rebaixado) e ele é avisado. `quem`: nome de terceiro (limpo, entre «») ou, sem nome, o
 * final do número (nunca o número completo).
 */
export function textoDoAvisoDeRecolocada(p: { quem: string | null; finalDoNumero: string | null; nomeDoGrupo: string | null; codigo: string | null }): string {
  const quem = limparNomeDeTerceiro(p.quem) ? entreAspas(p.quem, "") : p.finalDoNumero ? `Alguém (número com final ${p.finalDoNumero})` : "Alguém que não é você";
  return `Dolores: ${quem} me recolocou no grupo ${entreAspas(p.nomeDoGrupo, "(sem nome)")}. O grupo continua como você decidiu.${p.codigo ? ` Se não quiser mais que eu participe, responda: grupo ${p.codigo} ignorar` : ""}`;
}

/**
 * QA-SEG E7 (achado 2) — o campo de criação do aviso `groups.upsert` (segundos ou milissegundos) mostra um grupo criado AGORA
 * (no máximo `JANELA_CRIACAO_MS` atrás; relógio adiantado até 1 min)? Sem o campo, ou antigo → false (o criador não prova nada).
 */
export const JANELA_CRIACAO_MS = 5 * 60_000;
export function criacaoRecente(v: unknown, agora: Date): boolean {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{9,14}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return false;
  const ms = n > 1e12 ? n : n * 1000;
  const d = agora.getTime() - ms;
  return d >= -60_000 && d <= JANELA_CRIACAO_MS;
}

// ── 5) Quem colocou a Dolores no grupo (regra do dono de 19/11/2026: "somente o número principal […] pode adicionar") ──

const JID_NUMERO = /^(\d{10,15})(?::\d+)?@s\.whatsapp\.net$/;
const JID_LID = /^\d{5,25}@lid$/;
/** Número de um JID de telefone ("5599…@s.whatsapp.net"); @lid, grupo ou qualquer outra coisa → null. */
export const numeroDoJid = (v: unknown): string | null => (typeof v === "string" ? JID_NUMERO.exec(v.trim())?.[1] ?? null : null);
export const lidDoJid = (v: unknown): string | null => (typeof v === "string" && JID_LID.test(v.trim()) ? v.trim() : null);

/** Participante como vem da Evolution: texto (JID) ou objeto ({ id, jid, lid, phoneNumber, pn, admin }). */
export type ParticipanteBruto = unknown;
export type Participante = { numero: string | null; lid: string | null; admin: boolean };
export function lerParticipante(p: ParticipanteBruto): Participante {
  if (typeof p === "string") return { numero: numeroDoJid(p), lid: lidDoJid(p), admin: false };
  const x = (p ?? {}) as Record<string, unknown>;
  const campos = [x.id, x.jid, x.lid, x.phoneNumber, x.pn].filter((v): v is string => typeof v === "string");
  return {
    numero: campos.map(numeroDoJid).find(Boolean) ?? null,
    lid: campos.map(lidDoJid).find(Boolean) ?? null,
    admin: x.admin === "admin" || x.admin === "superadmin" || x.isAdmin === true || x.isSuperAdmin === true,
  };
}

/** O participante é a Dolores? Número estrito (o da conexão confirmada) ou o @lid conferido para esse número. */
export const ehADolores = (p: Participante, id: { numero: string | null; lid: string | null }) =>
  (!!p.numero && !!id.numero && ehNumeroDoDono(p.numero, id.numero)) || (!!p.lid && !!id.lid && p.lid === id.lid);

/**
 * O autor (quem executou a ação, campo do aviso da Evolution) é o DONO? Número: a mesma comparação estrita do dono. @lid: só se
 * `lidParaNumero` (participantes do grupo pela Evolution) resolver para o número do dono. Sem autor, ou sem provar → false.
 */
export function autorEhODono(autor: unknown, numeroDono: string | null, lidParaNumero: ReadonlyMap<string, string> = new Map()): boolean {
  if (!numeroDono) return false;
  const n = numeroDoJid(autor);
  if (n) return ehNumeroDoDono(n, numeroDono);
  const l = lidDoJid(autor);
  const resolvido = l ? lidParaNumero.get(l) : undefined;
  return !!resolvido && ehNumeroDoDono(resolvido, numeroDono);
}

export type MetadadoDoGrupo = { nome: string | null; criador: string[]; participantes: Participante[] };

/**
 * Sem o aviso de quem adicionou (evento perdido, grupo antigo, primeira mensagem, "Atualizar grupos"): o número do dono é
 * PARTICIPANTE do grupo E o criou ou é admin? QA-SEG E7 (achado 1b): isto NÃO prova quem colocou a Dolores — no máximo deixa o
 * grupo "aguardando o dono" (só observa) com a pergunta "não sei quem me colocou". Na dúvida, não.
 */
export function donoNoMetadado(m: MetadadoDoGrupo | null, numeroDono: string | null): boolean {
  if (!m || !numeroDono) return false;
  const dono = m.participantes.filter(p => p.numero && ehNumeroDoDono(p.numero, numeroDono));
  if (!dono.length) return false;
  const lidParaNumero = new Map(m.participantes.filter(p => p.lid && p.numero).map(p => [p.lid!, p.numero!]));
  const criou = m.criador.some(c => autorEhODono(c, numeroDono, lidParaNumero));
  return criou || dono.some(p => p.admin);
}
