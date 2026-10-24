-- El desbloqueo rápido pasa de estar ligado a la sesión a estar ligado al dispositivo: sobrevive al
-- cerrar sesión. Para usarlo sigue haciendo falta una sesión abierta (que pide la contraseña y el
-- 2FA), así que un dispositivo robado sin sesión no sirve. Ver docs/CRYPTO.md.
ALTER TABLE sessions
  DROP COLUMN quick_unlock_hash,
  DROP COLUMN quick_unlock_share,
  DROP COLUMN quick_unlock_attempts;

CREATE TABLE quick_unlock_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- scrypt del verificador derivado del PIN o patrón (con una sal que solo tiene el dispositivo)
  verifier_hash  text NOT NULL,
  -- Mitad de la llave que guarda el servidor, cifrada con SERVER_SECRET
  share          text NOT NULL,
  attempts       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);
CREATE INDEX quick_unlock_devices_user_idx ON quick_unlock_devices(user_id);
