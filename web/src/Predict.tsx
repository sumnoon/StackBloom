import {useEffect, useRef, useState} from 'react';
import {callHistory} from './callHistory';
import type {Trace} from './trace';
import './predict.css';

export type Question = {target: number; callId: string; label: string; value: string};

/** The return a step to `target` would reveal, if Predict mode should ask about it first.
 *  Pointer results are skipped: nobody can predict an address. */
export function findQuestion(trace: Trace, target: number, asked: Set<string>): Question | null {
  const stop = trace.snapshots[target];
  for (const item of stop?.returns ?? []) {
    if (item.value == null || asked.has(item.call_id) || /0x[0-9a-f]+/i.test(item.value)) continue;
    const node = callHistory(trace, target).nodes.get(item.call_id);
    if (!node) continue;
    const label = node.label.includes('?') ? node.frame.function : node.label;
    return {target, callId: item.call_id, label, value: item.value};
  }
  return null;
}

/** Loose enough for a learner's typing: numbers compare as numbers, quotes and case of true/false don't matter. */
function same(answer: string, value: string) {
  const clean = (text: string) => text.trim().replace(/^(['"])(.*)\1$/, '$2');
  const a = clean(answer), b = clean(value);
  if (a !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) === Number(b);
  if (/^(true|false)$/i.test(a)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function PredictCard({question, score, onScore, onContinue, onSkip}: {
  question: Question; score: {right: number; total: number};
  onScore: (right: boolean) => void; onContinue: () => void; onSkip: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {setAnswer(''); setVerdict(null); input.current?.focus();}, [question.callId]);
  useEffect(() => {if (verdict !== null) next.current?.focus();}, [verdict]);

  const check = () => {
    if (!answer.trim() || verdict !== null) return;
    const right = same(answer, question.value);
    setVerdict(right);
    onScore(right);
  };
  return <section className="predict-card" role="region" aria-label="Predict the return value"
    onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); onSkip();}}}>
    <h2>Predict</h2>
    <p className="predict-question"><code>{question.label}</code> is about to return. What will it give back?</p>
    {verdict === null
      ? <form className="predict-form" onSubmit={event => {event.preventDefault(); check();}}>
          <label className="sr-only" htmlFor="predict-answer">Your prediction</label>
          <input id="predict-answer" ref={input} value={answer} onChange={event => setAnswer(event.target.value)}
            autoComplete="off" spellCheck={false} placeholder="your answer" />
          <button type="submit" className="primary" disabled={!answer.trim()}>Check</button>
        </form>
      : <p className={`predict-verdict ${verdict ? 'right' : 'wrong'}`} aria-live="polite">
          {verdict ? <>Right: it returns <code>{question.value}</code>.</>
            : <>Not this time: it returns <code>{question.value}</code>, you said <code>{answer.trim()}</code>.</>}
        </p>}
    <div className="predict-foot">
      <span className="predict-score">{score.total ? `${score.right} of ${score.total} right` : 'Step on to check it'}</span>
      {verdict === null
        ? <button type="button" className="ghost" onClick={onSkip}>Skip</button>
        : <button type="button" ref={next} className="primary" onClick={onContinue}>Continue</button>}
    </div>
  </section>;
}
