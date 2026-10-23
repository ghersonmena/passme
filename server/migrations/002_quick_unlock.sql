-- Desbloqueo rápido con PIN o patrón, ligado a una sesión (un dispositivo). El dispositivo guarda la
-- llave de usuario cifrada con su PIN y con quick_unlock_share; el servidor solo entrega esa mitad
-- si recibe el verificador correcto, con intentos limitados. Ver docs/CRYPTO.md.
ALTER TABLE sessions
  ADD COLUMN quick_unlock_hash      text,
  ADD COLUMN quick_unlock_share     text,
  ADD COLUMN quick_unlock_attempts  integer NOT NULL DEFAULT 0;
