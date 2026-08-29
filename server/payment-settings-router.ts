import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { validateAsaasApiKey, type AsaasEnvironment } from "./_core/asaas";
import { encryptSecret } from "./_core/secret-vault";
import * as db from "./db";

type StoredSetting = Awaited<ReturnType<typeof db.getPaymentSetting>>;
type PaymentSettingsDependencies = {
  get: () => Promise<StoredSetting>;
  save: typeof db.savePaymentSetting;
  validate: (apiKey: string, environment: AsaasEnvironment) => Promise<boolean>;
  encrypt: (value: string) => string;
};

const defaultDependencies: PaymentSettingsDependencies = {
  get: db.getPaymentSetting,
  save: db.savePaymentSetting,
  validate: (apiKey, environment) =>
    validateAsaasApiKey({ apiKey, environment }),
  encrypt: encryptSecret,
};

const credentialsSchema = z.object({
  apiKey: z.string().trim().min(1, "A chave de API é obrigatória"),
  webhookToken: z.string().trim().optional(),
  environment: z.enum(["sandbox", "production"]),
});

export function createPaymentSettingsRouter(
  deps: PaymentSettingsDependencies = defaultDependencies
) {
  return router({
    status: adminProcedure.query(async () => {
      const setting = await deps.get();
      return {
        configured: Boolean(setting?.asaasApiKeyEncrypted),
        environment:
          setting?.asaasEnvironment === "production"
            ? ("production" as const)
            : ("sandbox" as const),
        active: Boolean(setting?.isActive),
      };
    }),
    validate: adminProcedure
      .input(credentialsSchema.pick({ apiKey: true, environment: true }))
      .mutation(async ({ input }) => ({
        valid: await deps.validate(input.apiKey, input.environment),
      })),
    save: adminProcedure
      .input(credentialsSchema)
      .mutation(async ({ input }) => {
        if (!(await deps.validate(input.apiKey, input.environment))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Credencial Asaas inválida",
          });
        }
        await deps.save({
          provider: "asaas",
          asaasApiKeyEncrypted: deps.encrypt(input.apiKey),
          asaasWebhookTokenEncrypted: input.webhookToken
            ? deps.encrypt(input.webhookToken)
            : null,
          asaasEnvironment: input.environment,
          isActive: true,
        });
        return { success: true } as const;
      }),
  });
}

export const paymentSettingsRouter = createPaymentSettingsRouter();
