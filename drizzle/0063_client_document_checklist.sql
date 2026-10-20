-- Aditiva: documentos/checklists antigos não são apagados.
ALTER TYPE lead_doc_type ADD VALUE IF NOT EXISTS 'spouse_income_proof';
ALTER TYPE lead_doc_type ADD VALUE IF NOT EXISTS 'birth_marriage_certificate';
CREATE TABLE IF NOT EXISTS lead_document_preferences (
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type varchar(60) NOT NULL,
  visible_to_client boolean NOT NULL DEFAULT true,
  PRIMARY KEY (lead_id, type)
);
INSERT INTO financiamento_checklist_items (financiamento_id, grupo, item)
SELECT f.id, 'Financiamento e imóvel', labels.item
FROM financiamentos f CROSS JOIN (VALUES
  ('Certidão de inteiro teor'),
  ('ART'),
  ('Alvará'),
  ('Memorial descritivo'),
  ('Habite-se'),
  ('Projeto aprovado'),
  ('Conta de água'),
  ('PCI em PDF'),
  ('PCI em XLS'),
  ('PLS'),
  ('CNO e CND'),
  ('Outros')
) AS labels(item)
WHERE NOT EXISTS (SELECT 1 FROM financiamento_checklist_items c WHERE c.financiamento_id = f.id AND c.item = labels.item);
