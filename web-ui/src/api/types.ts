export type DeviceMetrics = {
  cpu?: { busy_percent?: number; idle_percent?: number; count?: number }
  memory?: { used_bytes?: number; total_bytes?: number; used_percent?: number }
  thermal?: {
    temperature_celsius?: number
    available?: boolean
    throttled?: boolean
    throttle_known?: boolean
  }
  storage?: { used_bytes?: number; total_bytes?: number; used_percent?: number }
  network?: { down_bytes_per_sec?: number; up_bytes_per_sec?: number }
}

export type AppState = {
  mode: string
  hotspot_running: boolean
  ssid?: string
  hotspot_ip?: string
  dhcp_start?: string
  dhcp_end?: string
  wg_up?: boolean
  proxy_running?: boolean
  syncrox_running?: boolean
  device_metrics?: DeviceMetrics
  files_root?: string
  generated_at?: string
}

export type Config = {
  ssid?: string
  password_set?: boolean
  hotspot_ip?: string
  dhcp_start?: string
  dhcp_end?: string
}

export type GitHubUser = { login?: string; name?: string }
export type GitHubStatus = { connected: boolean; user?: GitHubUser }

export type GitHubRepo = {
  full_name: string
  name: string
  private?: boolean
  default_branch?: string
  language?: string
}

export type GitHubBranch = {
  name: string
  protected?: boolean
  default?: boolean
}

export type GitHubSSHKey = {
  public_key: string
  path: string
  exists: boolean
}

export type Group = {
  slug: string
  name: string
  updated_at?: string
  disk_bytes?: number
  service_count?: number
}

export type Deployment = {
  id: string
  group?: string
  slug?: string
  status: string
  repo?: string
  branch?: string
  commit?: string
  message?: string
  created_at?: string
  finished_at?: string
  error?: string
  active?: boolean
}

export type Service = {
  group?: string
  slug: string
  type: 'go' | 'postgres' | 'bucket' | string
  name: string
  repo?: string
  branch?: string
  port?: number
  root_dir?: string
  build_cmd?: string
  go_toolchain?: string
  memory_mb?: number
  cpus?: number
  running: boolean
  url?: string
  public_url?: string
  public_path?: string
  connection_url?: string
  linked_database?: string
  linked_bucket?: string
  status?: string
  last_error?: string
  deployments?: Deployment[]
  auto_deploy?: boolean
  deploy_sha?: string
  updated_at?: string
}

export type FilesEntry = {
  name: string
  path: string
  type: 'dir' | 'file' | 'symlink' | string
  size?: number
  size_human?: string
  mtime_ms?: number
  ext?: string
  hidden?: boolean
}

export type FilesListing = {
  path: string
  parent?: string
  exists?: boolean
  readable?: boolean
  entries: FilesEntry[]
  summary?: {
    entry_count?: number
    dirs?: number
    files?: number
    total_human?: string
  }
  error?: string
}

export type ManageOverview = {
  docker?: { containers?: unknown[] }
  daemon?: { running?: boolean }
  [key: string]: unknown
}

export type EngineView = {
  postgres_running?: boolean
  settings?: { go_toolchain?: string; postgres_version?: string }
  postgres_options?: Array<{ value: string; label?: string }>
  go_options?: Array<{ value: string; label?: string }>
}

export type ActivityLine = {
  seq: number
  at: string
  level: string
  text: string
}

export type ProgressStep = {
  id: string
  label: string
  status: string
  weight?: number
}

export type Progress = {
  percent: number
  current?: string
  label?: string
  detail?: string
  remaining?: string
  index?: number
  total?: number
  steps?: ProgressStep[]
}

export type ActivitySnapshot = {
  seq: number
  active: boolean
  title?: string
  scope?: string
  deployment_id?: string
  started_at?: string
  ended_at?: string
  ok?: boolean | null
  progress?: Progress | null
  lines: ActivityLine[]
}

export type ServiceEnv = {
  env: string
  env_json?: string
}

export type ServiceSettings = {
  name?: string
  branch?: string
  root_dir?: string
  build_cmd?: string
  memory_mb?: number
  cpus?: number
  linked_database?: string
  linked_bucket?: string
  env?: string
  auto_deploy?: boolean
}

/** Env keys injected when a Postgres service is linked. */
export const LINKED_DB_KEYS = [
  'DATABASE_URL',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SSLMODE',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
] as const

/** Env keys injected when a Bucket service is linked. */
export const LINKED_BUCKET_KEYS = [
  'BUCKET',
  'ENDPOINT',
  'ACCESS_KEY_ID',
  'SECRET_ACCESS_KEY',
  'FORCE_PATH_STYLE',
] as const

