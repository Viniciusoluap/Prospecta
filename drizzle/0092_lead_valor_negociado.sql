-- Valor comercial informado no CRM; não derivar de VGV simulado ou financiamento.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS negotiated_value numeric(15,2);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='leads'::regclass AND conname='leads_negotiated_value_nonnegative') THEN
  ALTER TABLE leads ADD CONSTRAINT leads_negotiated_value_nonnegative CHECK (negotiated_value IS NULL OR negotiated_value >= 0);
 END IF;
END $$;
