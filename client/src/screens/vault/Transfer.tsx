import { Download, FileUp, Upload } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { ErrorText, Modal, PasswordField, Spinner } from '../../components/ui'
import type { Item, ItemData, ItemType } from '../../crypto/items'
import { deriveMasterKeys } from '../../crypto/kdf'
import { unlockUserKey } from '../../crypto/keys'
import { errorMessage, useI18n } from '../../i18n'
import { canWrite, createItems, createVault, type OpenVault, type Unlocked } from '../../state/session'
import { EXPORT_FORMATS, exportVaults, type ExportFormat } from '../../transfer/exporters'
import { importFile, type ImportResult } from '../../transfer/importers'
import { typeLabel } from './itemTypes'
import { VAULT_COLORS } from './vaultLooks'

interface Props {
  session: Unlocked
  items: Item[]
  onImported: (vaults: OpenVault[], items: Item[]) => void
}

export function TransferSettings({ session, items, onImported }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState<'import' | 'export' | null>(null)
  return (
    <div className="card">
      <h3>{t('transfer.title')}</h3>
      <p className="hint">{t('transfer.help')}</p>
      <div className="row">
        <button className="btn" onClick={() => setOpen('import')}>
          <Upload size={16} /> {t('transfer.import')}
        </button>
        <button className="btn" onClick={() => setOpen('export')}>
          <Download size={16} /> {t('transfer.export')}
        </button>
      </div>
      {open === 'import' && (
        <ImportDialog session={session} items={items} onImported={onImported} onClose={() => setOpen(null)} />
      )}
      {open === 'export' && <ExportDialog session={session} items={items} onClose={() => setOpen(null)} />}
    </div>
  )
}

// --- Importar ---

// Tope de lo que acepta el servidor por elemento (100 000 caracteres cifrados), con margen para el
// cifrado y la codificación en base64
const MAX_ITEM_JSON = 70_000

// Dos elementos son el mismo si coinciden en tipo, nombre y todos sus campos
function fingerprint(d: ItemData): string {
  const fields = Object.keys(d.fields)
    .sort()
    .map((k) => `${k}=${d.fields[k]}`)
  return [d.type, d.name.trim().toLowerCase(), ...fields, ...d.urls].join('\u0000')
}

// Ícono para las bóvedas que se crean al importar, según el nombre de la carpeta
const FOLDER_ICONS: [RegExp, string][] = [
  [/trabaj|work|ofic|office|empresa|company|negocio|business/i, 'briefcase'],
  [/servid|server|infra|devops|hosting|vps|cloud|nube/i, 'server'],
  [/banc|bank|finan|dinero|money|pago|pay/i, 'bank'],
  [/famil|family|casa|home|hogar|personal/i, 'home'],
  [/dev|code|c[oó]digo|git|api/i, 'code'],
  [/social|redes/i, 'users'],
  [/compra|shop|tienda|store/i, 'shopping'],
  [/juego|game/i, 'game'],
  [/escuela|school|universi|estudi/i, 'school'],
  [/viaje|travel/i, 'travel']
]

function iconFor(name: string): string {
  return FOLDER_ICONS.find(([re]) => re.test(name))?.[1] ?? 'lock'
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

interface Done {
  imported: number
  newVaults: number
  limitVault: string
}

function ImportDialog({ session, items, onImported, onClose }: Props & { onClose: () => void }) {
  const { t } = useI18n()
  const writable = session.vaults.filter(canWrite)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [keepFolders, setKeepFolders] = useState(true)
  const [vaultId, setVaultId] = useState(writable[0]?.id ?? '')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState('')

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    setResult(null)
    setBusy(true)
    try {
      setResult(await importFile(file))
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(false)
  }

  const plan = useMemo(() => {
    if (!result) return null
    const existing = new Set(items.filter((i) => !i.trashedAt).map((i) => fingerprint(i.data)))
    const seen = new Set<string>()
    let duplicates = 0
    let tooBig = 0
    const fresh: typeof result.items = []
    for (const entry of result.items) {
      if (JSON.stringify(entry.data).length > MAX_ITEM_JSON) {
        tooBig++
        continue
      }
      const key = fingerprint(entry.data)
      if (existing.has(key) || seen.has(key)) {
        duplicates++
        if (skipDuplicates) continue
      }
      seen.add(key)
      fresh.push(entry)
    }
    const folders = [...new Set(result.items.map((i) => i.folder.trim()).filter(Boolean))]
    const byType = new Map<ItemType, number>()
    for (const { data } of result.items) byType.set(data.type, (byType.get(data.type) ?? 0) + 1)
    return { fresh, duplicates, tooBig, folders, byType }
  }, [result, items, skipDuplicates])

  async function run() {
    if (!plan) return
    setError('')
    setBusy(true)
    // Sesión local con las bóvedas nuevas, para cifrar con sus llaves antes de avisar a la app
    let local = session
    const created: OpenVault[] = []
    const saved: Item[] = []
    let limitVault = ''
    try {
      const fallback = writable.find((v) => v.id === vaultId) ?? writable[0]!
      const groups = new Map<string, ItemData[]>()
      for (const { data, folder } of plan.fresh) {
        let target = fallback
        if (keepFolders && folder.trim()) {
          const name = folder.trim()
          const found = local.vaults.find((v) => canWrite(v) && sameName(v.meta.name, name))
          if (found) {
            target = found
          } else if (!limitVault) {
            try {
              const color = VAULT_COLORS[local.vaults.length % VAULT_COLORS.length]
              const vault = await createVault(local, { name, icon: iconFor(name), color })
              created.push(vault)
              local = { ...local, vaults: [...local.vaults, vault] }
              target = vault
            } catch (err) {
              if ((err as { code?: string }).code !== 'too_many_vaults') throw err
              limitVault = fallback.meta.name
            }
          }
        }
        groups.set(target.id, [...(groups.get(target.id) ?? []), data])
      }

      const total = plan.fresh.length
      setProgress({ done: 0, total })
      for (const [id, datas] of groups) {
        const before = saved.length
        saved.push(...(await createItems(local, id, datas, (n) => setProgress({ done: before + n, total }))))
      }
      setDone({ imported: saved.length, newVaults: created.length, limitVault })
    } catch (err) {
      setError(errorMessage(t, err))
    }
    // Lo que se alcanzó a guardar ya está en el servidor, aunque algo haya fallado después
    if (created.length || saved.length) onImported(created, saved)
    setProgress(null)
    setBusy(false)
  }

  function reset() {
    setResult(null)
    setDone(null)
    setError('')
  }

  return (
    <Modal title={t('import.title')} onClose={busy ? () => {} : onClose}>
      {done ? (
        <div className="stack">
          <p className="ok">{t('import.done', { n: done.imported })}</p>
          {done.newVaults > 0 && <p>{t('import.doneVaults', { n: done.newVaults })}</p>}
          {done.limitVault && <p className="warning">{t('import.vaultLimit', { name: done.limitVault })}</p>}
          <p className="warning">{t('import.deleteFile')}</p>
          <div className="row end">
            <button className="btn" onClick={reset}>
              {t('import.another')}
            </button>
            <button className="btn primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : !result || !plan ? (
        <div className="stack">
          <label className="file-drop">
            <FileUp size={28} aria-hidden />
            <span>{t('import.file')}</span>
            <input
              type="file"
              accept=".csv,.json,.zip,.txt,text/csv,application/json,application/zip"
              disabled={busy}
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {busy && <Spinner label={t('import.reading')} />}
          <ErrorText>{error}</ErrorText>
          <details className="import-how">
            <summary>{t('import.how')}</summary>
            <ul>
              <li>{t('import.how.proton')}</li>
              <li>{t('import.how.passbolt')}</li>
              <li>{t('import.how.bitwarden')}</li>
              <li>{t('import.how.browser')}</li>
              <li>{t('import.how.other')}</li>
            </ul>
          </details>
        </div>
      ) : (
        <div className="stack">
          <div>
            <p>
              <strong>{t('import.found', { source: result.source, n: result.items.length })}</strong>
            </p>
            <ul className="type-counts">
              {[...plan.byType].map(([type, n]) => (
                <li key={type}>
                  {t(typeLabel(type))} <span className="muted">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          {result.skipped > 0 && <p className="hint">{t('import.skipped', { n: result.skipped })}</p>}
          {plan.tooBig > 0 && <p className="hint">{t('import.tooBig', { n: plan.tooBig })}</p>}

          {plan.folders.length > 0 && (
            <fieldset className="stack tight">
              <label className="check">
                <input type="radio" name="dest" checked={keepFolders} onChange={() => setKeepFolders(true)} />
                <span>{t('import.keepFolders', { n: plan.folders.length })}</span>
              </label>
              <label className="check">
                <input type="radio" name="dest" checked={!keepFolders} onChange={() => setKeepFolders(false)} />
                <span>{t('import.oneVault')}</span>
              </label>
            </fieldset>
          )}
          {writable.length > 1 && (
            <div className="field">
              <label htmlFor="import-vault">
                {plan.folders.length > 0 && keepFolders ? t('import.vaultRest') : t('import.vault')}
              </label>
              <select id="import-vault" value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
                {writable.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.meta.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {plan.duplicates > 0 && (
            <label className="check">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              <span>{t('import.skipDuplicates', { n: plan.duplicates })}</span>
            </label>
          )}

          {progress && <Spinner label={t('import.progress', progress)} />}
          {!plan.fresh.length && <p className="hint">{t('import.nothing')}</p>}
          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={reset} disabled={busy}>
              {t('common.back')}
            </button>
            <button className="btn primary" onClick={() => void run()} disabled={busy || !plan.fresh.length}>
              {busy ? <Spinner /> : t('import.submit', { n: plan.fresh.length })}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// --- Exportar ---

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Se revoca después para que el navegador alcance a empezar la descarga
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ExportDialog({ session, items, onClose }: Omit<Props, 'onImported'> & { onClose: () => void }) {
  const { t } = useI18n()
  const [format, setFormat] = useState<ExportFormat>('passme')
  const [selected, setSelected] = useState(() => new Set(session.vaults.map((v) => v.id)))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ name: string; n: number; left: number } | null>(null)

  const active = items.filter((i) => !i.trashedAt)
  const countIn = (id: string) => active.filter((i) => i.vaultId === id).length

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      // Exportar saca todo sin cifrar: se pide la contraseña aunque la bóveda ya esté abierta
      const keys = await deriveMasterKeys(password, session.account.kdf)
      await unlockUserKey(keys.encKey, session.account.protectedUserKey)
      const vaults = session.vaults
        .filter((v) => selected.has(v.id))
        .map((v) => ({ meta: v.meta, items: active.filter((i) => i.vaultId === v.id).map((i) => i.data) }))
      const file = exportVaults(format, vaults, t)
      download(file.name, file.mime, file.text)
      const total = vaults.reduce((n, v) => n + v.items.length, 0)
      setDone({ name: file.name, n: total - file.left, left: file.left })
      setPassword('')
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(false)
  }

  return (
    <Modal title={t('export.title')} onClose={onClose}>
      {done ? (
        <div className="stack">
          <p className="ok">{t('export.done', { name: done.name, n: done.n })}</p>
          {done.left > 0 && <p className="hint">{t('export.left', { n: done.left })}</p>}
          <p className="warning">{t('export.warning')}</p>
          <div className="row end">
            <button className="btn primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <fieldset className="stack tight">
            <legend>{t('export.format')}</legend>
            {EXPORT_FORMATS.map((f) => (
              <label key={f} className="check">
                <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} />
                <span>
                  {t(`export.f.${f}`)}
                  <br />
                  <span className="hint">{t(`export.d.${f}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {session.vaults.length > 1 && (
            <fieldset className="stack tight">
              <legend>{t('export.vaults')}</legend>
              {session.vaults.map((v) => (
                <label key={v.id} className="check">
                  <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                  <span>
                    {v.meta.name} <span className="muted">· {t('export.count', { n: countIn(v.id) })}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="hint">{t('export.trash')}</p>
          <p className="warning">{t('export.warning')}</p>
          <PasswordField
            label={t('field.masterPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={busy || !selected.size}>
              {busy ? <Spinner /> : (
                <>
                  <Download size={16} /> {t('export.submit')}
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
