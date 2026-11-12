# App de Android

La app (`android/`) muestra la web de tu servidor dentro de la app, así que es la misma PassMe, con
el mismo cifrado en el teléfono, y se actualiza sola cuando actualizas el servidor. Lo que agrega
es el **autocompletado** en otras apps y en Chrome.

Necesita el servidor publicado con **https** y un dominio fijo (por ejemplo con un túnel con nombre
de Cloudflare, ver [DEPLOY.md](DEPLOY.md)). Por http la web no puede cifrar y la sesión no se guarda.

## Instalar y configurar

1. Instala la APK en el teléfono (hay que permitir "instalar apps desconocidas" para la app con la
   que la abras: Archivos, Drive, Telegram…).
2. Ábrela y escribe la dirección de tu servidor (viene `https://pass.passme.dpdns.org`). La app
   comprueba que ahí responda PassMe antes de guardarla.
3. Inicia sesión como en la web. Te conviene activar el PIN o el patrón en **Ajustes → Desbloqueo
   rápido**: es lo que pedirá cada vez que autocompletes.
4. En **Ajustes → App de Android** pulsa **Activar autocompletar** y elige PassMe.
5. En Chrome: **Configuración → Servicios de autocompletar → Autocompletar con otro servicio**, y
   reinicia Chrome. Firefox, Brave, Edge, Samsung Internet y otros usan el modo compatible de Android.

## Cómo funciona

- Al tocar un campo de usuario o contraseña aparece **Desbloquear PassMe para autocompletar** (en
  el teclado, si lo permite, o debajo del campo).
- Se abre PassMe, desbloqueas y eliges el login: los **sugeridos** son los de ese sitio (en un
  navegador) o los que ya usaste en esa app. Al elegir uno para una app puedes **recordarlo**: se le
  agrega `androidapp://paquete.de.la.app`, igual que en Bitwarden y Proton Pass.
- Al iniciar sesión con datos que PassMe no tiene, Android pregunta si quieres **guardarlos**. Si
  ya hay un login de esa app o sitio con ese usuario, se actualiza su contraseña.
- El servicio de autocompletar de Android nunca ve tus contraseñas: solo sabe dónde están los
  campos. Quien descifra y elige es la web, en el teléfono.
- `window.passmeAndroid`, el puente entre la web y la app, solo existe en las páginas de tu
  servidor (`addWebMessageListener` con el origen permitido), nunca en otro sitio ni en un iframe.

## Compilar

Requisitos: JDK 21 y el SDK de Android (plataforma 36). En `android/local.properties`:

```
sdk.dir=/ruta/a/Android/Sdk
```

```sh
cd android
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease    # app/build/outputs/apk/release/app-release.apk (firmada)
```

La versión de la app es la del `package.json` de la raíz (0.4.0 → versionCode 400).

### Firma

La APK final se firma con la llave que indica `android/keystore.properties` (fuera de git):

```
storeFile=/home/usuario/.config/passme-android/release.jks
storePassword=…
keyAlias=passme
keyPassword=…
```

**Respalda `release.jks` y `keystore.properties`.** Android solo instala una actualización si viene
firmada con la misma llave; si la pierdes habrá que desinstalar la app y volver a configurarla.
