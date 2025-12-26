-- Tabela para armazenar configurações de pagamento
CREATE TABLE IF NOT EXISTS payment_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL DEFAULT 'asaas', -- 'asaas' ou 'stripe'
  asaas_api_key TEXT,
  asaas_webhook_token VARCHAR(255),
  asaas_environment VARCHAR(20) DEFAULT 'production', -- 'production' ou 'sandbox'
  stripe_secret_key TEXT,
  stripe_publishable_key TEXT,
  stripe_webhook_secret TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Inserir configuração padrão
INSERT INTO payment_settings (provider, asaas_environment) 
VALUES ('asaas', 'production')
ON DUPLICATE KEY UPDATE provider = provider;
