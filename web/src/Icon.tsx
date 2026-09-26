/** One hand-drawn icon set: 24px grid, a single round-capped stroke, like a marker line. */
const paths = {
  first: 'M6 5v14 M18 6l-8 6 8 6z',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  forward: 'M5 12h14 M13 6l6 6-6 6',
  play: 'M7 5.5v13l11-6.5z',
  pause: 'M8 5v14 M16 5v14',
  replay: 'M4.5 12a7.5 7.5 0 1 0 2.3-5.4 M4.5 4.5v4h4',
  over: 'M4 16c1.5-6 14.5-6 16 0 M20 16l-3.5-1.2 M20 16l.9-3.5',
  out: 'M12 19V6 M7 10l5-5 5 5 M5 20h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 7.5v.5',
  expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  restore: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
  close: 'M6 6l12 12 M18 6L6 18',
  chevron: 'M6 9l6 6 6-6',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  open: 'M4 7.5V19h16V9.5h-8L10 7H4z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  external: 'M14 5h5v5 M19 5l-8 8 M17 14v5H5V7h5',
  run: 'M8 5.5v13l11-6.5z',
  export: 'M12 15V4 M7.5 8.5L12 4l4.5 4.5 M5 13.5V20h14v-6.5',
} as const;

export type IconName = keyof typeof paths;

export function Icon({name, size = 18, className = ''}: {name: IconName; size?: number; className?: string}) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>;
}

/** The sprout, drawn as the brand mark: two green leaves off one ink stem, over a line of soil. */
export function SproutMark({size = 30}: {size?: number}) {
  return <svg className="sprout-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path className="sprout-stem" d="M16 29V15" />
    <path className="sprout-leaf left" d="M16 17C10.5 17.5 6 14.5 5.5 8.5 11.5 8 15.5 11.5 16 17z" />
    <path className="sprout-leaf right" d="M16 14.5C16.5 8.5 20.5 4.5 27 4.5 27 11 22 15 16 14.5z" />
    <path className="sprout-soil" d="M8 29h16" />
  </svg>;
}
