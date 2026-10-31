-- CPF opcional do perfil profissional; não copia nem altera dados existentes.
ALTER TABLE engineer_profiles ADD COLUMN IF NOT EXISTS cpf varchar(14);
