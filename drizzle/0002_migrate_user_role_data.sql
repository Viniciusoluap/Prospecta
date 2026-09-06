-- EPIC-009 S-01: migra usuários existentes com role='user' para role='cliente'
-- IMPORTANTE: precisa rodar em transação/sessão separada da migration 0001
-- (ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em que foi adicionado)
UPDATE "users" SET role = 'cliente' WHERE role = 'user';
