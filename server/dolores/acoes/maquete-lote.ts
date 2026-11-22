// EPIC-027 C5-COM (mesa comercial ligada à maquete) — gerar o link da maquete 3D de um lote pela conversa do DONO. De FILA:
// aqui só se confere e se monta o resumo exato (nada é gravado); a troca do código roda depois da resposta dele, só pelo WhatsApp
// dele (`ctx.via`). Nível (shared/dolores/confirmacao.ts#nivelDoItem): lote SEM link → "registro" ("pode"); lote que JÁ tem link
// → "sério" ("confirmo"), porque o link anterior deixa de abrir na hora. O código sai do MESMO gerador do painel do admin
// (server/dolores/maquete-lote.ts → server/maquete-3d/lotes.ts#novoCodigo). Ligar o lote a planta/unidade e publicar versão
// continuam só pela tela do admin. Nada é enviado a cliente: o link volta só ao dono.
import { z } from "zod";
import { prefixoDaFila } from "../../../shared/dolores/fila.js";
import { linkDoLote, nomeCompletoDoLote, origemPublica, textosDoLote } from "../../../shared/dolores/maquete-lote.js";
import { emTransacaoDeEscrita } from "../escrita.js";
import { lerLoteParaLink, marcaDoCodigo, trocarCodigoDoLote } from "../maquete-lote.js";
import { RecusaAcao, registrarAutoria, resumoDaFila, urlDoSistemaParaLinks, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";

const id32 = z.number().int().positive().max(2_147_483_647);
export const entradaGerarLinkMaquete = z.object({ loteId: id32.describe("O loteId que consultar_maquete_lote devolveu.") }).strict();
export const entradaGerarLinkAprovado = z.object({ loteId: id32, troca: z.boolean(), antes: z.string().regex(/^[0-9a-f]{16}$/).nullable() }).strict();

const FRASE_SO_PELO_WHATSAPP = "Gerar o link da maquete pela conversa vale só com a sua resposta no WhatsApp; pela tela, use a maquete › Lotes › Gerar link. Nada mudou.";
const FRASE_COLADO = "Gerar o link da maquete só por pedido seu, escrito direto na conversa (sem texto colado ou citado). Nada foi feito.";
const soPeloWhatsapp = (ctx: ContextoAcao) => { if (ctx.via !== "whatsapp") throw new RecusaAcao(FRASE_SO_PELO_WHATSAPP); };

export async function prepararGerarLinkMaquete(args: z.infer<typeof entradaGerarLinkMaquete>, ctx: ContextoAcao): Promise<Preparo> {
  if (ctx.motivoContaminacao === "colagem") throw new RecusaAcao(FRASE_COLADO);
  const l = await lerLoteParaLink(args.loteId);
  if (!l) throw new RecusaAcao("Não achei esse lote entre os que têm maquete 3D (o lote é ligado pela tela da maquete). Nada foi feito.");
  if (!l.maqueteOk) throw new RecusaAcao("A maquete ligada a este lote não está disponível; confira na tela da maquete. Nada foi feito.");
  const nome = nomeCompletoDoLote(textosDoLote(l));
  const troca = l.codigoLink !== null;
  const desligada = l.ativo ? "" : " (a página deste lote está desligada: o link só abre quando ela for ligada na tela da maquete)";
  const resumo = resumoDaFila(troca
    ? `${prefixoDaFila(ctx.motivoContaminacao)}TROCAR o link da maquete 3D do ${nome}: o link de hoje deixa de abrir na hora e quem já recebeu vai precisar do novo${desligada}`
    : `${prefixoDaFila(ctx.motivoContaminacao)}gerar o link da maquete 3D do ${nome}${desligada}`);
  return { itens: [{ alvo: `maquete-lote:${l.id}:link`, resumo, argumentos: { loteId: l.id, troca, antes: marcaDoCodigo(l.codigoLink) } }], recusados: [] };
}

export async function executarGerarLinkAprovado(args: z.infer<typeof entradaGerarLinkAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  // a troca é decidida pelo estado gravado na proposta (protegido pelo gatilho/hash da fila): "sem link" não vira troca escondida
  if (args.troca !== (args.antes !== null)) throw new RecusaAcao("A proposta não confere; nada mudou. Peça de novo.");
  const r = await emTransacaoDeEscrita(async () => {
    const feito = await trocarCodigoDoLote(args.loteId, args.antes);
    if (!feito) throw new RecusaAcao("O link deste lote mudou (ou o lote mudou) depois da proposta; nada mudou. Peça de novo.");
    await registrarAutoria(ctx, { tabela: "maquete_3d_lotes", registroId: feito.lote.id, funcao: "gerar_link_maquete_lote", descricao: args.troca ? `link do lote ${feito.lote.id} trocado` : `link do lote ${feito.lote.id} gerado` });
    return feito;
  });
  const nome = nomeCompletoDoLote(textosDoLote(r.lote));
  const link = linkDoLote(origemPublica(urlDoSistemaParaLinks()), r.lote.empreendimentoSlug, r.lote.loteSlug, r.codigo);
  const onde = link ? `: ${link}` : " (o link aparece na tela da maquete: o endereço público do sistema não está configurado aqui)";
  return {
    dados: { loteId: r.lote.id, troca: args.troca },
    // auditoria/resultado: só ids e se foi troca (nunca o código)
    resumo: { loteId: r.lote.id, troca: args.troca, comLink: !!link },
    feitos: [args.troca ? `troquei o link da maquete 3D do ${nome} (o anterior já não abre)${onde}` : `gerei o link da maquete 3D do ${nome}${onde}`],
  };
}
