CREATE TABLE IF NOT EXISTS "payment_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider" varchar(50) DEFAULT 'asaas' NOT NULL,
  "asaas_api_key_encrypted" text NOT NULL,
  "asaas_webhook_token_encrypted" text,
  "asaas_environment" varchar(20) DEFAULT 'sandbox' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
