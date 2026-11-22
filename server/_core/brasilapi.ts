// EPIC-029 (Módulo Fiscal), etapa 1 — consultas gratuitas de cadastro: CNPJ na Brasil API e CEP na Brasil API, com o
// ViaCEP como reserva automática quando a Brasil API falha ou demora no CEP.
//
// Segurança (story S-1):
//   - hosts FIXOS abaixo; a única parte variável da URL é o CNPJ/CEP já limpo e conferido (sem nada vindo do usuário);
//   - CNPJ com dígito errado ou CEP fora do formato NÃO chama a rede;
//   - tempo-limite curto (4 s) por chamada, com AbortController;
//   - resposta conferida por zod (tolerante a campo novo ou ausente) e textos limpos (sem HTML, com tamanho máximo);
//   - nada de CNPJ/CPF em log: os erros guardam só o tipo do problema.
// Formatos conferidos na documentação OpenAPI oficial da Brasil API (repositório BrasilAPI/BrasilAPI, pages/docs/doc/
// cnpj.json e cep.json, lida em 22/11/2026). ViaCEP: formato conhecido ({ cep, logradouro, bairro, localidade, uf, ibge }
// ou { erro: true }) — formato real confirmado pelo portão de QA da S-1; mapeado de forma tolerante.
import { z } from "zod";
import {
  alertaDaSituacao, cepParaConsulta, cnpjParaConsulta, limparCep, limparCnpj, limparTexto, semCpf, situacaoDoCodigo,
  type DadosCep, type DadosCnpj, type FonteConsulta,
} from "../../shared/consulta-cadastral.js";

export const HOST_BRASIL_API = "https://brasilapi.com.br";
export const HOST_VIACEP = "https://viacep.com.br";
export const TEMPO_LIMITE_MS = 4000;
const TAMANHO_MAXIMO_RESPOSTA = 200_000;

export type MotivoFalha = "invalido" | "nao_encontrado" | "indisponivel" | "resposta_invalida";

export class FalhaConsultaCadastral extends Error {
  constructor(readonly motivo: MotivoFalha, mensagem: string) {
    super(mensagem);
    this.name = "FalhaConsultaCadastral";
  }
}

export type Buscar = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

const textoOuNumero = z.union([z.string(), z.number()]).nullish().catch(null);

// Brasil API — CNPJ v1 (schema "CNPJ" da documentação oficial). Só os campos usados; o resto é ignorado.
const RespostaCnpj = z.object({
  cnpj: textoOuNumero,
  razao_social: textoOuNumero,
  nome_fantasia: textoOuNumero,
  situacao_cadastral: textoOuNumero,
  descricao_situacao_cadastral: textoOuNumero,
  cnae_fiscal: textoOuNumero,
  cnae_fiscal_descricao: textoOuNumero,
  descricao_tipo_de_logradouro: textoOuNumero,
  logradouro: textoOuNumero,
  numero: textoOuNumero,
  complemento: textoOuNumero,
  bairro: textoOuNumero,
  municipio: textoOuNumero,
  uf: textoOuNumero,
  cep: textoOuNumero,
  codigo_municipio_ibge: textoOuNumero,
});

// Brasil API — CEP v2 (schema "AddressV2"): ibge { city, state } pode vir nulo.
const RespostaCepBrasilApi = z.object({
  cep: textoOuNumero,
  state: textoOuNumero,
  city: textoOuNumero,
  neighborhood: textoOuNumero,
  street: textoOuNumero,
  ibge: z.object({ city: textoOuNumero }).nullish().catch(null),
});

// ViaCEP: { erro: true } (ou "true") quando o CEP não existe.
const RespostaViaCep = z.object({
  erro: z.union([z.boolean(), z.string()]).nullish().catch(null),
  cep: textoOuNumero,
  logradouro: textoOuNumero,
  bairro: textoOuNumero,
  localidade: textoOuNumero,
  uf: textoOuNumero,
  ibge: textoOuNumero,
});

async function lerJson(url: string, buscar: Buscar, tempoLimiteMs: number): Promise<{ status: number; corpo: unknown }> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), tempoLimiteMs);
  try {
    const resposta = await buscar(url, { signal: controle.signal, headers: { accept: "application/json", "user-agent": "Prospecta/1.0" } });
    if (resposta.status === 404 || resposta.status === 400) return { status: resposta.status, corpo: null };
    if (!resposta.ok) throw new FalhaConsultaCadastral("indisponivel", "O serviço de consulta não respondeu agora.");
    // Recusa cedo pelo cabeçalho, sem ler o corpo (portão de QA da S-1); sem cabeçalho, vale a conferência do texto lido.
    const tamanhoDeclarado = Number(resposta.headers.get("content-length") ?? NaN);
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > TAMANHO_MAXIMO_RESPOSTA) {
      await resposta.body?.cancel().catch(() => {});
      throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do serviço veio fora do formato.");
    }
    const texto = await resposta.text();
    if (texto.length > TAMANHO_MAXIMO_RESPOSTA) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do serviço veio fora do formato.");
    try {
      return { status: resposta.status, corpo: JSON.parse(texto) };
    } catch {
      throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do serviço veio fora do formato.");
    }
  } catch (e) {
    if (e instanceof FalhaConsultaCadastral) throw e;
    // Tempo esgotado, rede fora ou recusa: tudo vira "indisponível" (sem detalhar a URL, que tem o documento).
    throw new FalhaConsultaCadastral("indisponivel", "O serviço de consulta não respondeu a tempo.");
  } finally {
    clearTimeout(relogio);
  }
}

const so = (v: unknown, max: number) => limparTexto(v, max);
const uf = (v: unknown) => {
  const t = so(v, 2)?.toUpperCase() ?? null;
  return t && /^[A-Z]{2}$/.test(t) ? t : null;
};
const ibge = (v: unknown) => {
  const t = so(v, 7);
  return t && /^\d{7}$/.test(t) ? t : null;
};
const cepDe = (v: unknown) => {
  const t = limparCep(so(v, 12) ?? "");
  return /^\d{8}$/.test(t) ? t : null;
};

export function mapearCnpj(corpo: unknown, cnpj: string): DadosCnpj {
  const r = RespostaCnpj.safeParse(corpo);
  if (!r.success || typeof corpo !== "object" || corpo === null) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta da Receita veio fora do formato.");
  const d = r.data;
  // Resposta de OUTRO CNPJ (trocada no caminho ou erro do serviço) é recusada e não vai para o cache (portão de QA da S-1).
  const cnpjDaResposta = d.cnpj === null || d.cnpj === undefined ? "" : limparCnpj(String(d.cnpj));
  if (cnpjDaResposta && cnpjDaResposta.padStart(14, "0") !== cnpj) throw new FalhaConsultaCadastral("resposta_invalida", "A Receita respondeu sobre outro CNPJ.");
  // MEI: o CPF do dono vem dentro da razão social; sai antes de tudo (LGPD — CPF nunca vai à tela nem ao cache).
  const razaoSocial = semCpf(so(d.razao_social, 150));
  if (!razaoSocial) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta da Receita veio sem a razão social.");
  const situacao = situacaoDoCodigo(d.situacao_cadastral, d.descricao_situacao_cadastral);
  const tipoLogradouro = so(d.descricao_tipo_de_logradouro, 30);
  const logradouro = so(d.logradouro, 150);
  // A Receita separa o tipo ("RUA") do nome; só junta quando o nome ainda não começa pelo tipo.
  const logradouroCompleto = logradouro && tipoLogradouro && !logradouro.toUpperCase().startsWith(tipoLogradouro.toUpperCase())
    ? `${tipoLogradouro} ${logradouro}` : logradouro;
  const cnae = so(d.cnae_fiscal, 10);
  return {
    cnpj,
    razaoSocial,
    nomeFantasia: semCpf(so(d.nome_fantasia, 150)),
    situacao,
    alerta: alertaDaSituacao(situacao),
    cnaePrincipal: cnae && /^\d{5,7}$/.test(cnae) ? { codigo: cnae.padStart(7, "0"), descricao: so(d.cnae_fiscal_descricao, 200) } : null,
    endereco: {
      cep: cepDe(d.cep),
      logradouro: logradouroCompleto ? logradouroCompleto.slice(0, 150) : null,
      numero: so(d.numero, 20),
      complemento: so(d.complemento, 120),
      bairro: so(d.bairro, 100),
      cidade: so(d.municipio, 100),
      uf: uf(d.uf),
      codigoIbge: ibge(d.codigo_municipio_ibge),
    },
  };
}

export function mapearCepBrasilApi(corpo: unknown, cep: string): DadosCep {
  const r = RespostaCepBrasilApi.safeParse(corpo);
  if (!r.success || typeof corpo !== "object" || corpo === null) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do CEP veio fora do formato.");
  const cidade = so(r.data.city, 100);
  const estado = uf(r.data.state);
  if (!cidade || !estado) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do CEP veio sem cidade ou UF.");
  return { cep, logradouro: so(r.data.street, 150), bairro: so(r.data.neighborhood, 100), cidade, uf: estado, codigoIbge: ibge(r.data.ibge?.city) };
}

export function mapearViaCep(corpo: unknown, cep: string): DadosCep {
  const r = RespostaViaCep.safeParse(corpo);
  if (!r.success || typeof corpo !== "object" || corpo === null) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do CEP veio fora do formato.");
  if (r.data.erro === true || r.data.erro === "true") throw new FalhaConsultaCadastral("nao_encontrado", "CEP não encontrado.");
  const cidade = so(r.data.localidade, 100);
  const estado = uf(r.data.uf);
  if (!cidade || !estado) throw new FalhaConsultaCadastral("resposta_invalida", "A resposta do CEP veio sem cidade ou UF.");
  return { cep, logradouro: so(r.data.logradouro, 150), bairro: so(r.data.bairro, 100), cidade, uf: estado, codigoIbge: ibge(r.data.ibge) };
}

const buscarPadrao: Buscar = (url, init) => fetch(url, { ...init, redirect: "error" });

/** CNPJ na Brasil API. CNPJ com dígito errado não chega à rede. */
export async function buscarCnpjNaBrasilApi(valor: string, buscar: Buscar = buscarPadrao, tempoLimiteMs = TEMPO_LIMITE_MS): Promise<DadosCnpj> {
  const cnpj = cnpjParaConsulta(valor);
  if (!cnpj) throw new FalhaConsultaCadastral("invalido", "CNPJ inválido: confira os números.");
  const { status, corpo } = await lerJson(`${HOST_BRASIL_API}/api/cnpj/v1/${cnpj}`, buscar, tempoLimiteMs);
  if (status === 404 || status === 400) throw new FalhaConsultaCadastral("nao_encontrado", "CNPJ não encontrado na Receita.");
  return mapearCnpj(corpo, cnpj);
}

/**
 * CEP na Brasil API; se ela falhar, demorar ou vier fora do formato, tenta o ViaCEP. "Não encontrado" na Brasil API
 * também passa pelo ViaCEP (as bases diferem). Só falha quando os dois falham.
 */
export async function buscarCep(valor: string, buscar: Buscar = buscarPadrao, tempoLimiteMs = TEMPO_LIMITE_MS): Promise<{ dados: DadosCep; fonte: FonteConsulta }> {
  const cep = cepParaConsulta(valor);
  if (!cep) throw new FalhaConsultaCadastral("invalido", "CEP inválido: são 8 números.");
  let naoEncontradoNaPrimeira = false;
  try {
    const { status, corpo } = await lerJson(`${HOST_BRASIL_API}/api/cep/v2/${cep}`, buscar, tempoLimiteMs);
    if (status === 404 || status === 400) naoEncontradoNaPrimeira = true;
    else return { dados: mapearCepBrasilApi(corpo, cep), fonte: "brasilapi" };
  } catch (e) {
    if (!(e instanceof FalhaConsultaCadastral)) throw e;
  }
  try {
    const { status, corpo } = await lerJson(`${HOST_VIACEP}/ws/${cep}/json/`, buscar, tempoLimiteMs);
    if (status === 404 || status === 400) throw new FalhaConsultaCadastral("nao_encontrado", "CEP não encontrado.");
    return { dados: mapearViaCep(corpo, cep), fonte: "viacep" };
  } catch (e) {
    // A Brasil API já disse "não existe" e o ViaCEP não ajudou: o CEP não foi encontrado.
    if (e instanceof FalhaConsultaCadastral && naoEncontradoNaPrimeira) throw new FalhaConsultaCadastral("nao_encontrado", "CEP não encontrado.");
    throw e;
  }
}
