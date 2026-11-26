export type HopState = 'ok' | 'bad' | 'idle'

export type Hop = {
  label: string
  detail: string
  state: HopState
}

type Props = {
  hops: Hop[]
  /** A repair is running: the first broken link shows progress instead of a break. */
  recovering?: boolean
}

function linkTone(from: Hop, to: Hop, recovering: boolean): string {
  if (from.state !== 'ok') return 'tone-idle'
  if (to.state === 'ok') return 'tone-ok'
  return recovering ? 'tone-busy' : 'tone-bad'
}

/** The path a client's traffic takes, each hop lit by its own health. */
export function RouteTrace({ hops, recovering = false }: Props) {
  return (
    <ol className="route" aria-label="Traffic route">
      {hops.map((hop, i) => (
        <li key={hop.label} className="contents">
          {i > 0 ? <span className={`route-link ${linkTone(hops[i - 1], hop, recovering)}`} aria-hidden /> : null}
          <div className={`route-hop tone-${hop.state}`}>
            <span className="route-hop-head">
              <span className="dot" aria-hidden />
              {hop.label}
            </span>
            <span className="route-hop-sub" title={hop.detail}>
              <span className="sr-only">{hop.state === 'ok' ? 'Healthy: ' : hop.state === 'bad' ? 'Failing: ' : 'Waiting: '}</span>
              {hop.detail}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
