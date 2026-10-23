import type { EncryptedItem } from '../crypto/items'
import type { KdfParams } from '../crypto/kdf'
import type { RegisterPayload } from '../crypto/keys'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    // Datos extra del error, como los intentos que quedan
    readonly extra: Record<string, number> = {}
  ) {
    super(code)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        // Sin este encabezado el servidor rechaza cualquier escritura (protección CSRF)
        'x-passme-request': '1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new ApiError(0, 'network_error')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, number>
  if (!res.ok) {
    const { error, ...extra } = data
    throw new ApiError(res.status, error ?? 'server_error', extra)
  }
  return data as T
}

export interface ServerConfig {
  version: string
  registration: 'first' | 'open' | 'closed'
}

export interface Account {
  id: string
  email: string
  isAdmin: boolean
  totpEnabled: boolean
  backupCodesLeft: number
  kdf: KdfParams
  protectedUserKey: string
  publicKey: string
  protectedPrivateKey: string
  // Desbloqueo rápido activo en esta sesión (este dispositivo)
  quickUnlock: boolean
}

export interface EncryptedVault {
  id: string
  data: string
  ownerId: string
  protectedVaultKey: string
  role: 'owner' | 'manager' | 'editor' | 'viewer'
  updatedAt: string
}

export interface NewPassword {
  kdf: KdfParams
  authKey: string
  protectedUserKey: string
}

export const api = {
  config: () => request<ServerConfig>('GET', '/config'),

  prelogin: (email: string) => request<{ kdf: KdfParams }>('POST', '/auth/prelogin', { email }),
  register: (payload: RegisterPayload) => request<{ ok: true }>('POST', '/auth/register', payload),
  login: (email: string, authKey: string) =>
    request<{ mfaRequired: boolean }>('POST', '/auth/login', { email, authKey }),
  loginMfa: (code: string) => request<{ ok: true }>('POST', '/auth/login/mfa', { code }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  recover: (email: string, recoveryAuthKey: string) =>
    request<{ token: string; recoveryProtectedUserKey: string }>('POST', '/auth/recover', { email, recoveryAuthKey }),
  recoverReset: (token: string, next: NewPassword) =>
    request<{ ok: true }>('POST', '/auth/recover/reset', { token, ...next }),

  account: () => request<Account>('GET', '/account'),
  changePassword: (currentAuthKey: string, next: NewPassword) =>
    request<{ ok: true }>('POST', '/account/password', { currentAuthKey, ...next }),
  totpSetup: (authKey: string) => request<{ secret: string; uri: string }>('POST', '/account/totp/setup', { authKey }),
  totpEnable: (code: string) => request<{ backupCodes: string[] }>('POST', '/account/totp/enable', { code }),
  totpDisable: (authKey: string, code: string) =>
    request<{ ok: true }>('POST', '/account/totp/disable', { authKey, code }),

  enableQuickUnlock: (authKey: string, verifier: string) =>
    request<{ share: string }>('POST', '/account/quick-unlock', { authKey, verifier }),
  disableQuickUnlock: () => request<{ ok: true }>('DELETE', '/account/quick-unlock'),
  openQuickUnlock: (verifier: string) => request<{ share: string }>('POST', '/account/quick-unlock/open', { verifier }),

  vaults: () => request<EncryptedVault[]>('GET', '/vaults'),
  createVault: (id: string, data: string, protectedVaultKey: string) =>
    request<EncryptedVault>('POST', '/vaults', { id, data, protectedVaultKey }),
  updateVault: (id: string, data: string) => request<EncryptedVault>('PUT', `/vaults/${id}`, { data }),
  deleteVault: (id: string) => request<{ ok: true }>('DELETE', `/vaults/${id}`),
  items: () => request<EncryptedItem[]>('GET', '/items'),
  createItem: (id: string, vaultId: string, data: string) =>
    request<EncryptedItem>('POST', '/items', { id, vaultId, data }),
  updateItem: (id: string, data: string, revision: number) =>
    request<EncryptedItem>('PUT', `/items/${id}`, { data, revision }),
  moveItem: (id: string, vaultId: string, data: string, revision: number) =>
    request<EncryptedItem>('POST', `/items/${id}/move`, { vaultId, data, revision }),
  trashItem: (id: string) => request<EncryptedItem>('POST', `/items/${id}/trash`, {}),
  restoreItem: (id: string) => request<EncryptedItem>('POST', `/items/${id}/restore`, {}),
  deleteItem: (id: string) => request<{ ok: true }>('DELETE', `/items/${id}`)
}
