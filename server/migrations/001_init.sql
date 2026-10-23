-- Esquema inicial. El servidor nunca ve datos en claro: todo lo que termina en _key, data o
-- protected_* es texto cifrado en el navegador (ver docs/CRYPTO.md).

CREATE TABLE users (
  id                          uuid PRIMARY KEY,
  email                       text NOT NULL UNIQUE,
  -- Parámetros de Argon2id con los que el cliente deriva su llave maestra
  kdf_salt                    text NOT NULL,
  kdf_params                  jsonb NOT NULL,
  -- scrypt(authKey): el authKey ya es una derivación de la contraseña maestra, nunca la contraseña
  auth_hash                   text NOT NULL,
  -- Llave de usuario cifrada con la llave maestra
  protected_user_key          text NOT NULL,
  -- La misma llave de usuario cifrada con la frase de recuperación
  recovery_auth_hash          text NOT NULL,
  recovery_protected_user_key text NOT NULL,
  -- Par de llaves para compartir bóvedas: la privada va cifrada con la llave de usuario
  public_key                  text NOT NULL,
  protected_private_key       text NOT NULL,
  -- Secreto TOTP del inicio de sesión, cifrado con la llave del servidor
  totp_secret                 text,
  totp_enabled                boolean NOT NULL DEFAULT false,
  totp_last_counter           bigint NOT NULL DEFAULT 0,
  is_admin                    boolean NOT NULL DEFAULT false,
  failed_logins               integer NOT NULL DEFAULT 0,
  locked_until                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- kind: full = sesión normal, mfa = falta el código TOTP, recovery = restableciendo la contraseña
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('full', 'mfa', 'recovery')),
  attempts      integer NOT NULL DEFAULT 0,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE totp_backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  bytea NOT NULL,
  used_at    timestamptz
);
CREATE INDEX totp_backup_codes_user_idx ON totp_backup_codes(user_id);

CREATE TABLE vaults (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nombre y apariencia, cifrados con la llave de la bóveda
  data        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Cada miembro guarda su propia copia de la llave de la bóveda, cifrada para él
CREATE TABLE vault_members (
  vault_id             uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  protected_vault_key  text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('owner', 'manager', 'editor', 'viewer')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vault_id, user_id)
);
CREATE INDEX vault_members_user_idx ON vault_members(user_id);

CREATE TABLE items (
  id          uuid PRIMARY KEY,
  vault_id    uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  data        text NOT NULL,
  revision    integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  trashed_at  timestamptz
);
CREATE INDEX items_vault_idx ON items(vault_id);
