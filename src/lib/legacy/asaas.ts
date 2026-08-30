import { legacyPaymentEnv as ENV } from "./payment-secrets";
import { getPaymentSetting } from "./repository";
import { decryptSecret } from "./payment-secrets";

const ASAAS_URLS = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  production: "https://api.asaas.com/v3",
} as const;

export type AsaasEnvironment = keyof typeof ASAAS_URLS;
export type AsaasFetch = typeof fetch;
export type AsaasClientConfig = {
  apiKey: string;
  environment: AsaasEnvironment;
  fetchImpl?: AsaasFetch;
};

export class AsaasConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsaasConfigurationError";
  }
}

export class AsaasApiError extends Error {
  constructor(message = "Não foi possível concluir a operação no Asaas") {
    super(message);
    this.name = "AsaasApiError";
  }
}

export function validateAsaasConfiguration(config: AsaasClientConfig): void {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new AsaasConfigurationError("ASAAS_API_KEY não está configurada");
  }
  if (config.environment === "production" && apiKey.startsWith("$aact_test")) {
    throw new AsaasConfigurationError(
      "Uma chave de teste não pode ser usada em produção"
    );
  }
  if (config.environment === "sandbox" && apiKey.startsWith("$aact_prod")) {
    throw new AsaasConfigurationError(
      "Uma chave de produção não pode ser usada no sandbox"
    );
  }
}

async function readDefaultConfig(): Promise<AsaasClientConfig> {
  const environment = ENV.asaasEnvironment;
  if (environment !== "sandbox" && environment !== "production") {
    throw new AsaasConfigurationError(
      "ASAAS_ENVIRONMENT deve ser sandbox ou production"
    );
  }
  if (ENV.asaasApiKey) return { apiKey: ENV.asaasApiKey, environment };

  try {
    const saved = await getPaymentSetting();
    if (saved?.isActive && saved.asaasApiKeyEncrypted) {
      const savedEnvironment =
        saved.asaasEnvironment === "production" ? "production" : "sandbox";
      return {
        apiKey: decryptSecret(saved.asaasApiKeyEncrypted),
        environment: savedEnvironment,
      };
    }
  } catch {
    // Normalize missing database/configuration into the safe error below.
  }
  throw new AsaasConfigurationError("ASAAS_API_KEY não está configurada");
}

export function createAsaasClient(config: AsaasClientConfig) {
  async function request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    validateAsaasConfiguration(config);
    const response = await (config.fetchImpl ?? fetch)(
      `${ASAAS_URLS[config.environment]}${endpoint}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
          access_token: config.apiKey.trim(),
          ...options.headers,
        },
      }
    );

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AsaasApiError("O Asaas retornou uma resposta inválida");
    }
    if (!response.ok) {
      const description =
        typeof data === "object" && data !== null && "errors" in data
          ? (data as { errors?: Array<{ description?: string }> }).errors?.[0]
              ?.description
          : undefined;
      throw new AsaasApiError(description || undefined);
    }
    return data as T;
  }

  return { request };
}

async function asaasRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return createAsaasClient(await readDefaultConfig()).request<T>(
    endpoint,
    options
  );
}
export type AsaasBillingType = "UNDEFINED" | "BOLETO" | "CREDIT_CARD" | "PIX";
export type AsaasPaymentStatus =
  | "PENDING"
  | "RECEIVED"
  | "CONFIRMED"
  | "OVERDUE"
  | "REFUNDED"
  | "RECEIVED_IN_CASH"
  | "REFUND_REQUESTED"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
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
export async function validateAsaasApiKey(
  config?: AsaasClientConfig
): Promise<boolean> {
  try {
    const request = config ? createAsaasClient(config).request : asaasRequest;
    await request<{ data: AsaasCustomer[] }>("/customers?limit=1");
    return true;
  } catch {
    return false;
  }
}
