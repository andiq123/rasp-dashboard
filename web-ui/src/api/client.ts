const MAX = 6
let inflight = 0
const queue: Array<() => void> = []

function pump() {
  while (queue.length && inflight < MAX) {
    const next = queue.shift()
    if (next) next()
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type ApiOpts = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      inflight++
      const init: RequestInit = {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: opts.signal,
      }
      if (opts.body !== undefined) {
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
      }
      fetch(path, init)
        .then(async (r) => {
          if (!r.ok) {
            const txt = (await r.text()).trim()
            throw new ApiError(txt || r.statusText || 'Request failed', r.status)
          }
          try {
            return (await r.json()) as T
          } catch {
            return {} as T
          }
        })
        .then(resolve, reject)
        .finally(() => {
          inflight--
          pump()
        })
    }
    if (inflight >= MAX) queue.push(run)
    else run()
  })
}
