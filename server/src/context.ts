import type { Config } from './config.js'
import type { Sql } from './db.js'
import type { Mailer } from './mail.js'
import type { ServerKeys } from './security.js'

export interface Context {
  config: Config
  sql: Sql
  keys: ServerKeys
  mailer: Mailer | null
  version: string
}

export const MINUTE = 60 * 1000
export const DAY = 24 * 60 * MINUTE
