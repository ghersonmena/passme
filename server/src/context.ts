import type { Config } from './config.js'
import type { Sql } from './db.js'
import type { ServerKeys } from './security.js'

export interface Context {
  config: Config
  sql: Sql
  keys: ServerKeys
  version: string
}

export const MINUTE = 60 * 1000
export const DAY = 24 * 60 * MINUTE
