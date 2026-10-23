#!/bin/sh
# Si no hay certificado en /etc/nginx/certs, genera uno autofirmado para que el contenedor arranque.
# Para un certificado real, coloca fullchain.crt y privkey.key en ./certs y reinicia.
set -e
CERTS=/etc/nginx/certs
if [ ! -f "$CERTS/fullchain.crt" ] || [ ! -f "$CERTS/privkey.key" ]; then
  echo "PassMe: no hay certificado, generando uno autofirmado en $CERTS"
  mkdir -p "$CERTS"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
    -keyout "$CERTS/privkey.key" -out "$CERTS/fullchain.crt" \
    -subj "/CN=${PASSME_CERT_CN:-passme.local}" \
    -addext "subjectAltName=DNS:${PASSME_CERT_CN:-passme.local},DNS:localhost,IP:127.0.0.1" 2>/dev/null
  chmod 600 "$CERTS/privkey.key"
fi
