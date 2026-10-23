#!/bin/sh
# Crea .env con secretos aleatorios si no existe. No toca un .env ya creado.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env ya existe; no se modifica."
  exit 0
fi
umask 077
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
  -e "s|^SERVER_SECRET=.*|SERVER_SECRET=$(openssl rand -base64 32)|" \
  .env.example > .env
mkdir -p data certs
echo ".env creado. Revisa REGISTRATION y PASSME_PORT, luego: docker compose up -d --build"
