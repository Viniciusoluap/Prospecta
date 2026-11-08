import { and, asc, eq, isNull } from "drizzle-orm";
import { brokerProfiles, constructionPci, constructionProjects, imoveis, leads, users } from "../drizzle/schema.js";
import type { OpcoesContrato } from "../shared/contratos/modelos.js";
import type { DadosPci } from "./caixa/pci.js";
import { getDb } from "./db.js";

export async function opcoesModelosContrato(obraId?: number): Promise<OpcoesContrato> {
  const db = getDb();
  const [obras, corretores, empreiteiros] = await Promise.all([
    db.select({
      id: constructionProjects.id, nome: constructionProjects.title, endereco: constructionProjects.address,
      area: constructionProjects.totalArea, terreno: constructionProjects.lotCost, financiamento: constructionProjects.financedAmount,
      fgts: constructionProjects.fgtsAmount, subsidio: constructionProjects.subsidyAmount,
      valorExecucao: constructionProjects.contractValue, percentualObra: constructionProjects.commissionPct,
      empreiteiroId: constructionProjects.contractorUserId,
      leadId: leads.id, cliente: leads.name, cpfCliente: leads.cpf, enderecoCliente: leads.address,
      bairroCliente: leads.neighborhood, cidadeCliente: leads.city, ufCliente: leads.state,
      conjuge: leads.spouseName, temConjuge: leads.hasSpouse, vgv: leads.simulationValue, corretorId: leads.brokerId,
      imovelId: imoveis.id, rua: imoveis.endereco, bairro: imoveis.bairro, cidade: imoveis.cidade, estado: imoveis.estado,
      pci: constructionPci.parsed,
    }).from(constructionProjects)
      .innerJoin(leads, eq(leads.id, constructionProjects.leadId))
      .innerJoin(imoveis, eq(imoveis.id, constructionProjects.imovelId))
      .leftJoin(constructionPci, eq(constructionPci.projectId, constructionProjects.id))
      .where(and(isNull(leads.deletedAt), obraId === undefined ? undefined : eq(constructionProjects.id, obraId)))
      .orderBy(asc(constructionProjects.title)),
    db.select({ id: users.id, nome: users.name, creci: users.creci, percentualPadrao: brokerProfiles.defaultCommissionPct })
      .from(users).leftJoin(brokerProfiles, eq(brokerProfiles.userId, users.id))
      .where(and(eq(users.role, "corretor"), eq(users.active, true))).orderBy(asc(users.name)),
    db.select({ id: users.id, nome: users.name, documento: users.cpf, endereco: users.address, cidade: users.city, estado: users.state, cep: users.zipCode })
      .from(users).where(and(eq(users.role, "empreiteiro"), eq(users.active, true))).orderBy(asc(users.name)),
  ]);
  return {
    empresa: {
      nome: "PROSPECTA CONSTRUÇÕES E AVALIAÇÃO IMOBILIÁRIA LTDA",
      documento: "41.865.900/0001-89",
      endereco: "Rua Leôncio Pires Dourado, 840-A, Sala A, Bacuri, CEP 65.901-020, Imperatriz/MA",
    },
    obras: obras.map(({ pci, ...o }) => {
      const dados = pci as DadosPci | null;
      const local = dados?.identificacao;
      const endereco = o.rua || o.endereco || local?.endereco;
      const foro = [o.cidade, o.estado].filter(Boolean).join("/");
      return {
        ...o, id: String(o.id), leadId: String(o.leadId), imovelId: String(o.imovelId),
        enderecoImovel: endereco ? [endereco, o.bairro || local?.bairro, foro].filter(Boolean).join(", ") : "",
        enderecoCliente: o.enderecoCliente ? [o.enderecoCliente, o.bairroCliente, o.cidadeCliente, o.ufCliente].filter(Boolean).join(", ") : "",
        cpfCliente: o.cpfCliente ?? "",
        conjuge: o.temConjuge ? o.conjuge ?? "" : "",
        foro, area: String(o.area ?? ""), matricula: local?.matricula ?? "", cartorio: local?.cartorio ?? "",
        prazo: String(dados?.prazoMeses ?? ""), corretorId: String(o.corretorId ?? ""), empreiteiroId: String(o.empreiteiroId ?? ""),
      };
    }),
    corretores: corretores.filter((c) => c.nome).map((c) => ({ ...c, id: String(c.id), nome: c.nome!, creci: c.creci ?? "" })),
    empreiteiros: empreiteiros.filter((e) => e.nome).map((e) => ({
      id: String(e.id), nome: e.nome!, documento: e.documento ?? "",
      endereco: e.endereco ? [e.endereco, e.cidade, e.estado, e.cep].filter(Boolean).join(", ") : "",
    })),
  };
}
