CREATE TABLE IF NOT EXISTS "asaas_webhook_events" (
  "event_key" varchar(320) PRIMARY KEY NOT NULL,
  "status" varchar(20) DEFAULT 'processing' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
