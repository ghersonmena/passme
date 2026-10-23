# Cambios

## v0.1.1

- Nueva identidad visual: paleta Ciruela en tema claro y oscuro
- Nuevo logo: la Llave P, en el ícono de la app, la pestaña y la PWA

## v0.1.0

Primera versión.

- Cuentas zero-knowledge: Argon2id + AES-256-GCM en el navegador
- Frase de recuperación de 24 palabras (BIP39) para restablecer la contraseña maestra
- Verificación en dos pasos (TOTP) con 10 códigos de respaldo
- Inicios de sesión con usuario, contraseña, sitios, nota, favoritos y papelera
- Generador de contraseñas y frases
- Bloqueo automático configurable y portapapeles que se vacía a los 30 s
- Cambio de contraseña maestra
- Multiusuario con registro abierto o cerrado; la primera cuenta es la del administrador
- Interfaz en español e inglés, PWA instalable
- Docker: nginx con HTTPS en el 4040, CSP estricta, API sin root y Postgres 17
