import type { EncryptedItem } from '../crypto/items'
import type { KdfParams } from '../crypto/kdf'
import type { RegisterPayload } from '../crypto/keys'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
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
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server_error')
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

  vaults: () => request<EncryptedVault[]>('GET', '/vaults'),
  items: () => request<EncryptedItem[]>('GET', '/items'),
  createItem: (id: string, vaultId: string, data: string) =>
    request<EncryptedItem>('POST', '/items', { id, vaultId, data }),
  updateItem: (id: string, data: string, revision: number) =>
    request<EncryptedItem>('PUT', `/items/${id}`, { data, revision }),
  trashItem: (id: string) => request<EncryptedItem>('POST', `/items/${id}/trash`, {}),
  restoreItem: (id: string) => request<EncryptedItem>('POST', `/items/${id}/restore`, {}),
  deleteItem: (id: string) => request<{ ok: true }>('DELETE', `/items/${id}`)
}
