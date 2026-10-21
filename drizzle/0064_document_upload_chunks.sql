-- Partes temporárias para documentos de até 20 MiB, sempre vinculadas ao usuário e item.
CREATE TABLE IF NOT EXISTS document_upload_chunks (
  upload_id varchar(64) NOT NULL,
  part integer NOT NULL CHECK (part BETWEEN 0 AND 19),
  total integer NOT NULL CHECK (total BETWEEN 1 AND 20),
  user_id integer NOT NULL,
  scope varchar(150) NOT NULL,
  file_name varchar(255) NOT NULL,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, part)
);
CREATE INDEX IF NOT EXISTS document_upload_chunks_expiry_idx ON document_upload_chunks(created_at);
