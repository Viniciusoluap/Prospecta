ALTER TYPE "public"."email_template_type" ADD VALUE 'primeiro_acesso';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokenPrimeiroAcesso" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokenPrimeiroAcessoExpiraEm" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tokenPrimeiroAcesso_unique" UNIQUE("tokenPrimeiroAcesso");