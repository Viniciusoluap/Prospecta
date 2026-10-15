// Equivalente ao `useRouter().refresh()` do Next usado pelo Santa Fé: recarrega o estudo.
import { recarregarEstudo } from "./acoes";

export function useRouter() {
  return { refresh: () => { void recarregarEstudo(); } };
}
