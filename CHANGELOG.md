# Cambios

## v0.1.2

- 14 tipos de elementos nuevos además de los inicios de sesión: nota segura, tarjeta de débito o
  crédito, identidad, credencial de API, base de datos, servidor, licencia de software, clave SSH,
  red Wi-Fi (con QR para conectarse), ubicación secreta (con enlace al mapa), cuenta bancaria,
  cartera de criptomonedas, registro médico y pasaporte
- Aviso de vencimiento en tarjetas, licencias, credenciales de API y pasaportes
- Campos personalizados (visibles u ocultos) en cualquier elemento
- Bóvedas personalizadas: crear, renombrar, elegir ícono y color, y eliminar
- Mover elementos entre bóvedas (se vuelven a cifrar con la llave de la bóveda destino)
- Filtro por tipo y búsqueda en todos los campos que no son secretos
- Los inicios de sesión de la v0.1 se convierten solos al nuevo formato

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
