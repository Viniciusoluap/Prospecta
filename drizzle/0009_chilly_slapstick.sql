CREATE TABLE "whatsapp_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(20) DEFAULT 'business' NOT NULL,
	"token_encrypted" text,
	"phone_number_id" varchar(60),
	"numero" varchar(30),
	"status" varchar(20) DEFAULT 'desconectado' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"lead_id" integer,
	"destinatario" varchar(30) NOT NULL,
	"nome_destinatario" varchar(255),
	"mensagem" text NOT NULL,
	"status" varchar(20) DEFAULT 'enviada' NOT NULL,
	"external_id" varchar(120),
	"erro_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
