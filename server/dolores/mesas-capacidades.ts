// EPIC-027 C5 (criadora de mesas) — o catálogo REAL das capacidades da Dolores (o que uma proposta de mesa pode citar como "já existe"),
// montado a cada chamada a partir do registro de funções: leituras (funcoes.ts), ações (acoes/registro.ts), o que está liberado
// (permissoes.ts) e o que é proibido. Fica em arquivo próprio e é carregado por import DINÂMICO pelas ações/leitura das mesas (evita o
// ciclo funcoes.ts → leitura/mesas.ts → funcoes.ts e registro.ts → acoes/mesas.ts → registro.ts).
import { nivelDoItem } from "../../shared/dolores/confirmacao.js";
import { FUNCOES_DAS_MESAS, type CatalogoDeCapacidades } from "../../shared/dolores/mesas.js";
import { ACOES } from "./acoes/registro.js";
import { FUNCOES, LEITURAS_DO_DONO } from "./funcoes.js";
import { PROIBIDAS, funcaoLiberada } from "./permissoes.js";

export function catalogoDeCapacidades(): CatalogoDeCapacidades {
  const fora = (n: string) => FUNCOES_DAS_MESAS.includes(n) || !funcaoLiberada(n);
  return {
    leituras: [...FUNCOES, ...LEITURAS_DO_DONO].map(f => f.nome).filter(n => !fora(n)),
    acoes: ACOES.map(a => a.nome).filter(n => !fora(n)),
    proibidas: Object.keys(PROIBIDAS),
    // na dúvida, o mais forte: os argumentos vazios fazem as ações de grupo caírem em "sério"
    nivelDaAcao: (nome: string) => nivelDoItem(nome, {}),
  };
}
