# Diseño criptográfico de PassMe

Todo el cifrado ocurre en el navegador (`client/src/crypto/`). El servidor guarda y entrega texto
cifrado, verifica la autenticación y nunca recibe una llave capaz de descifrar datos.

## Jerarquía de llaves

```
contraseña maestra ──Argon2id(m=64 MiB, t=3, p=1, sal 16 B)──► llave maestra (256 bits)
                                                          ├─HKDF "passme:master:auth"─► authKey ──► servidor
                                                          └─HKDF "passme:master:enc"──► encKey (no sale del navegador)

frase BIP39 de 24 palabras (256 bits) ─┬─HKDF "passme:recovery:auth"─► recoveryAuthKey ──► servidor
                                       └─HKDF "passme:recovery:enc"──► recoveryEncKey

llave de usuario (aleatoria, 256 bits)
  ├─ cifrada con encKey          → protected_user_key
  ├─ cifrada con recoveryEncKey  → recovery_protected_user_key
  ├─ cifra la llave privada P-256 (para compartir bóvedas)
  └─ cifra la llave de cada bóveda (aleatoria, 256 bits)
        └─ cifra el nombre, ícono y color de la bóveda, y cada elemento
```

- **Cifrado:** AES-256-GCM con IV aleatorio de 96 bits en cada operación. El formato guardado es
  `v1.` + base64url(iv ‖ texto cifrado ‖ etiqueta).
- **AAD:** cada texto cifrado se ata a su contexto (`passme:item:<bóveda>:<id>`,
  `passme:vault-key:<bóveda>`, etc.). Un servidor malicioso no puede mover un elemento a otro id o
  bóveda, ni cambiar una llave por otra, sin que el descifrado falle. Para mover un elemento a otra
  bóveda, el navegador lo vuelve a cifrar con la llave de la bóveda destino.
- **Llaves en memoria:** se importan como `CryptoKey` no exportables. Los búferes intermedios se
  sobrescriben con ceros en cuanto dejan de usarse. Al bloquear se sueltan todas las referencias.
- **Contraseñas:** se normalizan con NFKC para que la misma contraseña escrita desde otro sistema o
  teclado produzca los mismos bytes.

## Autenticación

1. `POST /auth/prelogin` devuelve la sal y los parámetros de Argon2id. Para un correo inexistente
   responde una sal falsa pero estable (HMAC con la llave del servidor), así no se puede saber
   quién tiene cuenta.
2. El navegador deriva `authKey` y lo envía a `POST /auth/login`. El servidor lo compara contra
   `scrypt(authKey)` (N=2^15, r=8, p=1). Con una copia de la base de datos no se puede iniciar
   sesión, y el `authKey` tampoco sirve para descifrar.
3. Si hay 2FA, se emite una sesión `mfa` de 5 minutos que solo permite enviar el código. Tiene 5
   intentos.
4. La sesión es un token aleatorio de 256 bits. Viaja en la cookie
   `__Host-passme_sid` (`HttpOnly`, `Secure`, `SameSite=Strict`) y en la base de datos se guarda
   solo su SHA-256.

### Protecciones

- **Bloqueo de la cuenta** durante 15 minutos tras 10 intentos fallidos.
- **Límite por IP:** 10 por minuto en las rutas que reciben secretos, 300 por minuto en el resto.
- **CSRF:** toda escritura exige el encabezado `x-passme-request: 1`, que un sitio ajeno no puede
  mandar sin CORS. Se suma a `SameSite=Strict`.
- **TOTP:** el secreto se guarda cifrado con una llave derivada de `SERVER_SECRET`. Un código ya
  usado no se acepta de nuevo (se guarda el último contador). Los códigos de respaldo se guardan
  como HMAC y son de un solo uso.
- **Reautenticación:** activar o desactivar el 2FA y cambiar la contraseña piden de nuevo la
  contraseña maestra. Una sesión robada no alcanza para tomar la cuenta.

## Recuperación

1. El usuario escribe su frase. El navegador valida la suma de verificación BIP39, deriva
   `recoveryAuthKey` y lo envía a `POST /auth/recover`.
2. El servidor lo verifica (con el mismo bloqueo por intentos) y devuelve
   `recovery_protected_user_key` y un token de 10 minutos.
3. El navegador descifra la llave de usuario, la vuelve a cifrar con la nueva contraseña maestra
   y la envía a `POST /auth/recover/reset`. Se cierran todas las sesiones.

El 2FA sigue activo después de recuperar. Quien perdió también el teléfono entra con un código de
respaldo.

## Desbloqueo rápido (PIN o patrón)

Opcional y por dispositivo. Sirve solo para desbloquear con la sesión abierta; iniciar sesión
siempre pide la contraseña maestra.

```
PIN (6 dígitos) o patrón ─Argon2id(sal local secreta)→ HKDF → verificador (al servidor) + pinKey
servidor: share aleatorio de 256 bits, guardado cifrado con SERVER_SECRET y ligado a la sesión
dispositivo: AES-GCM(pinKey, AES-GCM(share, llave de usuario))
```

- Activarlo pide la contraseña maestra: la llave de usuario solo existe en memoria como `CryptoKey`
  no exportable, y para guardarla hace falta volver a descifrarla.
- Para desbloquear, el navegador manda el verificador y el servidor devuelve el `share` si coincide.
  Cada intento se cuenta **antes** de comprobarlo; al quinto fallo el servidor borra el `share` y el
  desbloqueo rápido deja de existir.
- Quien robe el dispositivo tiene la sal y el blob, pero no el `share`: no puede probar el millón de
  PINs sin pasar por el servidor (5 intentos).
- El servidor no puede adivinar el PIN a partir del verificador porque no conoce la sal, que nunca
  sale del dispositivo.
- Cerrar sesión, que la sesión venza o cambiar la contraseña desde otro dispositivo (que cierra las
  demás sesiones) lo desactiva.
- Se rechazan PINs triviales (todos iguales o escaleras).

## Lo que el servidor sí ve

- Correos, fechas de creación y modificación, cuántos elementos hay en cada bóveda y su tamaño
  aproximado.
- Direcciones IP y user agents de las sesiones.

No ve nombres, usuarios, contraseñas, URLs, notas, el tipo de cada elemento ni el nombre, ícono o
color de las bóvedas.

## Límites conocidos

- Un servidor comprometido podría entregar JavaScript modificado que robe la contraseña al
  escribirla. Es el límite de toda app web zero-knowledge. Las apps nativas (planeadas) lo mitigan.
- Desbloquear la bóveda con la sesión aún abierta es una operación local: quien tenga acceso al
  dispositivo y a la sesión puede intentar adivinar la contraseña sin límite de intentos, aunque
  Argon2id hace cada intento costoso.
- Con el desbloqueo rápido, alguien con el dispositivo **y** una copia de la base de datos **y**
  `SERVER_SECRET` podría probar todos los PINs sin límite. Un PIN de 6 dígitos o un patrón tienen
  mucha menos entropía que una buena contraseña maestra; quien necesite el máximo nivel no debe
  activarlo.
