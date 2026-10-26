-- Ajustes del servidor que el administrador cambia desde la app (por ejemplo, el modo de registro).
-- Mientras no exista la fila, manda la variable de entorno.
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Invitaciones del administrador. El enlace lleva un token aleatorio; aquí solo queda su sha256.
CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
-- Una sola invitación pendiente por correo: reenviar reemplaza la anterior
CREATE UNIQUE INDEX invitations_pending_email ON invitations(email) WHERE used_at IS NULL;
