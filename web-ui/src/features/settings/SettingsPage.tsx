import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, FolderGit2, RefreshCw } from 'lucide-react'
import {
  clearGitHubToken,
  engineAction,
  fetchEngine,
  fetchGitHubStatus,
  fetchManage,
  saveGitHubToken,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input } from '@/components/ui/Field/Field'
import { Panel } from '@/components/ui/Panel/Panel'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { usePendingAddGo } from '@/features/projects/pendingAddGo'
import { PageHeader, PageSub } from '@/components/ui/PageHeader/PageHeader'
import { muted } from '@/lib/ui'

export function SettingsPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const { pending, consumePending } = usePendingAddGo()
  const [token, setToken] = useState('')

  const gh = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })
  const manage = useQuery({ queryKey: queryKeys.manage, queryFn: fetchManage })
  const engine = useQuery({ queryKey: queryKeys.engine, queryFn: fetchEngine })

  const connect = useMutation({
    mutationFn: () => saveGitHubToken(token.trim()),
    onSuccess: async () => {
      setToken('')
      showToast('GitHub connected')
      await qc.invalidateQueries({ queryKey: queryKeys.githubStatus })
      if (pending) consumePending()
      else navigate('/code')
    },
    onError: (e: Error) => showToast(e.message || 'GitHub failed'),
  })

  const disconnect = useMutation({
    mutationFn: clearGitHubToken,
    onSuccess: async () => {
      showToast('Disconnected')
      await qc.invalidateQueries({ queryKey: queryKeys.githubStatus })
    },
    onError: (e: Error) => showToast(e.message || 'Disconnect failed'),
  })

  const engStart = useMutation({
    mutationFn: () => engineAction('start'),
    onSuccess: async () => {
      showToast('Postgres started')
      await qc.invalidateQueries({ queryKey: queryKeys.engine })
    },
    onError: (e: Error) => showToast(e.message || 'Start failed'),
  })

  const engStop = useMutation({
    mutationFn: () => engineAction('stop'),
    onSuccess: async () => {
      showToast('Postgres stopped')
      await qc.invalidateQueries({ queryKey: queryKeys.engine })
    },
    onError: (e: Error) => showToast(e.message || 'Stop failed'),
  })

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <PageHeader title="Settings">
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
          <Spinner label="Checking GitHub…" />
        ) : gh.data?.connected ? (
          <div className="grid justify-items-start gap-3">
            <div className="badge badge-success badge-lg gap-2">
              <span className="status status-success" />
              {(gh.data.user && gh.data.user.login) || 'GitHub'}
            </div>
            <p className={`text-sm ${muted} m-0`}>Connected. Disconnect to switch accounts.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<FolderGit2 className="h-4 w-4" aria-hidden />}
                onClick={() => navigate('/code')}
              >
                Browse code
              </Button>
              <Button variant="dangerSoft" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid w-full max-w-md gap-3 justify-items-start">
            <p className={`text-sm ${muted} m-0`}>
              Paste a personal access token with repo read. Stored on this Pi only.
            </p>
            <Field label="Personal access token" meta="github_pat_…" htmlFor="settings-gh-token">
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
          <Spinner label="Loading storage…" />
        ) : manage.isError ? (
          <Empty
            title="Could not load storage"
            body={(manage.error as Error).message}
            action={
              <Button variant="primary" onClick={() => manage.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="block">Shared Postgres</strong>
                <p className={`text-sm ${muted} m-0 mt-0.5`}>
                  {engine.data?.postgres_running ? 'Running' : 'Stopped'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {engine.data?.postgres_running ? (
                  <Button variant="dangerSoft" loading={engStop.isPending} onClick={() => engStop.mutate()}>
                    Stop
                  </Button>
                ) : (
                  <Button variant="primary" loading={engStart.isPending} onClick={() => engStart.mutate()}>
                    Start
                  </Button>
                )}
                <Button
                  variant="quiet"
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
            <p className={`text-sm ${muted} m-0`}>
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
