# Despliegue

## Servidor con Docker

```sh
./scripts/setup.sh
docker compose up -d --build
docker compose logs -f api      # debe decir "Server listening"
```

Servicios:

| Contenedor   | Función                                | Expuesto                    |
|--------------|----------------------------------------|-----------------------------|
| `passme_web` | nginx: HTTPS, interfaz y proxy a la API | `PASSME_PORT` (4040) → 443 |
| `passme_api` | API Fastify, sin root, solo lectura    | solo red interna            |
| `passme_db`  | PostgreSQL 17                          | solo red interna            |

Para actualizar a una versión nueva:

```sh
git pull
docker compose up -d --build
```

Las migraciones de la base de datos se aplican solas al arrancar la API.

## Respaldos

Respalda lo siguiente:

- `.env`: contiene `SERVER_SECRET` y la contraseña de Postgres.
- La base de datos, por ejemplo con
  `docker exec passme_db pg_dump -U passme passme | gzip > passme-$(date +%F).sql.gz`.

Los datos van cifrados, pero el respaldo también contiene correos y metadatos: guárdalo en un
lugar seguro.

## Publicar con Cloudflare Quick Tunnels

Un Quick Tunnel da una URL pública `https://algo.trycloudflare.com` sin abrir puertos ni tener
dominio:

```sh
cloudflared tunnel --no-tls-verify --url https://localhost:4040
```

- `--no-tls-verify` hace falta porque el certificado local es autofirmado. El tramo entre
  Cloudflare y tu navegador usa un certificado válido de Cloudflare.
- Cloudflare termina el TLS, pero los datos de la bóveda ya van cifrados por PassMe. Lo que sí ve
  es tráfico de login (el `authKey`, no la contraseña), cookies y metadatos.
- **La URL cambia cada vez que se reinicia `cloudflared`.** Las sesiones abiertas y la PWA
  instalada quedan ligadas a la URL anterior: hay que volver a abrirla e instalarla. Cuando haya
  un dominio fijo conviene pasar a un túnel con nombre (`cloudflared tunnel create passme`).
- nginx toma la IP real de `CF-Connecting-IP` para el límite de intentos. Si el puerto 4040
  también es accesible desde la red local, alguien en esa red podría falsear ese encabezado; el
  bloqueo por cuenta (10 intentos) sigue aplicando igual.

### PWA y certificado

Los navegadores solo registran el service worker (que permite instalar la app y abrirla sin red)
con un certificado válido. A través del túnel funciona. Entrando directo a
`https://servidor:4040` con el certificado autofirmado, la app funciona pero no se instala.
