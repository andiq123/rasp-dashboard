import { api } from './client'
import type {
  ActivitySnapshot,
  ActivityLine,
  AppState,
  Config,
  Deployment,
  DockerAction,
  DockerActionResult,
  EngineView,
  FilesListing,
  GitHubBranch,
  GitHubRepo,
  GitHubSSHKey,
  GitHubStatus,
  Group,
  ManageOverview,
  RuntimeStats,
  Service,
  ServiceEnv,
  ServiceSettings,
} from './types'

export function readInitialState(): AppState {
  const el = document.getElementById('initial-state')
  if (!el?.textContent || el.textContent.includes('__STATE__')) {
    return {
      mode: 'mullvad',
      hotspot_running: false,
      device_metrics: {},
    }
  }
  try {
    return JSON.parse(el.textContent) as AppState
  } catch {
    return { mode: 'mullvad', hotspot_running: false }
  }
}

export const fetchState = () => api<AppState>('/api/state')
export const fetchConfig = () => api<Config>('/api/config')
export const saveConfig = (body: Record<string, string>) =>
  api('/api/config', { method: 'POST', body })

export const fetchGitHubStatus = () => api<GitHubStatus>('/api/github/status')
export const saveGitHubToken = (token: string) =>
  api('/api/github/token', { method: 'POST', body: { token } })
export const clearGitHubToken = () => api('/api/github/token', { method: 'DELETE' })
export const fetchRepos = () =>
  api<{ repos: GitHubRepo[] }>('/api/github/repos').then((r) => r.repos || [])
export const fetchBranches = (repo: string) =>
  api<{ branches: GitHubBranch[] }>(`/api/github/branches?repo=${encodeURIComponent(repo)}`).then(
    (r) => r.branches || [],
  )
export const fetchDirs = (repo: string, branch: string, path = '') => {
  const q = new URLSearchParams({ repo, branch })
  if (path) q.set('path', path)
  return api<{
    dirs: Array<{ name: string; path: string }>
    go_modules?: Array<{ path: string; has_go_mod?: boolean }>
    root_has_go_mod?: boolean
    suggested_root?: string
    suggest_reason?: string
  }>(`/api/github/dirs?${q}`)
}

export const fetchGitHubSSHKey = () => api<GitHubSSHKey>('/api/github/ssh-key')

export const fetchGroups = () =>
  api<{ groups: Group[] }>('/api/groups').then((r) => r.groups || [])
export const createGroup = (name: string) =>
  api<Group>('/api/groups', { method: 'POST', body: { name } })
export const renameGroup = (slug: string, name: string) =>
  api(`/api/groups/${encodeURIComponent(slug)}`, { method: 'PUT', body: { name } })
export const deleteGroup = (slug: string) =>
  api(`/api/groups/${encodeURIComponent(slug)}`, { method: 'DELETE' })

export const fetchServices = (group: string) =>
  api<{ services: Service[] }>(`/api/groups/${encodeURIComponent(group)}/services`).then(
    (r) => r.services || [],
  )

export const fetchGroupStats = (group: string) =>
  api<{ stats?: Record<string, RuntimeStats> }>(
    `/api/groups/${encodeURIComponent(group)}/stats`,
  ).then((r) => r.stats || {})

export const fetchService = (group: string, slug: string) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}`)

export const fetchServiceEnv = (group: string, slug: string) =>
  api<ServiceEnv>(`/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}/env`)

export const updateServiceSettings = (group: string, slug: string, body: ServiceSettings) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}/settings`, {
    method: 'PUT',
    body,
  })

export const fetchServiceLogs = (group: string, slug: string, lines = 200) =>
  api<{ logs?: string }>(
    `/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}/logs?lines=${lines}`,
  ).then((r) => r.logs || '')

export const fetchDeployments = (group: string, slug: string) =>
  api<{ deployments: Deployment[] }>(
    `/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}/deployments`,
  ).then((r) => r.deployments || [])

export const fetchDeployLogs = (group: string, slug: string, deployId: string) =>
  api<{ lines: ActivityLine[] }>(
    `/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}/deployments/${encodeURIComponent(deployId)}/logs`,
  ).then((r) => r.lines || [])

export const deployGo = (group: string, body: Record<string, unknown>) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services`, { method: 'POST', body })

export const createPostgres = (group: string, body: Record<string, unknown>) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services`, {
    method: 'POST',
    body: { ...body, type: 'postgres' },
  })

export const createBucket = (group: string, body: Record<string, unknown>) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services`, {
    method: 'POST',
    body: { ...body, type: 'bucket' },
  })

export const createRedis = (group: string, body: Record<string, unknown>) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services`, {
    method: 'POST',
    body: { ...body, type: 'redis' },
  })

export const serviceAction = (group: string, slug: string, action: string) =>
  api<Service>(`/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}/${action}`, {
    method: 'POST',
  })

export const deleteService = (group: string, slug: string) =>
  api(`/api/groups/${encodeURIComponent(group)}/services/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })

export const fetchPorts = () =>
  api<{ next?: number; free?: number; used?: unknown[] }>('/api/ports')

export const fetchManage = () => api<ManageOverview>('/api/manage')
export const fetchEngine = () => api<EngineView>('/api/engine')
export const engineAction = (action: 'start' | 'stop' | 'minio_start' | 'minio_stop') =>
  api<EngineView>('/api/engine', { method: 'POST', body: { action } })
export const updateEngine = (body: { postgres_version?: string; go_toolchain?: string }) =>
  api<EngineView>('/api/engine', { method: 'POST', body: { action: 'update', ...body } })
export const dockerAction = (body: DockerAction) =>
  api<DockerActionResult>('/api/docker', { method: 'POST', body })

export const setMode = (mode: string) => api('/api/mode', { method: 'POST', body: { mode } })
export const hotspotAction = (action: 'start' | 'stop' | 'restart' | 'repair-vpn') =>
  api(`/api/hotspot/${action}`, { method: 'POST' })
export const syncroxAction = (action: 'start' | 'stop') =>
  api(`/api/syncrox/${action}`, { method: 'POST' })

export const fetchFiles = (path: string) =>
  api<FilesListing>(`/api/files?path=${encodeURIComponent(path)}`)
export const fetchFilePreview = (path: string) =>
  api<{ path: string; name: string; text?: string; binary?: boolean; error?: string }>(
    `/api/files/preview?path=${encodeURIComponent(path)}`,
  )
export const filesOp = (body: { op: string; path: string; to?: string; name?: string }) =>
  api('/api/files', { method: 'POST', body })

export const fetchActivity = () => api<ActivitySnapshot>('/api/activity')
