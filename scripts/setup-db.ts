/**
 * Cria todas as tabelas no banco Neon via HTTP e cria o usuário admin.
 */
import "dotenv/config";
import { createHmac, randomBytes } from "crypto";
import { neon } from "@neondatabase/serverless";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌  DATABASE_URL não definida.");
    process.exit(1);
  }

  console.log("🔗  Conectando ao Neon...");
  const sql = neon(connectionString);

  console.log("🏗️   Criando tabelas...");

  // Enums
  await sql`CREATE TYPE IF NOT EXISTS user_role AS ENUM ('user', 'admin')`;
  await sql`CREATE TYPE IF NOT EXISTS draw_status AS ENUM ('active', 'closed', 'drawn')`;
  await sql`CREATE TYPE IF NOT EXISTS ticket_payment_status AS ENUM ('pending', 'confirmed', 'failed')`;
  await sql`CREATE TYPE IF NOT EXISTS utef_transaction_type AS ENUM ('prize', 'conversion', 'adjustment', 'purchase')`;
  await sql`CREATE TYPE IF NOT EXISTS product_category AS ENUM ('real_estate', 'financial', 'nautical')`;
  await sql`CREATE TYPE IF NOT EXISTS product_status AS ENUM ('available', 'unavailable')`;
  await sql`CREATE TYPE IF NOT EXISTS product_conversion_status AS ENUM ('pending', 'completed', 'cancelled')`;
  await sql`CREATE TYPE IF NOT EXISTS contractor_status AS ENUM ('active', 'inactive')`;
  await sql`CREATE TYPE IF NOT EXISTS construction_project_status AS ENUM ('planning','alvara','art','assinatura_cef','vistoria_cef','laudo_ok','cartorio','in_progress','casa_pronta','disponivel','reavaliar','distrato','paused','completed','cancelled')`;
  await sql`CREATE TYPE IF NOT EXISTS construction_stage_status AS ENUM ('pending', 'in_progress', 'completed')`;
  await sql`CREATE TYPE IF NOT EXISTS budget_request_has_lot AS ENUM ('yes', 'no', 'not_sure')`;
  await sql`CREATE TYPE IF NOT EXISTS budget_request_status AS ENUM ('pending', 'contacted', 'in_negotiation', 'converted', 'cancelled')`;
  await sql`CREATE TYPE IF NOT EXISTS email_template_type AS ENUM ('welcome','budget_confirmation','budget_update','draw_winner','promotional_campaign','payment_confirmation')`;
  await sql`CREATE TYPE IF NOT EXISTS email_status AS ENUM ('pending', 'sent', 'failed')`;
  await sql`CREATE TYPE IF NOT EXISTS notification_type AS ENUM ('draw_result','utef_update','construction_update','system','promotional')`;
  await sql`CREATE TYPE IF NOT EXISTS obra_measurement_status AS ENUM ('pending', 'approved', 'paid')`;
  await sql`CREATE TYPE IF NOT EXISTS lot_status AS ENUM ('available', 'reserved', 'sold')`;
  await sql`CREATE TYPE IF NOT EXISTS investor_status AS ENUM ('active', 'withdrawn', 'extended')`;
  await sql`CREATE TYPE IF NOT EXISTS investor_transaction_type AS ENUM ('deposit', 'withdrawal', 'interest', 'extension')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_type AS ENUM ('new_lead','in_process','broker','employee','supplier','vip')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_temperature AS ENUM ('cold', 'warm', 'hot')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_stage AS ENUM ('lead_new','attending','waiting_docs','analysis','caixa_register','approval','approved','rejected','followup','in_process','done')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_responsible AS ENUM ('sarah', 'vinicius', 'bianca')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_income_type AS ENUM ('formal', 'informal', 'irpf')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_cpf_status AS ENUM ('clean', 'restricted', 'unknown')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_contract_type AS ENUM ('obra', 'financing', 'both')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_activity_type AS ENUM ('message','call','document','status_change','note','handoff','follow_up','simulation','caixa_register')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_doc_type AS ENUM ('rg','cnh','address_proof','income_proof_formal','income_proof_irpf','fgts','spouse_docs','pis','other')`;
  await sql`CREATE TYPE IF NOT EXISTS lead_doc_status AS ENUM ('pending', 'received', 'approved', 'rejected')`;
  await sql`CREATE TYPE IF NOT EXISTS follow_up_status AS ENUM ('pending', 'sent', 'responded', 'failed', 'cancelled')`;
  await sql`CREATE TYPE IF NOT EXISTS task_related_type AS ENUM ('lead', 'obra', 'budget', 'financial', 'general')`;
  await sql`CREATE TYPE IF NOT EXISTS task_priority AS ENUM ('low', 'medium', 'high', 'critical')`;
  await sql`CREATE TYPE IF NOT EXISTS task_status AS ENUM ('pending', 'in_progress', 'done', 'cancelled')`;
  await sql`CREATE TYPE IF NOT EXISTS partner_reference_type AS ENUM ('obra', 'financial', 'other')`;
  await sql`CREATE TYPE IF NOT EXISTS partner_distribution_status AS ENUM ('pending', 'paid')`;
  await sql`CREATE TYPE IF NOT EXISTS financial_transaction_type AS ENUM ('income','expense','commission','salary','contractor_payment')`;

  console.log("✅  Enums criados");

  // Tabelas
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      "openId" VARCHAR(320) NOT NULL UNIQUE,
      "passwordHash" VARCHAR(128),
      name TEXT,
      email VARCHAR(320),
      cpf VARCHAR(14),
      phone VARCHAR(20),
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(2),
      "zipCode" VARCHAR(10),
      "avatarUrl" TEXT,
      "loginMethod" VARCHAR(64),
      role user_role NOT NULL DEFAULT 'user',
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "lastSignedIn" TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS draws (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      prize_amount INTEGER NOT NULL,
      ticket_price INTEGER NOT NULL,
      target_amount INTEGER NOT NULL,
      current_amount INTEGER NOT NULL DEFAULT 0,
      tickets_sold INTEGER NOT NULL DEFAULT 0,
      status draw_status NOT NULL DEFAULT 'active',
      draw_date TIMESTAMP,
      winner_user_id INTEGER,
      lottery_result VARCHAR(10),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      draw_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      ticket_number VARCHAR(50) NOT NULL UNIQUE,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_paid INTEGER NOT NULL,
      payment_status ticket_payment_status NOT NULL DEFAULT 'pending',
      payment_method VARCHAR(50) DEFAULT 'pix',
      pix_qr_code TEXT,
      pix_copy_paste TEXT,
      stripe_payment_intent_id VARCHAR(255),
      stripe_checkout_session_id VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS utef_balances (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS utef_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      type utef_transaction_type NOT NULL,
      description TEXT,
      related_id INTEGER,
      reference_id VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      category product_category NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      price_utef INTEGER NOT NULL,
      image_url TEXT,
      details TEXT,
      status product_status NOT NULL DEFAULT 'available',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS product_conversions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      utef_amount INTEGER NOT NULL,
      status product_conversion_status NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS contractors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(20),
      city VARCHAR(100),
      state VARCHAR(2),
      specialties TEXT,
      contract_type VARCHAR(100),
      status contractor_status NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS construction_projects (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      contractor_id INTEGER,
      title VARCHAR(255) NOT NULL,
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(2),
      project_type VARCHAR(100),
      total_area INTEGER,
      status construction_project_status NOT NULL DEFAULT 'planning',
      progress INTEGER NOT NULL DEFAULT 0,
      vgv DECIMAL(15,2),
      financed_amount DECIMAL(15,2),
      fgts_amount DECIMAL(15,2),
      subsidy_amount DECIMAL(15,2),
      down_payment_total DECIMAL(15,2),
      down_payment_paid DECIMAL(15,2),
      pls_percentage DECIMAL(7,4),
      real_received_pct DECIMAL(7,4),
      cef_received_amount DECIMAL(15,2),
      construction_spent DECIMAL(15,2),
      lot_cost DECIMAL(15,2),
      broker_name VARCHAR(255),
      broker_paid DECIMAL(15,2) DEFAULT 0,
      construction_cost DECIMAL(15,2),
      estimated_profit DECIMAL(15,2),
      investor_profit DECIMAL(15,2),
      prospecta_profit DECIMAL(15,2),
      pro_soluto DECIMAL(15,2) DEFAULT 0,
      installment_rate DECIMAL(7,4),
      installment_qty INTEGER,
      installment_value DECIMAL(15,2),
      start_date TIMESTAMP,
      construction_days INTEGER,
      estimated_end_date TIMESTAMP,
      actual_end_date TIMESTAMP,
      contract_value DECIMAL(15,2),
      contract_type VARCHAR(100),
      notes TEXT,
      extra_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS construction_stages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      order_index INTEGER NOT NULL,
      status construction_stage_status NOT NULL DEFAULT 'pending',
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      estimated_cost INTEGER,
      actual_cost INTEGER,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS construction_photos (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      stage_id INTEGER,
      image_url TEXT NOT NULL,
      caption TEXT,
      taken_at TIMESTAMP NOT NULL,
      uploaded_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS project_budget_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(320) NOT NULL,
      phone VARCHAR(20),
      city VARCHAR(255),
      project_type VARCHAR(100),
      has_lot budget_request_has_lot,
      message TEXT,
      status budget_request_status NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_logs (
      id SERIAL PRIMARY KEY,
      recipient_email VARCHAR(320) NOT NULL,
      recipient_name VARCHAR(255),
      subject VARCHAR(500) NOT NULL,
      template_type email_template_type NOT NULL,
      html_content TEXT NOT NULL,
      status email_status NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMP,
      error_message TEXT,
      metadata TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type notification_type NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      related_id INTEGER,
      action_url VARCHAR(500),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      read_at TIMESTAMP
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS obra_fees (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      fee_type VARCHAR(100) NOT NULL,
      estimated_value DECIMAL(15,2) DEFAULT 0,
      paid_value DECIMAL(15,2) DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS obra_measurements (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      contractor_id INTEGER,
      stage_id INTEGER,
      measurement_date TIMESTAMP NOT NULL,
      value DECIMAL(15,2) NOT NULL,
      status obra_measurement_status NOT NULL DEFAULT 'pending',
      notes TEXT,
      approved_by INTEGER,
      approved_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS lots (
      id SERIAL PRIMARY KEY,
      lot_number VARCHAR(50) NOT NULL,
      development VARCHAR(255) NOT NULL,
      city VARCHAR(100),
      state VARCHAR(2),
      assessment_value DECIMAL(15,2),
      cef_payment_value DECIMAL(15,2),
      seller_cost DECIMAL(15,2),
      seller_name VARCHAR(255),
      prospecta_margin DECIMAL(15,2),
      status lot_status NOT NULL DEFAULT 'available',
      assigned_project_id INTEGER,
      assigned_client_name VARCHAR(255),
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS investors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      initial_date TIMESTAMP NOT NULL,
      initial_amount DECIMAL(15,2) NOT NULL,
      current_balance DECIMAL(15,2) NOT NULL,
      monthly_rate DECIMAL(7,4) DEFAULT 0,
      status investor_status NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS investor_transactions (
      id SERIAL PRIMARY KEY,
      investor_id INTEGER NOT NULL,
      type investor_transaction_type NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      date TIMESTAMP NOT NULL,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS broker_commissions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER,
      client_name VARCHAR(255) NOT NULL,
      broker_name VARCHAR(255) NOT NULL,
      total_commission DECIMAL(15,2) NOT NULL,
      installment1_value DECIMAL(15,2) DEFAULT 0,
      installment1_paid DECIMAL(15,2) DEFAULT 0,
      installment2_value DECIMAL(15,2) DEFAULT 0,
      installment2_paid DECIMAL(15,2) DEFAULT 0,
      installment3_value DECIMAL(15,2) DEFAULT 0,
      installment3_paid DECIMAL(15,2) DEFAULT 0,
      installment4_value DECIMAL(15,2) DEFAULT 0,
      installment4_paid DECIMAL(15,2) DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      email VARCHAR(320),
      city VARCHAR(100),
      state VARCHAR(2),
      type lead_type NOT NULL DEFAULT 'new_lead',
      temperature lead_temperature NOT NULL DEFAULT 'cold',
      stage lead_stage NOT NULL DEFAULT 'lead_new',
      responsible lead_responsible NOT NULL DEFAULT 'sarah',
      income DECIMAL(15,2),
      income_type lead_income_type,
      fgts_amount DECIMAL(15,2),
      pis_fgts VARCHAR(20),
      has_spouse BOOLEAN DEFAULT FALSE,
      spouse_name VARCHAR(255),
      income_composition BOOLEAN DEFAULT FALSE,
      cpf_status lead_cpf_status DEFAULT 'unknown',
      simulation_value DECIMAL(15,2),
      approved_value DECIMAL(15,2),
      contract_type lead_contract_type,
      source_channel VARCHAR(100),
      source_city VARCHAR(100),
      lgpd_consent BOOLEAN DEFAULT FALSE,
      lgpd_consent_at TIMESTAMP,
      rejection_reason TEXT,
      followup_date TIMESTAMP,
      notes TEXT,
      admin_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      type lead_activity_type NOT NULL,
      description TEXT NOT NULL,
      performed_by VARCHAR(100),
      metadata TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS lead_documents (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      type lead_doc_type NOT NULL,
      file_name VARCHAR(255),
      file_url TEXT,
      status lead_doc_status NOT NULL DEFAULT 'pending',
      notes TEXT,
      uploaded_at TIMESTAMP,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS lead_follow_ups (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      sub_attempt INTEGER NOT NULL,
      scheduled_at TIMESTAMP NOT NULL,
      executed_at TIMESTAMP,
      status follow_up_status NOT NULL DEFAULT 'pending',
      message TEXT,
      response TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      assigned_to VARCHAR(100) NOT NULL,
      related_type task_related_type,
      related_id INTEGER,
      priority task_priority NOT NULL DEFAULT 'medium',
      status task_status NOT NULL DEFAULT 'pending',
      sla_hours INTEGER DEFAULT 24,
      due_at TIMESTAMP,
      completed_at TIMESTAMP,
      escalated_to_vinicius BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS partner_distributions (
      id SERIAL PRIMARY KEY,
      partner_name VARCHAR(255) NOT NULL,
      reference_type partner_reference_type NOT NULL,
      reference_id INTEGER,
      reference_description VARCHAR(255),
      percentage DECIMAL(5,2) NOT NULL,
      gross_amount DECIMAL(15,2) NOT NULL,
      distribution_amount DECIMAL(15,2) NOT NULL,
      status partner_distribution_status NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS financial_transactions (
      id SERIAL PRIMARY KEY,
      type financial_transaction_type NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      description VARCHAR(500) NOT NULL,
      category VARCHAR(100),
      responsible VARCHAR(100),
      reference_id INTEGER,
      reference_type VARCHAR(50),
      paid_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  console.log("✅  Todas as tabelas criadas!");

  // Criar usuário admin
  console.log("\n👤  Criando usuário admin...");
  const adminEmail = "vinicius@vfxcapital.com.br";
  const adminPassword = "Prospecta@2025";

  const existing = await sql`SELECT id FROM users WHERE email = ${adminEmail} LIMIT 1`;

  if (existing.length > 0) {
    console.log(`ℹ️   Admin já existe: ${adminEmail}`);
  } else {
    const passwordHash = hashPassword(adminPassword);
    await sql`
      INSERT INTO users ("openId", "passwordHash", name, email, role, "loginMethod", "lastSignedIn")
      VALUES (${adminEmail}, ${passwordHash}, ${'Vinicius Admin'}, ${adminEmail}, 'admin', 'email', NOW())
    `;
    console.log(`✅  Admin criado!`);
    console.log(`    Email: ${adminEmail}`);
    console.log(`    Senha: ${adminPassword}`);
  }

  console.log("\n🎉  Tudo pronto! Acesse /login no seu site para entrar.");
}

main().catch((err) => {
  console.error("❌  Erro:", err.message ?? err);
  process.exit(1);
});
