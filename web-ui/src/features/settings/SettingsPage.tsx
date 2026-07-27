import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import styles from './SettingsPage.module.css'

export function SettingsPage() {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const { consumePending } = usePendingAddGo()
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
      consumePending()
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
    <div className={styles.page}>
      <header className={styles.head}>
        <h2>Settings</h2>
        <p className="ghost">Account and host storage</p>
      </header>

      <Panel title="GitHub" hint="Deploy Go apps from your repositories.">
        {gh.isLoading ? (
          <Spinner label="Checking GitHub…" />
        ) : gh.data?.connected ? (
          <div className={styles.ghConnected}>
            <div className={styles.chip}>
              <span className={styles.dot} />
              {(gh.data.user && gh.data.user.login) || 'GitHub'}
            </div>
            <p className="ghost">Connected. Disconnect to switch accounts.</p>
            <Button variant="dangerSoft" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className={styles.ghForm}>
            <p className="ghost">Paste a personal access token with repo read. Stored on this Pi only.</p>
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
              loading={connect.isPending}
              disabled={!token.trim()}
              onClick={() => connect.mutate()}
            >
              Connect
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Storage" hint="Disk, Docker inventory, and the shared Postgres engine.">
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
          <div className={styles.storage}>
            <div className={styles.engineRow}>
              <div>
                <strong>Shared Postgres</strong>
                <p className="ghost">{engine.data?.postgres_running ? 'Running' : 'Stopped'}</p>
              </div>
              <div className={styles.actions}>
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
                  onClick={() => {
                    void manage.refetch()
                    void engine.refetch()
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>
            <p className="ghost">
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
