/** Shared semantic class helpers — daisyUI tokens only. */
export const muted = 'text-base-content/60'

/** Primary card on page canvas */
export const surface = 'bg-base-100 border border-base-300 rounded-box shadow-sm'

/** Nested tile / inset within a card */
export const tile = 'bg-base-200/70 border border-base-300 rounded-box'

/** Selectable choice row (wizard / type pickers) */
export const choice =
  'flex w-full items-center gap-3 text-left p-3.5 rounded-box border border-base-300 bg-base-100 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors'

/** Icon chip inside a choice row */
export function iconWell(tone: 'primary' | 'success' = 'primary'): string {
  const colors =
    tone === 'success' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'
  return `grid h-10 w-10 shrink-0 place-items-center rounded-box ${colors}`
}

/** Code / file preview block */
export const codeSurface =
  'm-0 p-3 rounded-box bg-base-200 text-base-content border border-base-300 text-xs overflow-auto whitespace-pre-wrap break-words font-mono'
