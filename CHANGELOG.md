# Cambios

## v0.1.8

- Deslizar un elemento de la lista hacia la derecha lo manda a la papelera, con un aviso para
  deshacer
- Deslizar hacia la izquierda lo marca como favorito, o se lo quita si ya lo era
- Funciona con el dedo y con el mouse; un deslizamiento corto o vertical no hace nada, y en la
  papelera o en bóvedas de solo lectura no se puede deslizar

## v0.1.7

- Importar desde Proton Pass (.zip o .json), Bitwarden (.json), y CSV de Passbolt, Bitwarden,
  LastPass, 1Password, KeePass(XC), Dashlane, NordPass, Chrome, Edge, Firefox y Safari: el formato
  se reconoce solo
- Al importar se respetan las carpetas (cada una va a una bóveda con su nombre, que se crea si no
  existe) o todo va a una sola bóveda; los que ya tienes se omiten
- Exportar a PassMe (copia completa), Bitwarden JSON (para Proton Pass, Bitwarden, 1Password…), CSV
  de Bitwarden (para Passbolt, KeePassXC…) y CSV de navegador; pide la contraseña maestra
- Los inicios de sesión tienen un campo nuevo para la clave TOTP (2FA), que también se importa y
  exporta
- Servidor: POST /items/batch guarda hasta 100 elementos cifrados en una sola transacción

## v0.1.6

- El PIN o patrón ya no se pierde al cerrar sesión: queda ligado al dispositivo. Para iniciar sesión
  se sigue pidiendo la contraseña maestra
- Cada dispositivo tiene su propio PIN o patrón; cambiar la contraseña maestra conserva el del
  dispositivo actual y revoca los demás
- Teclado del PIN rediseñado (estilo minimal): solo los números grandes, sin teclas dibujadas
- Desarrollo: la base de datos de docker-compose.dev.yml ya no reemplaza a la de producción
- Quien tenía el desbloqueo rápido de la v0.1.5 debe activarlo una vez más

## v0.1.5

- Desbloqueo rápido opcional por dispositivo con PIN de 6 dígitos o patrón, a elegir en Ajustes
- Se activa con la contraseña maestra y solo sirve con la sesión abierta; iniciar sesión siempre
  pide la contraseña
- El servidor guarda la mitad de la llave y la entrega solo con el PIN correcto: 5 intentos y se
  desactiva
- Se rechazan PINs obvios (000000, 123456…) y cerrar sesión borra todo del dispositivo

## v0.1.4

- Tema claro, oscuro o el del sistema, a elegir en Ajustes; la elección se guarda en el dispositivo
- La barra del navegador y del teléfono toma el color del tema elegido

## v0.1.3

- Vista rápida en la lista: un ojo para ver la contraseña (o el secreto principal de cada tipo) sin
  abrir el elemento, con su medidor de fuerza
- Botón para copiar ese secreto directo desde la lista; el portapapeles se vacía a los 30 s
- La vista rápida se cierra sola a los 30 s

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
