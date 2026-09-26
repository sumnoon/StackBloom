import type {Local} from './trace';
import './entries.css';

type Entries = NonNullable<Local['entries']>;

/** A pair key reads as (a, b), the way it is written in code, not as the printer's {first = a, second = b}. */
export function entryText(text: string) {
  const pair = /^\{first = (.*), second = (.*)\}$/.exec(text);
  return pair ? `(${pair[1]}, ${pair[2]})` : text;
}

/** What changed since the previous stop, per key: a new key, or a new value under an old key. */
function changes(entries: Entries, before?: Entries) {
  const old = new Map((before?.items ?? []).map(item => [item[0], item[1]]));
  return (item: string[]) => {
    if (!before) return {};
    if (!old.has(item[0])) return {fresh: true};
    const was = old.get(item[0]);
    return entries.kind === 'map' && was !== item[1] ? {was} : {};
  };
}

/** A map as a small key → value table and a set as a row of keys, marked where this stop changed them. */
export function EntryTable({entries, before, limit = 8}: {entries: Entries; before?: Entries; limit?: number}) {
  const status = changes(entries, before);
  const shown = entries.items.slice(0, limit);
  const more = entries.items.length - shown.length;
  const count = `${entries.items.length}${entries.truncated ? '+' : ''} ${entries.kind === 'map' ? 'entries' : 'keys'}`;
  if (!entries.items.length) return <code className="unset">empty {entries.kind}</code>;
  return <div className="entry-view">
    {entries.kind === 'map'
      ? <table className="entry-table">
          <tbody>{shown.map(item => {
            const {fresh, was} = status(item);
            return <tr key={item[0]} className={fresh ? 'entry-new' : undefined}>
              <th scope="row">{entryText(item[0])}</th>
              <td className="entry-arrow" aria-hidden="true">→</td>
              <td className={was !== undefined ? 'entry-changed' : undefined} title={was !== undefined ? `was ${was}` : undefined}>{entryText(item[1] ?? '')}</td>
            </tr>;
          })}</tbody>
        </table>
      : <ul className="entry-keys">{shown.map(item =>
          <li key={item[0]} className={status(item).fresh ? 'entry-new' : undefined}>{entryText(item[0])}</li>)}</ul>}
    <span className="entry-count">{count}{more > 0 ? `, ${more} more not shown` : ''}</span>
  </div>;
}
