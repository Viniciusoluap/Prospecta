// Maquete 3D (EPIC-028, Etapa 2) — nome em português de cada tipo do catálogo de móveis (planta 2D e legendas).
import type { TipoMovel } from "./mobilia.js";

export const ROTULOS_MOVEL_FONTE: Record<TipoMovel, string> = {
  sofa: "Sofá", poltrona: "Poltrona", mesa_centro: "Mesa de centro", rack_tv: "Rack e TV", tapete: "Tapete",
  mesa_jantar: "Mesa", cadeira: "Cadeira", buffet: "Buffet", aparador: "Aparador", cama: "Cama",
  criado_mudo: "Criado", guarda_roupa: "Guarda-roupa", escrivaninha: "Escrivaninha", cadeira_escritorio: "Cadeira",
  estante: "Estante", bancada_cozinha: "Bancada", armario_aereo: "Armário aéreo", geladeira: "Geladeira",
  vaso_sanitario: "Vaso", lavatorio: "Lavatório", espelho: "Espelho", box_chuveiro: "Box", tanque: "Tanque",
  maquina_lavar: "Máquina", armario_servico: "Armário", mesa_externa: "Mesa externa", churrasqueira: "Churrasqueira",
  prateleira: "Prateleira", planta: "Planta", luminaria_piso: "Luminária", quadro: "Quadro", cortina: "Cortina",
  pendente: "Pendente", plafon: "Plafon", carro: "Carro", balcao: "Balcão", fogao: "Fogão",
};
