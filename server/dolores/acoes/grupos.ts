// EPIC-025 (Dolores, etapa 4) — ações da documentação dos grupos de clientes. As DUAS são de FILA: o conteúdo do grupo é de
// terceiro e a tabela "Quem aprova o quê" (seção 5) diz "Criar card e salvar documentos de cliente — Eu, pelo comando que dou".
// Aqui só se CONFERE e se monta o resumo com o texto exato (nada é gravado); a execução aprovada está em
// server/dolores/documentos-cliente.ts (revalida tudo na hora, numa transação de escrita mínima).
//
// | função                   | nível | por quê                                                                             |
// | criar_card_cliente       | fila  | cria registro no CRM a partir do grupo (dado de terceiro); confere antes se já existe |
// | salvar_documentos_grupo  | fila  | grava arquivo no card e no Drive; classificação da IA pode errar ("confira")         |
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { leads } from "../../../drizzle/schema.js";
import { doloresGrupoMensagens, doloresGrupos, doloresGruposConfig } from "../../../drizzle/schema-dolores-grupos.js";
import { textoDeDado, umaLinha } from "../../../shared/dolores/fila.js";
import {
  ROTULO_SITUACAO_GRUPO, ROTULO_TIPO_DOCUMENTO, TIPOS_DOCUMENTO_GRUPO, diaHoraCurta, nomeComparavel, pendenteVencido, type TipoDocumentoGrupo,
} from "../../../shared/dolores/grupos.js";
import { chaveTelefone } from "../../../shared/whatsapp/conversas.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, comoMostrado, resumoDaFila, textoAlteradoNaSaida, textoDoDono, type ContextoAcao, type ItemParaFila, type Preparo } from "./comum.js";

const id32 = z.number().int().positive().max(2_147_483_647);

export const entradaCriarCardCliente = z.object({
  grupoId: id32.describe("Id do grupo cadastrado (listar_grupos)."),
  nome: z.string().trim().min(2).max(120).describe("Nome do cliente, com as palavras do DONO (nunca um nome tirado de mensagem do grupo sem o dono confirmar)."),
  telefone: z.string().trim().max(30).optional().describe("Telefone do cliente, se o dono disse (DDD + número)."),
  leadId: id32.optional().describe("Só se o dono indicar um cliente que JÁ existe no CRM: o grupo é ligado a ele (não cria outro)."),
}).strict();

export const entradaCardAprovado = z.object({
  grupoId: id32,
  modo: z.enum(["criar", "vincular"]),
  nome: z.string().max(200),
  telefone: z.string().max(20),
  leadId: id32.nullable(),
}).strict();

export const entradaSalvarDocumentosGrupo = z.object({
  grupoId: id32.describe("Id do grupo cadastrado (listar_grupos), já ligado ao card do cliente."),
  mensagemIds: z.array(id32).min(1).max(10).optional().describe("Só estes documentos (mensagemId de ler_grupo_cliente); sem a lista, todos os classificados que ainda não estão no card (até 10)."),
}).strict();

export const entradaSalvarAprovado = z.object({
  grupoId: id32, mensagemId: id32, leadId: id32,
  tipo: z.enum(TIPOS_DOCUMENTO_GRUPO),
  nomeArquivo: z.string().max(200),
}).strict();

/** Texto do cadastro mostrado ao dono: na forma mostrada; se a saída o alteraria (link, segredo), só a referência. */
function mostrar(s: string | null | undefined, max: number, seNao: string): string {
  const t = comoMostrado(textoDeDado(s, max));
  return t && !textoAlteradoNaSaida(t) ? t : seNao;
}

type GrupoLido = { id: number; nome: string; ativo: boolean; leadId: number | null; obraId: number | null };
async function lerGrupo(grupoId: number): Promise<GrupoLido> {
  const [g] = await bancoDaLeitura().select({ id: doloresGrupos.id, nome: doloresGrupos.nome, ativo: doloresGrupos.ativo, leadId: doloresGrupos.leadId, obraId: doloresGrupos.obraId })
    .from(doloresGrupos).where(eq(doloresGrupos.id, grupoId)).limit(1);
  if (!g) throw new RecusaAcao(`Grupo ${grupoId} não está cadastrado. O administrador cadastra os grupos em Integrações › Dolores › Grupos.`);
  if (!g.ativo) throw new RecusaAcao(`O grupo ${grupoId} está desativado; nada foi feito.`);
  return g;
}

/** Telefone do dono para o card: só dígitos, 10 a 13 (com ou sem 55). Inválido → recusa. */
export function telefoneDoCard(bruto: string | undefined): string {
  if (!bruto) return "";
  const d = bruto.replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) throw new RecusaAcao("Telefone inválido: use DDD + número (ex.: 99 99123-4567). Nada foi posto na fila.");
  return d;
}

/**
 * Clientes do CRM (não excluídos) com o mesmo telefone (DDD + 8 finais) ou o mesmo nome (sem acento, minúsculas). Lê pela
 * conexão do momento (leitura ou a transação de escrita da aprovação).
 */
export async function clientesParecidos(conexao: ReturnType<typeof bancoDaLeitura>, nome: string, telefone: string) {
  const chave = telefone ? chaveTelefone(telefone) : "";
  const primeiro = nomeComparavel(nome).split(" ")[0] ?? "";
  const candidatos = await conexao.select({ id: leads.id, name: leads.name, phone: leads.phone }).from(leads)
    .where(and(isNull(leads.deletedAt), sql`(${chave.length === 10 ? sql`right(regexp_replace(${leads.phone}, '[^0-9]', '', 'g'), 8) = ${chave.slice(-8)}` : sql`false`}
      OR translate(lower(${leads.name}), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') LIKE ${`%${primeiro.slice(0, 40)}%`})`))
    .orderBy(asc(leads.id)).limit(300);
  const alvoNome = nomeComparavel(nome);
  return candidatos.filter(c => (chave.length === 10 && chaveTelefone(c.phone) === chave) || nomeComparavel(c.name) === alvoNome);
}

export async function prepararCardCliente(args: z.infer<typeof entradaCriarCardCliente>, _ctx: ContextoAcao): Promise<Preparo> {
  const nome = comoMostrado(textoDoDono(umaLinha(args.nome, 120)));
  if (nome.length < 2) throw new RecusaAcao("Nome do cliente vazio depois de limpar caracteres inválidos. Nada foi posto na fila.");
  const telefone = telefoneDoCard(args.telefone);
  if (telefone) textoDoDono(telefone);
  return emTransacaoSomenteLeitura(async () => {
    const g = await lerGrupo(args.grupoId);
    if (g.obraId) throw new RecusaAcao(`O grupo ${g.id} é de obra (obra ${g.obraId}), não de cliente: o card do cliente não se aplica.`);
    if (g.leadId) throw new RecusaAcao(`O grupo ${g.id} já está ligado ao card do cliente #${g.leadId}; nada a fazer. Para salvar a documentação, use salvar_documentos_grupo.`);
    const grupo = mostrar(g.nome, 80, `grupo ${g.id}`);
    let alvoLead: { id: number; name: string } | null = null;
    if (args.leadId) {
      const [l] = await bancoDaLeitura().select({ id: leads.id, name: leads.name }).from(leads).where(and(eq(leads.id, args.leadId), isNull(leads.deletedAt))).limit(1);
      if (!l) throw new RecusaAcao(`Cliente ${args.leadId} não encontrado no CRM (ou excluído).`);
      alvoLead = l;
    } else {
      const parecidos = await clientesParecidos(bancoDaLeitura(), nome, telefone);
      if (parecidos.length > 1) {
        throw new RecusaAcao(`Há mais de um cliente parecido no CRM (${parecidos.slice(0, 5).map(p => `#${p.id} "${textoDeDado(p.name, 40)}"`).join(", ")}). Diga qual é (o número) e eu ligo o grupo a ele; nada foi posto na fila.`, { comDados: true });
      }
      alvoLead = parecidos[0] ?? null;
    }
    const item: ItemParaFila = alvoLead
      ? {
        alvo: `card:grupo:${g.id}`,
        resumo: `Ligar o grupo "${grupo}" (grupo ${g.id}) ao card que JÁ existe no CRM: cliente "${mostrar(alvoLead.name, 80, `#${alvoLead.id}`)}" (cliente #${alvoLead.id})${args.leadId ? ", como o dono indicou" : " — conferi antes: tem o mesmo nome ou telefone; não crio outro card"}. Nada mais é alterado no cadastro.`,
        argumentos: { grupoId: g.id, modo: "vincular", nome, telefone, leadId: alvoLead.id },
      }
      : {
        alvo: `card:grupo:${g.id}`,
        resumo: `Criar o card do cliente "${nome}" no CRM${telefone ? ` com o telefone ${telefone}` : ", sem telefone (complete no CRM)"}, na etapa inicial, com origem "Dolores — grupo do WhatsApp", e ligar a ele o grupo "${grupo}" (grupo ${g.id}). Conferi antes: nenhum cliente com esse nome${telefone ? " ou telefone" : ""} no CRM.`,
        argumentos: { grupoId: g.id, modo: "criar", nome, telefone, leadId: null },
      };
    // o resumo mostra TODO o texto que será gravado (nome e telefone), na forma em que será gravado (QA R2 N3); ao LIGAR a um
    // card existente nada do que o dono escreveu é gravado (só o vínculo), então não há trecho a conferir
    item.resumo = resumoDaFila(item.resumo, alvoLead ? [] : [`"${nome}"`, ...(telefone ? [telefone] : [])]);
    return { itens: [item], recusados: [] };
  });
}

/** Documento do grupo que pode ir para o card: classificado (ou "confira") e dentro da retenção. */
const PODE_SALVAR = ["classificado", "confira"] as const;

export async function prepararSalvarDocumentos(args: z.infer<typeof entradaSalvarDocumentosGrupo>, ctx: ContextoAcao): Promise<Preparo> {
  return emTransacaoSomenteLeitura(async () => {
    const g = await lerGrupo(args.grupoId);
    if (g.obraId) throw new RecusaAcao(`O grupo ${g.id} é de obra: salvar arquivos na pasta da obra chega na etapa 5 (notas de obra). Nada foi posto na fila.`);
    if (!g.leadId) throw new RecusaAcao(`O grupo ${g.id} ainda não tem card do cliente: peça primeiro para criar o card (criar_card_cliente). Nada foi posto na fila.`);
    const [lead] = await bancoDaLeitura().select({ id: leads.id, name: leads.name }).from(leads).where(and(eq(leads.id, g.leadId), isNull(leads.deletedAt))).limit(1);
    if (!lead) throw new RecusaAcao(`O cliente #${g.leadId} ligado ao grupo não existe mais no CRM (ou foi excluído). Nada foi posto na fila.`);
    const [cfg] = await bancoDaLeitura().select({ retencao: doloresGruposConfig.retencaoDias }).from(doloresGruposConfig).where(eq(doloresGruposConfig.id, 1)).limit(1);
    const retencao = cfg?.retencao ?? 30;
    const docs = await bancoDaLeitura().select().from(doloresGrupoMensagens)
      .where(and(eq(doloresGrupoMensagens.grupoId, g.id), inArray(doloresGrupoMensagens.tipo, ["imagem", "documento"]),
        args.mensagemIds ? inArray(doloresGrupoMensagens.id, args.mensagemIds) : undefined))
      .orderBy(asc(doloresGrupoMensagens.id)).limit(200);
    if (args.mensagemIds) {
      const achados = new Set(docs.map(d => d.id));
      const faltam = args.mensagemIds.filter(x => !achados.has(x));
      if (faltam.length) throw new RecusaAcao(`Documento(s) ${faltam.join(", ")} não são deste grupo (ou não são arquivo). Nada foi posto na fila.`);
    }
    const cliente = mostrar(lead.name, 80, `cliente #${lead.id}`);
    const itens: ItemParaFila[] = [];
    const recusados: Preparo["recusados"] = [];
    for (const d of docs) {
      const alvo = `docgrupo:${d.id}`;
      if (d.situacao === "salvo") { if (args.mensagemIds) recusados.push({ alvo, motivo: `documento ${d.id}: já está salvo no card` }); continue; }
      if (pendenteVencido(d.criadoEm, ctx.agora, retencao)) { recusados.push({ alvo, motivo: `documento ${d.id}: chegou há mais de ${retencao} dias; peça para reenviar no grupo` }); continue; }
      if (!(PODE_SALVAR as readonly string[]).includes(d.situacao) || !d.classificacao) {
        recusados.push({ alvo, motivo: `documento ${d.id}: ${ROTULO_SITUACAO_GRUPO[d.situacao] ?? d.situacao} — não dá para salvar ainda` });
        continue;
      }
      if (itens.length >= 10) { recusados.push({ alvo, motivo: `documento ${d.id}: mais de 10 documentos neste pedido; peça de novo depois` }); continue; }
      const tipo = d.classificacao as TipoDocumentoGrupo;
      const pct = Math.round(Number(d.confianca ?? 0) * 100);
      const nomeArquivo = mostrar(d.midiaNome, 120, `arquivo-do-grupo-${d.id}`);
      const resumo = resumoDaFila(`Salvar no card do cliente "${cliente}" (cliente #${lead.id}) e na pasta dele no Drive o arquivo "${nomeArquivo}" (documento ${d.id}), `
        + `recebido no grupo em ${diaHoraCurta(d.enviadaEm ?? d.criadoEm)}, como "${ROTULO_TIPO_DOCUMENTO[tipo]}" (classificação da IA, confiança ${pct}%`
        + `${d.situacao === "confira" ? "; CONFIRA: confiança baixa — abra o arquivo antes de aprovar" : ""}). É um arquivo novo: não substitui nem apaga nada.`, [`"${nomeArquivo}"`]);
      itens.push({ alvo, resumo, argumentos: { grupoId: g.id, mensagemId: d.id, leadId: lead.id, tipo, nomeArquivo } });
    }
    if (!itens.length && !recusados.length) throw new RecusaAcao(`O grupo ${g.id} não tem documento novo para salvar no card. Nada foi posto na fila.`);
    return { itens, recusados };
  });
}
