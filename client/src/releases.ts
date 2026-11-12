import type { Lang } from './state/prefs'

// Novedades que ve el usuario al entrar después de una actualización. La primera es la versión
// actual (lo comprueba una prueba): cada versión nueva agrega aquí sus notas, en lenguaje sencillo.
export interface Release {
  version: string
  date: string
  notes: Record<Lang, string[]>
}

export const RELEASES: Release[] = [
  {
    version: '0.4.0',
    date: '2026-11-12',
    notes: {
      es: [
        'App de Android: la misma PassMe en tu teléfono, conectada a tu servidor',
        'Autocompletar en otras apps y en Chrome: toca el campo, desbloquea PassMe y elige el login',
        'Al iniciar sesión en una app o página nueva, Android ofrece guardar el usuario y la contraseña en PassMe',
        'Actívalo en Ajustes → App de Android → Activar autocompletar'
      ],
      en: [
        'Android app: the same PassMe on your phone, connected to your server',
        'Autofill in other apps and in Chrome: tap the field, unlock PassMe and pick the login',
        'When you sign in to a new app or site, Android offers to save the username and password to PassMe',
        'Turn it on in Settings → Android app → Turn on autofill'
      ]
    }
  },
  {
    version: '0.3.0',
    date: '2026-11-12',
    notes: {
      es: [
        'Nuevo tipo Llave privada: guarda tu llave de Passbolt (PGP), llaves SSH, certificados PEM o llaves age',
        'Carga la llave desde su archivo: la identidad, la huella, la llave pública y las fechas se llenan solas, y puedes descargarla de vuelta',
        'Nuevo tipo Frases y códigos de recuperación: la frase se ve como palabras numeradas y cada código de respaldo se marca al usarlo',
        'PassMe te avisa cuando te quedan pocos códigos, y las llaves privadas que vengan en notas al importar se acomodan en su tipo'
      ],
      en: [
        'New Private key type: store your Passbolt key (PGP), SSH keys, PEM certificates or age keys',
        'Load the key from its file: identity, fingerprint, public key and dates are filled in, and you can download it back',
        'New Recovery phrases & codes type: the phrase shows as numbered words and each backup code is checked off when used',
        'PassMe warns you when you are running low on codes, and private keys found in notes when importing get their own type'
      ]
    }
  },
  {
    version: '0.2.1',
    date: '2026-11-12',
    notes: {
      es: [
        'Al entrar después de una actualización verás esta ventana con lo nuevo de cada versión',
        'Puedes volver a verla cuando quieras en Ajustes → Acerca de → Novedades'
      ],
      en: [
        'After an update you will see this window with what is new in each version',
        'You can open it again anytime in Settings → About → What’s new'
      ]
    }
  },
  {
    version: '0.2.0',
    date: '2026-10-26',
    notes: {
      es: [
        'Más usuarios: el administrador invita por correo o abre el registro a quien quiera',
        'Las invitaciones sirven una sola vez, solo para ese correo, y vencen en 7 días',
        'Nuevo diseño de las pantallas de inicio de sesión, registro y desbloqueo'
      ],
      en: [
        'More users: the admin invites people by email or opens sign-up to anyone',
        'Invitations work once, only for that email, and expire after 7 days',
        'New design for the sign-in, sign-up and unlock screens'
      ]
    }
  },
  {
    version: '0.1.9',
    date: '2026-10-26',
    notes: {
      es: [
        'Ubicaciones secretas con mapa: toca el mapa, arrastra el marcador o busca una dirección',
        'Pega un enlace de Google Maps, Apple Maps u OpenStreetMap y se convierte en coordenadas'
      ],
      en: [
        'Secret locations on a map: tap the map, drag the pin or search for an address',
        'Paste a Google Maps, Apple Maps or OpenStreetMap link and it becomes coordinates'
      ]
    }
  },
  {
    version: '0.1.8',
    date: '2026-10-26',
    notes: {
      es: [
        'Desliza un elemento a la derecha para mandarlo a la papelera (con opción de deshacer)',
        'Desliza a la izquierda para marcarlo como favorito o quitárselo'
      ],
      en: [
        'Swipe an item right to move it to the trash (with undo)',
        'Swipe left to add it to or remove it from favorites'
      ]
    }
  },
  {
    version: '0.1.7',
    date: '2026-10-26',
    notes: {
      es: [
        'Importa tus contraseñas desde Proton Pass, Bitwarden, Passbolt, 1Password, KeePass, navegadores y más',
        'Exporta a PassMe, Bitwarden o CSV para llevarlas a otra app',
        'Los inicios de sesión tienen un campo para la clave TOTP (2FA)'
      ],
      en: [
        'Import your passwords from Proton Pass, Bitwarden, Passbolt, 1Password, KeePass, browsers and more',
        'Export to PassMe, Bitwarden or CSV to take them to another app',
        'Logins have a field for the TOTP (2FA) key'
      ]
    }
  },
  {
    version: '0.1.6',
    date: '2026-10-24',
    notes: {
      es: [
        'El PIN o patrón ya no se pierde al cerrar sesión: queda ligado a cada dispositivo',
        'Teclado del PIN rediseñado'
      ],
      en: ['Your PIN or pattern is no longer lost when you sign out: it stays tied to each device', 'Redesigned PIN keypad']
    }
  }
]

// Compara "0.2.1" con "0.10.0" número por número
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

// Las versiones que este dispositivo todavía no ha visto. Sin registro (primera vez con esta
// función) se muestra solo la más reciente.
export function unseenReleases(seen: string): Release[] {
  if (!seen) return RELEASES.slice(0, 1)
  return RELEASES.filter((r) => compareVersions(r.version, seen) > 0)
}
