/**
 * Catálogo do checklist de vistoria de avaliações (laudos), espelhando
 * fielmente o checklist ABNT NBR 14653-2 usado no Grupo Santa Fé
 * (web/src/app/admin/avaliacoes/[id]/_components/checklist-vistoria.tsx).
 *
 * Compartilhado entre server (validação) e futura UI admin (EPIC-003 S-04).
 */

export type ChecklistItemState = { ok: boolean | null; nota: string };

export type ChecklistData = {
  tipoChecklist: "imovel" | "terreno";
  estadoGeral: string;
  items: Record<string, ChecklistItemState>;
  fotos: string[];
};

export type ChecklistGroup = {
  id: string;
  label: string;
  items: { key: string; label: string }[];
};

export const CHECKLIST_MAX_FOTOS = 15;

// ── Checklist Imóvel Pronto (ABNT NBR 14653-2) ──────────────────────────────

export const ESTADO_GERAL_IMOVEL = [
  { value: "novo", label: "Novo / Em construção" },
  { value: "otimo", label: "Ótimo estado" },
  { value: "conservado", label: "Conservado" },
  { value: "regular", label: "Regular" },
  { value: "reformas_leves", label: "Necessita reformas leves" },
  { value: "reformas_importantes", label: "Necessita reformas importantes" },
  { value: "ruim", label: "Ruim" },
];

export const CHECKLIST_IMOVEL: ChecklistGroup[] = [
  {
    id: "localizacao",
    label: "Localização e Infraestrutura",
    items: [
      { key: "loc_01", label: "Rede de água encanada" },
      { key: "loc_02", label: "Rede de esgoto (ou fossa regularizada)" },
      { key: "loc_03", label: "Energia elétrica disponível" },
      { key: "loc_04", label: "Via pública pavimentada" },
      { key: "loc_05", label: "Iluminação pública" },
      { key: "loc_06", label: "Transporte público próximo" },
      { key: "loc_07", label: "Comércio e serviços nas proximidades" },
      { key: "loc_08", label: "Escola / creche próxima" },
      { key: "loc_09", label: "Unidade de saúde próxima" },
      { key: "loc_10", label: "Segurança satisfatória na região" },
    ],
  },
  {
    id: "documentacao",
    label: "Documentação e Situação Legal",
    items: [
      { key: "doc_01", label: "Matrícula atualizada no cartório" },
      { key: "doc_02", label: "Escritura / contrato de compra e venda" },
      { key: "doc_03", label: "Habite-se / alvará de construção" },
      { key: "doc_04", label: "Planta da edificação disponível" },
      { key: "doc_05", label: "Sem ônus (hipotecas ou penhoras)" },
      { key: "doc_06", label: "IPTU em dia" },
      { key: "doc_07", label: "Sem débitos de condomínio" },
      { key: "doc_08", label: "Área conforme consta na matrícula" },
      { key: "doc_09", label: "Construção regularizada perante a prefeitura" },
      { key: "doc_10", label: "Conformidade com zoneamento municipal" },
    ],
  },
  {
    id: "estrutura",
    label: "Estrutura e Fundação",
    items: [
      { key: "est_01", label: "Fundação aparentemente íntegra" },
      { key: "est_02", label: "Ausência de recalque ou acomodação" },
      { key: "est_03", label: "Ausência de trincas/fissuras estruturais" },
      { key: "est_04", label: "Paredes estruturais em bom estado" },
      { key: "est_05", label: "Laje/teto sem infiltração ou danos estruturais" },
      { key: "est_06", label: "Pilares e vigas sem fissuras visíveis" },
    ],
  },
  {
    id: "cobertura",
    label: "Cobertura e Telhado",
    items: [
      { key: "cob_01", label: "Telhado em bom estado de conservação" },
      { key: "cob_02", label: "Ausência de vazamentos / goteiras" },
      { key: "cob_03", label: "Calhas e rufos funcionando" },
      { key: "cob_04", label: "Impermeabilização adequada" },
      { key: "cob_05", label: "Forro/laje de teto sem danos" },
    ],
  },
  {
    id: "acabamentos",
    label: "Acabamentos Internos",
    items: [
      { key: "acb_01", label: "Piso em bom estado" },
      { key: "acb_02", label: "Revestimento de paredes em bom estado" },
      { key: "acb_03", label: "Pintura em bom estado" },
      { key: "acb_04", label: "Portas em bom estado (ferragens e fechaduras)" },
      { key: "acb_05", label: "Janelas em bom estado (vidros e trilhos)" },
      { key: "acb_06", label: "Louças sanitárias íntegras" },
      { key: "acb_07", label: "Metais sanitários (torneiras, registros) funcionando" },
      { key: "acb_08", label: "Bancada/pia da cozinha em bom estado" },
      { key: "acb_09", label: "Armários embutidos em bom estado" },
    ],
  },
  {
    id: "eletrica",
    label: "Instalação Elétrica",
    items: [
      { key: "ele_01", label: "Quadro de distribuição (disjuntores) adequado" },
      { key: "ele_02", label: "Fiação aparentemente em bom estado" },
      { key: "ele_03", label: "Tomadas e interruptores funcionando" },
      { key: "ele_04", label: "Aterramento presente" },
      { key: "ele_05", label: "Iluminação funcionando em todos os cômodos" },
      { key: "ele_06", label: "Sem fiação exposta ou improvisada" },
    ],
  },
  {
    id: "hidraulica",
    label: "Instalação Hidráulica e Sanitária",
    items: [
      { key: "hid_01", label: "Encanamento sem vazamentos visíveis" },
      { key: "hid_02", label: "Caixa d'água com volume e estado adequados" },
      { key: "hid_03", label: "Pressão de água satisfatória" },
      { key: "hid_04", label: "Esgoto conectado à rede ou fossa regularizada" },
      { key: "hid_05", label: "Banheiros sem infiltração ou mofo" },
      { key: "hid_06", label: "Vaso sanitário e chuveiro funcionando" },
      { key: "hid_07", label: "Aquecimento de água presente e funcionando" },
    ],
  },
  {
    id: "conservacao",
    label: "Conservação Geral",
    items: [
      { key: "con_01", label: "Ausência de umidade ascendente" },
      { key: "con_02", label: "Ausência de infiltrações nas paredes/pisos" },
      { key: "con_03", label: "Ausência de mofo / bolor" },
      { key: "con_04", label: "Ausência de sinais de cupim ou pragas" },
      { key: "con_05", label: "Ausência de odores anormais" },
      { key: "con_06", label: "Área externa / quintal em bom estado" },
      { key: "con_07", label: "Muros / cercas em bom estado" },
    ],
  },
  {
    id: "benfeitorias",
    label: "Benfeitorias e Dependências",
    items: [
      { key: "ben_01", label: "Garagem / vaga coberta presente" },
      { key: "ben_02", label: "Área de serviço / lavanderia" },
      { key: "ben_03", label: "Varanda / sacada / terraço" },
      { key: "ben_04", label: "Piscina (se houver, em bom estado)" },
      { key: "ben_05", label: "Churrasqueira (se houver, em bom estado)" },
      { key: "ben_06", label: "Portão elétrico (se houver, funcionando)" },
      { key: "ben_07", label: "Sistema de câmeras/alarme (se houver)" },
      { key: "ben_08", label: "Ar-condicionado (se houver, funcionando)" },
    ],
  },
];

// ── Checklist Terreno (ABNT NBR 14653-2 para terrenos) ──────────────────────

export const ESTADO_GERAL_TERRENO = [
  { value: "excelente", label: "Excelente aptidão" },
  { value: "bom", label: "Boa aptidão" },
  { value: "regular", label: "Aptidão regular" },
  { value: "restricoes", label: "Com restrições relevantes" },
  { value: "inapropriado", label: "Inapropriado para construção" },
];

export const CHECKLIST_TERRENO: ChecklistGroup[] = [
  {
    id: "ter_localizacao",
    label: "Localização e Infraestrutura",
    items: [
      { key: "ter_loc_01", label: "Rede de água encanada disponível" },
      { key: "ter_loc_02", label: "Rede de esgoto disponível (ou possibilidade de fossa)" },
      { key: "ter_loc_03", label: "Energia elétrica disponível" },
      { key: "ter_loc_04", label: "Via pública pavimentada" },
      { key: "ter_loc_05", label: "Iluminação pública" },
      { key: "ter_loc_06", label: "Transporte público próximo" },
      { key: "ter_loc_07", label: "Comércio e serviços nas proximidades" },
      { key: "ter_loc_08", label: "Escola / creche próxima" },
      { key: "ter_loc_09", label: "Unidade de saúde próxima" },
      { key: "ter_loc_10", label: "Segurança satisfatória na região" },
    ],
  },
  {
    id: "ter_documentacao",
    label: "Documentação e Situação Legal",
    items: [
      { key: "ter_doc_01", label: "Matrícula atualizada no cartório" },
      { key: "ter_doc_02", label: "Escritura / contrato de compra e venda" },
      { key: "ter_doc_03", label: "Sem ônus (hipotecas ou penhoras)" },
      { key: "ter_doc_04", label: "IPTU em dia" },
      { key: "ter_doc_05", label: "Área conforme consta na matrícula" },
      { key: "ter_doc_06", label: "Conformidade com zoneamento municipal" },
      { key: "ter_doc_07", label: "Aprovação de loteamento / desmembramento regularizado" },
      { key: "ter_doc_08", label: "Levantamento topográfico disponível" },
      { key: "ter_doc_09", label: "Sem sobreposição com área pública ou tombada" },
    ],
  },
  {
    id: "ter_fisicas",
    label: "Características Físicas",
    items: [
      { key: "ter_fis_01", label: "Topografia plana ou levemente inclinada" },
      { key: "ter_fis_02", label: "Ausência de alagamentos / área não inundável" },
      { key: "ter_fis_03", label: "Solo sem contaminação aparente" },
      { key: "ter_fis_04", label: "Ausência de vegetação de preservação permanente (APP)" },
      { key: "ter_fis_05", label: "Ausência de mata nativa / reserva legal" },
      { key: "ter_fis_06", label: "Forma regular (quadrada / retangular)" },
      { key: "ter_fis_07", label: "Testada adequada para edificação" },
      { key: "ter_fis_08", label: "Acesso por logradouro oficial" },
      { key: "ter_fis_09", label: "Sem risco geológico visível (erosão, deslizamento)" },
    ],
  },
  {
    id: "ter_aptidao",
    label: "Aptidão para Construção",
    items: [
      { key: "ter_apt_01", label: "Zoneamento permite uso residencial" },
      { key: "ter_apt_02", label: "Zoneamento permite uso comercial / misto" },
      { key: "ter_apt_03", label: "Coeficiente de aproveitamento compatível" },
      { key: "ter_apt_04", label: "Taxa de ocupação favorável" },
      { key: "ter_apt_05", label: "Recuos viáveis para construção" },
      { key: "ter_apt_06", label: "Ausência de dutos / linhas de alta tensão sobre o terreno" },
      { key: "ter_apt_07", label: "Solo com capacidade de suporte aparente" },
    ],
  },
  {
    id: "ter_estado",
    label: "Estado Atual do Terreno",
    items: [
      { key: "ter_est_01", label: "Terreno limpo e sem entulho" },
      { key: "ter_est_02", label: "Sem construções irregulares ou invasões" },
      { key: "ter_est_03", label: "Muro / cerca no perímetro" },
      { key: "ter_est_04", label: "Marcos de divisa identificáveis" },
      { key: "ter_est_05", label: "Ausência de corpos d'água ou nascentes no interior" },
    ],
  },
];

export function getChecklistGroups(tipo: "imovel" | "terreno"): ChecklistGroup[] {
  return tipo === "terreno" ? CHECKLIST_TERRENO : CHECKLIST_IMOVEL;
}

export function getEstadoGeralOptions(tipo: "imovel" | "terreno") {
  return tipo === "terreno" ? ESTADO_GERAL_TERRENO : ESTADO_GERAL_IMOVEL;
}
