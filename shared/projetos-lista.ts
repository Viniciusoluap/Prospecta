// EPIC-031 S-1 — pedido do dono: "se o projeto alterou o status para entregue ele sai dessa
// lista; ele só aparece novamente se eu botar o filtro lá pra aparecer os entregues".
export const STATUS_PROJETO_ENTREGUE = "entregue";

/** Lista de Projetos: entregue só aparece com o filtro "Entregue"; a busca respeita a regra. */
export function filtrarListaProjetos<T extends { name: string; clientName: string; engineer: string; status: string }>(rows: T[], filtro: { busca: string; status: string }): T[] {
  const busca = filtro.busca.trim().toLowerCase();
  return rows.filter(r => {
    if (filtro.status === STATUS_PROJETO_ENTREGUE) { if (r.status !== STATUS_PROJETO_ENTREGUE) return false; }
    else if (r.status === STATUS_PROJETO_ENTREGUE || (filtro.status && r.status !== filtro.status)) return false;
    return !busca || `${r.name} ${r.clientName} ${r.engineer}`.toLowerCase().includes(busca);
  });
}
