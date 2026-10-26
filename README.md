# PassMe

Gestor de contraseñas **zero-knowledge** y autoalojado, instalable como PWA. Tus datos se cifran
en tu dispositivo antes de salir de él: el servidor solo guarda texto cifrado y nunca ve tu
contraseña maestra.

*Self-hosted, zero-knowledge password manager (PWA). Spanish and English UI.*

## Qué incluye (v0.1.2)

- Cuentas con contraseña maestra (Argon2id) y **frase de recuperación de 24 palabras**
- Verificación en dos pasos (TOTP) con 10 códigos de respaldo
- 15 tipos de elementos: inicios de sesión, notas seguras, tarjetas, identidades, credenciales de
  API, bases de datos, servidores, licencias de software, claves SSH, redes Wi-Fi, ubicaciones
  secretas, cuentas bancarias, carteras de criptomonedas, registros médicos y pasaportes
- Campos personalizados, favoritos y papelera en cualquier elemento
- Varias bóvedas por cuenta, cada una con su nombre, ícono, color y llave propia
- Generador de contraseñas y de frases
- Importar desde Proton Pass, Passbolt, Bitwarden, 1Password, LastPass, KeePass(XC), Dashlane,
  NordPass y navegadores; exportar a PassMe, Bitwarden (JSON o CSV) y CSV de navegador
- Bloqueo automático configurable (5 min por defecto) y portapapeles que se vacía a los 30 s
- Varios usuarios por servidor: registro abierto o solo por invitación del administrador, con el
  enlace enviado por correo
- Interfaz en español e inglés, instalable en el teléfono

Próximas versiones: códigos TOTP por elemento, monitor de seguridad, bóvedas compartidas y
passkeys.

## Seguridad en breve

- Cifrado de extremo a extremo con AES-256-GCM. Las llaves se derivan en el navegador.
- El servidor no puede leer tus datos aunque lo administres tú o alguien copie la base de datos.
- Si olvidas la contraseña maestra, solo la frase de recuperación te devuelve el acceso. Si pierdes
  las dos, **nadie** puede recuperar los datos.

Detalles en [docs/CRYPTO.md](docs/CRYPTO.md) y [SECURITY.md](SECURITY.md).

## Instalación con Docker

Necesitas Docker con Compose.

```sh
git clone https://github.com/ghersonmena/passme.git
cd passme
./scripts/setup.sh          # crea .env con secretos aleatorios
nano .env                   # revisa REGISTRATION y PASSME_PORT
docker compose up -d --build
```

La app queda en `https://<tu-servidor>:4040`. Si `./certs` está vacío se genera un certificado
autofirmado; para uno real coloca `fullchain.crt` y `privkey.key` en `./certs` y reinicia el
contenedor `web`.

La primera cuenta que se crea es la del administrador. Desde **Ajustes → Usuarios e invitaciones**
elige si el registro es abierto o solo por invitación, e invita por correo (configura `SMTP_*` en
`.env`; sin correo, la app te da el enlace para compartirlo).

> **Importante:** respalda `.env` (contiene `SERVER_SECRET`) y la carpeta `data/`. Sin
> `SERVER_SECRET`, quienes tengan 2FA tendrán que entrar con sus códigos de respaldo.

Para publicarla en internet sin abrir puertos, consulta [docs/DEPLOY.md](docs/DEPLOY.md).

## Desarrollo

```sh
npm install
cp .env.dev.example .env.dev
npm run dev:db        # Postgres en el puerto 5433
npm run dev:server    # API en el puerto 3000
npm run dev:client    # app en http://localhost:5174
```

Pruebas:

```sh
npm test -w client
TEST_DATABASE_URL=postgres://passme:passme-dev@localhost:5433/passme_test npm test -w server
```

La prueba del servidor **borra** la base de datos que le indiques. Créala aparte con
`docker exec passme_dev_db psql -U passme -c "CREATE DATABASE passme_test"`.

## Licencia

[GNU AGPL-3.0](LICENSE). Si ofreces una versión modificada de PassMe como servicio, debes publicar
su código.
