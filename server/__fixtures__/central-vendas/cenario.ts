// Cenário comum dos testes da Central de Vendas: banco em memória, usuários, conexão Evolution (QR code),
// configuração ligada em modo de teste e dependências simuladas (envio e IA nunca saem para a rede).
import { configSchema, type ConfigCentral } from "../../../shared/central-vendas/config.js";
import { definirDependencias, salvarConfig, type ClienteIA } from "../../central-vendas/base.js";
import { criarBanco } from "./banco.js";

export const NUMERO_TESTE = "5599988887777";
export const OUTRO_NUMERO = "5599911112222";

export type Envio = { numero: string; texto: string };

export async function montarCenario(usarBanco: (db: unknown) => void, opcoes: { config?: Partial<ConfigCentral>; agora?: Date } = {}) {
  const banco = await criarBanco();
  usarBanco(banco.db);
  await banco.pg.exec(`
    INSERT INTO users ("openId", name, role, active) VALUES
      ('admin', 'Admin Geral', 'admin', true), ('op1', 'Olga Operadora', 'colaborador', true),
      ('op2', 'Otto Operador', 'colaborador', true), ('an1', 'Ana Analista', 'colaborador', true),
      ('inativo', 'Ivo Inativo', 'colaborador', false);
    INSERT INTO whatsapp_connections (user_id, provider, status, instancia, numero) VALUES (1, 'evolution', 'conectado', 'inst-teste', '5599900000000');
  `);
  const envios: Envio[] = [];
  let falharEnvios = 0;
  const relogio = { agora: opcoes.agora ?? new Date("2026-11-12T13:00:00Z") }; // 10h em Fortaleza (quinta)
  const respostasIA: (string | Error)[] = [];
  const chamadasIA: Parameters<ClienteIA>[0][] = [];
  const dormidas: number[] = [];
  definirDependencias({
    agora: () => relogio.agora,
    aleatorio: () => 0.5,
    dormir: async ms => { dormidas.push(ms); },
    enviar: async ({ numero, texto }) => {
      if (falharEnvios > 0) { falharEnvios--; return { ok: false, externalId: null, connectionId: 1, erro: "Evolution fora do ar (simulado)" }; }
      envios.push({ numero, texto });
      return { ok: true, externalId: `ext-${envios.length}`, connectionId: 1 };
    },
    ia: async p => {
      chamadasIA.push(p);
      const r = respostasIA.shift();
      if (r instanceof Error) throw r;
      return { texto: r ?? JSON.stringify({ resposta: "Certo! Pode me contar mais?", confianca: 0.9, transferir: false, campos: {} }), entrada: 100, saida: 50 };
    },
  });
  const config = configSchema.parse({
    ativo: true, modoTeste: true, numerosTeste: [NUMERO_TESTE], operadores: [2, 3], analistas: [4],
    horarioAtendimento: { dias: [0, 1, 2, 3, 4, 5, 6], inicio: "08:00", fim: "18:00" }, intervaloMinSeg: 10, intervaloMaxSeg: 20,
    ...opcoes.config,
  });
  await salvarConfig(config, 1);
  return {
    ...banco, envios, chamadasIA, respostasIA, dormidas, relogio, config,
    falharProximos: (n: number) => { falharEnvios = n; },
    avancar: (minutos: number) => { relogio.agora = new Date(relogio.agora.getTime() + minutos * 60_000); },
    /** Resposta simulada da IA (JSON no formato pedido pelo prompt). */
    ia: (resposta: string, campos: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
      respostasIA.push(JSON.stringify({ resposta, confianca: 0.9, transferir: false, campos, ...extra })),
    salvarConfig: (c: Partial<ConfigCentral>) => salvarConfig(configSchema.parse({ ...config, ...c }), 1),
  };
}

export type Cenario = Awaited<ReturnType<typeof montarCenario>>;

/** Aviso da Evolution de mensagem recebida (texto ou documento). */
export function aviso(id: string, numero: string, texto: string, extra: Record<string, unknown> = {}) {
  return {
    event: "messages.upsert", instance: "inst-teste",
    data: { key: { id, remoteJid: `${numero}@s.whatsapp.net`, fromMe: false }, pushName: "Cliente Teste", message: { conversation: texto }, ...extra },
  };
}
