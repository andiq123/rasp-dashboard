import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Database, FolderGit2, KeyRound, RefreshCw } from 'lucide-react'
import {
  clearGitHubToken,
  engineAction,
  fetchEngine,
  fetchGitHubSSHKey,
  fetchGitHubStatus,
  fetchManage,
  saveGitHubToken,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input } from '@/components/ui/Field/Field'
import { Panel } from '@/components/ui/Panel/Panel'
import { PageHeader, PageSub } from '@/components/ui/PageHeader/PageHeader'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { usePendingAddGo } from '@/features/projects/pendingAddGo'
import { codeSurface, muted } from '@/lib/ui'

export function SettingsPage() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const { pending, consumePending } = usePendingAddGo()
  const [token, setToken] = useState('')

  const gh = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })
  const sshKey = useQuery({
    queryKey: queryKeys.githubSSHKey,
    queryFn: fetchGitHubSSHKey,
    enabled: !!gh.data?.connected,
  })
  const manage = useQuery({ queryKey: queryKeys.manage, queryFn: fetchManage })
  const engine = useQuery({ queryKey: queryKeys.engine, queryFn: fetchEngine })

  const connect = useMutation({
    mutationFn: () => saveGitHubToken(token.trim()),
    onSuccess: async () => {
      setToken('')
      showToast('GitHub connected')
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.githubStatus }),
        qc.invalidateQueries({ queryKey: queryKeys.githubSSHKey }),
      ])
      if (pending) consumePending()
    },
    onError: (e: Error) => showToast(e.message || 'GitHub failed', 'error'),
  })

  const disconnect = useMutation({
    mutationFn: clearGitHubToken,
    onSuccess: async () => {
      showToast('GitHub disconnected')
      await qc.invalidateQueries({ queryKey: queryKeys.githubStatus })
    },
    onError: (e: Error) => showToast(e.message || 'Disconnect failed', 'error'),
  })

  const engStart = useMutation({
    mutationFn: () => engineAction('start'),
    onSuccess: async () => {
      showToast('Postgres started')
      await qc.invalidateQueries({ queryKey: queryKeys.engine })
    },
    onError: (e: Error) => showToast(e.message || 'Start failed', 'error'),
  })

  const engStop = useMutation({
    mutationFn: () => engineAction('stop'),
    onSuccess: async () => {
      showToast('Postgres stopped')
      await qc.invalidateQueries({ queryKey: queryKeys.engine })
    },
    onError: (e: Error) => showToast(e.message || 'Stop failed', 'error'),
  })

  async function copySSHKey() {
    const key = sshKey.data?.public_key?.trim()
    if (!key) return
    try {
      await navigator.clipboard.writeText(key)
      showToast('SSH key copied')
    } catch {
      showToast('Could not copy — select the key manually', 'error')
    }
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: 'Disconnect GitHub?',
      body: 'Deploying new Go apps will require connecting again. Existing services keep running.',
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (ok) disconnect.mutate()
  }

  async function onStopPostgres() {
    const ok = await confirm({
      title: 'Stop shared Postgres?',
      body: 'Linked app databases on this engine will become unreachable until you start it again.',
      confirmLabel: 'Stop',
      danger: true,
    })
    if (ok) engStop.mutate()
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <PageHeader>
        <PageSub>Account and host storage</PageSub>
      </PageHeader>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <FolderGit2 className="h-4 w-4" aria-hidden /> GitHub
          </span>
        }
        hint="Deploy Go apps from your repositories."
      >
        {gh.isLoading ? (
          <Spinner compact label="Checking GitHub…" />
        ) : gh.isError ? (
          <Empty
            compact
            title="Could not check GitHub"
            body={(gh.error as Error).message}
            action={
              <Button variant="infoSoft" onClick={() => void gh.refetch()}>
                Retry
              </Button>
            }
          />
        ) : gh.data?.connected ? (
          <div className="grid w-full gap-3 justify-items-start">
            <div className="badge badge-success badge-lg gap-2">
              <span className="status status-success" />
              {(gh.data.user && gh.data.user.login) || 'GitHub'}
            </div>
            <p className={`text-sm ${muted} m-0`}>
              Connected. Add this Pi’s SSH public key on GitHub (Settings → SSH and GPG keys), then
              disconnect only to switch accounts.
            </p>

            <div className="w-full grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm inline-flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4" aria-hidden /> SSH public key
                </strong>
                <Button
                  variant="infoSoft"
                  icon={<Copy className="h-3.5 w-3.5" aria-hidden />}
                  disabled={!sshKey.data?.exists || !sshKey.data.public_key}
                  onClick={() => void copySSHKey()}
                >
                  Copy
                </Button>
              </div>
              {sshKey.isLoading ? (
                <Spinner compact label="Loading SSH key…" />
              ) : sshKey.isError ? (
                <Empty compact title="Could not load SSH key" body={(sshKey.error as Error).message} />
              ) : !sshKey.data?.exists ? (
                <Empty
                  compact
                  title="No GitHub SSH key on this Pi"
                  body={`Expected ${sshKey.data?.path || '~/.ssh/id_ed25519_github.pub'}. Create one with ssh-keygen, then refresh.`}
                />
              ) : (
                <pre className={`${codeSurface} select-all`} tabIndex={0}>
                  {sshKey.data.public_key}
                </pre>
              )}
              {sshKey.data?.path ? (
                <p className={`text-xs ${muted} m-0 font-mono`}>{sshKey.data.path}</p>
              ) : null}
            </div>

            <Button variant="dangerSoft" loading={disconnect.isPending} onClick={() => void onDisconnect()}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="grid w-full max-w-md gap-3 justify-items-start">
            <p className={`text-sm ${muted} m-0`}>
              Paste a personal access token with repo read. Stored on this Pi only. After connect,
              copy the SSH public key into GitHub.
            </p>
            <Field
              label="Personal access token"
              meta="github_pat_…"
              tip="Needs repo read. Stored only on this Pi. After connect, add the SSH public key on GitHub."
              htmlFor="settings-gh-token"
            >
              <Input
                id="settings-gh-token"
                type="password"
                autoComplete="off"
                placeholder="github_pat_… or ghp_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token.trim()) connect.mutate()
                }}
              />
            </Field>
            <Button
              variant="primary"
              icon={<FolderGit2 className="h-4 w-4" />}
              loading={connect.isPending}
              disabled={!token.trim()}
              onClick={() => connect.mutate()}
            >
              Connect
            </Button>
          </div>
        )}
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Database className="h-4 w-4" aria-hidden /> Storage
          </span>
        }
        hint="Disk, Docker inventory, and the shared Postgres engine."
      >
        {manage.isLoading || engine.isLoading ? (
          <Spinner compact label="Loading storage…" />
        ) : manage.isError ? (
          <Empty
            compact
            title="Could not load storage"
            body={(manage.error as Error).message}
            action={
              <Button variant="primary" onClick={() => void manage.refetch()}>
                Retry
              </Button>
            }
          />
        ) : engine.isError ? (
          <Empty
            compact
            title="Could not load Postgres engine"
            body={(engine.error as Error).message}
            action={
              <Button variant="infoSoft" onClick={() => void engine.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="block text-sm">Shared Postgres</strong>
                <p className={`text-xs ${muted} m-0 mt-0.5`}>
                  {engine.data?.postgres_running ? 'Running' : 'Stopped'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {engine.data?.postgres_running ? (
                  <Button
                    variant="dangerSoft"
                    loading={engStop.isPending}
                    onClick={() => void onStopPostgres()}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button variant="successSoft" loading={engStart.isPending} onClick={() => engStart.mutate()}>
                    Start
                  </Button>
                )}
                <Button
                  variant="infoSoft"
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => {
                    void manage.refetch()
                    void engine.refetch()
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>
            <p className={`text-xs ${muted} m-0`}>
              Daemon{' '}
              {(manage.data?.daemon as { running?: boolean } | undefined)?.running ? 'running' : 'offline'}
              {(manage.data?.docker as { containers?: unknown[] } | undefined)?.containers
                ? ` · ${(manage.data!.docker as { containers: unknown[] }).containers.length} containers`
                : ''}
            </p>
          </div>
        )}
      </Panel>
    </div>
  )
}
