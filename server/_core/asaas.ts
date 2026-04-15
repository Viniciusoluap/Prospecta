import { ENV } from "./env";

/**
 * Cliente Asaas para integração com gateway de pagamento brasileiro
 * Documentação: https://docs.asaas.com/
 */

const ASAAS_API_URL = "https://api.asaas.com/v3";
const ASAAS_SANDBOX_URL = "https://sandbox.asaas.com/api/v3";

// Usar sandbox se a chave começar com $aact_test, produção se começar com $aact_prod
// Fallback temporário enquanto a variável de ambiente não está carregando
const FALLBACK_KEY =
  "$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmU5MTAxMjQyLTFiMTktNDYxYy1hYTY4LTg1ZTFkYzRiY2ZiNDo6JGFhY2hfZGZkYTVhNzAtYWI2MS00YTg1LThiMjQtMzU5MTc2ODQ0MjUy";
const API_KEY = ENV.asaasApiKey || FALLBACK_KEY;

const isProduction = API_KEY?.startsWith("$aact_prod");
const BASE_URL = isProduction ? ASAAS_API_URL : ASAAS_SANDBOX_URL;

if (!API_KEY) {
  console.warn(
    "[Asaas] API key not configured. Payment features will not work."
  );
} else {
  console.log(
    `[Asaas] Using ${ENV.asaasApiKey ? "environment" : "fallback"} API key`
  );
}

/**
 * Faz requisição para API do Asaas
 */
async function asaasRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_KEY) {
    throw new Error("Asaas API key is not configured");
  }

  const url = `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      access_token: API_KEY,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[Asaas] API Error:", data);
    throw new Error(
      data.errors?.[0]?.description || "Erro ao processar pagamento"
    );
  }

  return data;
}

/**
 * Tipos de cobrança Asaas
 */
export type AsaasBillingType = "UNDEFINED" | "BOLETO" | "CREDIT_CARD" | "PIX";

/**
 * Status de pagamento Asaas
 */
export type AsaasPaymentStatus =
  | "PENDING" // Aguardando pagamento
  | "RECEIVED" // Pagamento confirmado
  | "CONFIRMED" // Pagamento em análise (PIX pessoa física)
  | "OVERDUE" // Vencida
  | "REFUNDED" // Estornada
  | "RECEIVED_IN_CASH" // Recebido em dinheiro
  | "REFUND_REQUESTED" // Estorno solicitado
  | "CHARGEBACK_REQUESTED" // Chargeback solicitado
  | "CHARGEBACK_DISPUTE" // Disputa de chargeback
  | "AWAITING_CHARGEBACK_REVERSAL" // Aguardando reversão de chargeback
  | "DUNNING_REQUESTED" // Negativação solicitada
  | "DUNNING_RECEIVED" // Recuperado
  | "AWAITING_RISK_ANALYSIS"; // Aguardando análise de risco

/**
 * Interface para criar cliente no Asaas
 */
export interface AsaasCustomer {
  id?: string;
  name: string;
  email?: string;
  cpfCnpj?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  additionalEmails?: string;
  municipalInscription?: string;
  stateInscription?: string;
  observations?: string;
}

/**
 * Interface para criar cobrança no Asaas
 */
export interface AsaasPaymentRequest {
  customer: string; // ID do cliente no Asaas
  billingType: AsaasBillingType;
  value: number;
  dueDate: string; // Formato: YYYY-MM-DD
  description?: string;
  externalReference?: string;
  installmentCount?: number;
  installmentValue?: number;
  totalValue?: number;
  discount?: {
    value?: number;
    dueDateLimitDays?: number;
    type?: "FIXED" | "PERCENTAGE";
  };
  interest?: {
    value: number;
    type?: "PERCENTAGE";
  };
  fine?: {
    value: number;
    type?: "FIXED" | "PERCENTAGE";
  };
  postalService?: boolean;
  callback?: {
    successUrl?: string;
    autoRedirect?: boolean;
  };
}

/**
 * Interface de resposta de cobrança do Asaas
 */
export interface AsaasPayment {
  id: string;
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  netValue: number;
  originalValue: number;
  interestValue: number;
  description: string;
  externalReference: string;
  dueDate: string;
  originalDueDate: string;
  paymentDate: string | null;
  clientPaymentDate: string | null;
  installmentNumber: number | null;
  invoiceUrl: string;
  bankSlipUrl: string | null;
  transactionReceiptUrl: string | null;
  invoiceNumber: string;
  status: AsaasPaymentStatus;
  confirmedDate: string | null;
  pixTransaction: string | null;
  creditDate: string | null;
  estimatedCreditDate: string | null;
  deleted: boolean;
}

/**
 * Interface de resposta de QR Code PIX
 */
export interface AsaasPixQrCode {
  encodedImage: string; // Base64 da imagem do QR Code
  payload: string; // Código copia-e-cola do PIX
  expirationDate: string;
}

/**
 * Cria ou atualiza um cliente no Asaas
 */
export async function createOrUpdateAsaasCustomer(
  customer: AsaasCustomer
): Promise<AsaasCustomer> {
  // Se já tem ID, atualizar
  if (customer.id) {
    return asaasRequest<AsaasCustomer>(`/customers/${customer.id}`, {
      method: "PUT",
      body: JSON.stringify(customer),
    });
  }

  // Criar novo cliente
  return asaasRequest<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(customer),
  });
}

/**
 * Busca cliente no Asaas por CPF/CNPJ
 */
export async function getAsaasCustomerByCpfCnpj(
  cpfCnpj: string
): Promise<AsaasCustomer | null> {
  try {
    const response = await asaasRequest<{ data: AsaasCustomer[] }>(
      `/customers?cpfCnpj=${cpfCnpj}`
    );
    return response.data[0] || null;
  } catch (error) {
    console.error("[Asaas] Error fetching customer:", error);
    return null;
  }
}

/**
 * Cria uma cobrança no Asaas
 */
export async function createAsaasPayment(
  payment: AsaasPaymentRequest
): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>("/payments", {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

/**
 * Obtém QR Code PIX de uma cobrança
 */
export async function getAsaasPixQrCode(
  paymentId: string
): Promise<AsaasPixQrCode> {
  return asaasRequest<AsaasPixQrCode>(`/payments/${paymentId}/pixQrCode`);
}

/**
 * Recupera informações de uma cobrança
 */
export async function getAsaasPayment(
  paymentId: string
): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>(`/payments/${paymentId}`);
}

/**
 * Cancela uma cobrança
 */
export async function deleteAsaasPayment(
  paymentId: string
): Promise<{ deleted: boolean; id: string }> {
  return asaasRequest(`/payments/${paymentId}`, {
    method: "DELETE",
  });
}

/**
 * Restaura uma cobrança cancelada
 */
export async function restoreAsaasPayment(
  paymentId: string
): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>(`/payments/${paymentId}/restore`, {
    method: "POST",
  });
}

/**
 * Lista cobranças com filtros
 */
export async function listAsaasPayments(filters?: {
  customer?: string;
  billingType?: AsaasBillingType;
  status?: AsaasPaymentStatus;
  dateCreated_ge?: string; // >= data
  dateCreated_le?: string; // <= data
  paymentDate?: string;
  estimatedCreditDate?: string;
  externalReference?: string;
  offset?: number;
  limit?: number;
}): Promise<{
  data: AsaasPayment[];
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams();

  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/payments?${queryString}` : "/payments";

  return asaasRequest(endpoint);
}

/**
 * Valida se a API key está configurada e funcional
 */
export async function validateAsaasApiKey(): Promise<boolean> {
  try {
    // Tenta listar clientes (endpoint simples para validar credenciais)
    await asaasRequest<{ data: AsaasCustomer[] }>("/customers?limit=1");
    return true;
  } catch (error) {
    console.error("[Asaas] API key validation failed:", error);
    return false;
  }
}

console.log(
  `[Asaas] Initialized in ${isProduction ? "PRODUCTION" : "SANDBOX"} mode`
);
