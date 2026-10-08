CREATE TABLE IF NOT EXISTS "tax_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_name" varchar(255) NOT NULL,
  "cnpj" varchar(20),
  "regime" varchar(40) NOT NULL,
  "estimated_rate" numeric(7,4) DEFAULT '0' NOT NULL,
  "effective_from" timestamp NOT NULL,
  "effective_to" timestamp,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tax_obligations" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer REFERENCES "tax_profiles"("id") ON DELETE set null,
  "name" varchar(255) NOT NULL,
  "competency" varchar(7) NOT NULL,
  "due_date" timestamp NOT NULL,
  "estimated_amount" numeric(15,2) DEFAULT '0' NOT NULL,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "paid_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ret_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer REFERENCES "tax_profiles"("id") ON DELETE set null,
  "name" varchar(255) NOT NULL,
  "cnpj" varchar(20),
  "registration_number" varchar(120),
  "affected_assets" boolean DEFAULT false NOT NULL,
  "status" varchar(30) DEFAULT 'analysis' NOT NULL,
  "ret_rate" numeric(7,4) DEFAULT '4' NOT NULL,
  "effective_from" timestamp,
  "effective_to" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
