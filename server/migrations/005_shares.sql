-- Compartir un elemento con otra persona (v0.4.1). La copia compartida va cifrada con una llave
-- propia (K) que el servidor nunca ve: la guarda cifrada para el dueño (con su llave de usuario) y
-- para quien la recibe (con su llave pública, o con el secreto del enlace + el PIN). Ver docs/CRYPTO.md.
CREATE TABLE shares (
  id               uuid PRIMARY KEY,
  owner_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Elemento de origen: al editarlo, la app del dueño vuelve a cifrar la copia compartida
  item_id          uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  -- user = otra cuenta de este servidor; link = enlace con PIN para alguien sin cuenta
  kind             text NOT NULL CHECK (kind IN ('user', 'link')),
  recipient_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  recipient_email  text NOT NULL,
  data             text NOT NULL,
  owner_key        text NOT NULL,
  recipient_key    text NOT NULL,
  -- Solo enlaces: Argon2id del PIN y scrypt del verificador (que también depende del secreto del enlace)
  pin_kdf          jsonb,
  pin_hash         text,
  attempts         integer NOT NULL DEFAULT 0,
  views            integer NOT NULL DEFAULT 0,
  seen_at          timestamptz,
  last_viewed_at   timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'user') = (recipient_id IS NOT NULL)),
  CHECK (kind = 'user' OR (pin_kdf IS NOT NULL AND pin_hash IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX shares_owner_idx ON shares(owner_id);
CREATE INDEX shares_recipient_idx ON shares(recipient_id);
CREATE INDEX shares_item_idx ON shares(item_id);
-- Un elemento se comparte una sola vez con cada cuenta: volver a compartirlo reemplaza la copia
CREATE UNIQUE INDEX shares_item_user_idx ON shares(item_id, recipient_id) WHERE kind = 'user';
