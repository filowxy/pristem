import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCw, Lightbulb } from 'lucide-react';
import { t } from '../i18n';
import type { TranscriptItem } from '../types';

export interface CallRow {
  uid: string;
  ts?: number;
  tool: string;
  verdict?: string;
  status?: string;
  output?: string;
  speech?: string;
}

/** Group adjacent call/result pairs of the same tool into one foldable card. */
export function groupToolCalls(items: TranscriptItem[]): (TranscriptItem | { kind: 'toolGroup'; uid: string; tool: string; rows: CallRow[]; speech?: string })[] {
  const out: (TranscriptItem | { kind: 'toolGroup'; uid: string; tool: string; rows: CallRow[]; speech?: string })[] = [];
  let group: { kind: 'toolGroup'; uid: string; tool: string; rows: CallRow[]; speech?: string } | null = null;
  let lastSpeech: string | undefined;
  const flush = () => { if (group) out.push(group); group = null; };
  for (const it of items) {
    if (it.kind === 'speech') { lastSpeech = it.text; flush(); out.push(it); continue; }
    if (it.kind !== 'call' && it.kind !== 'result') { flush(); out.push(it); continue; }
    const tool = it.tool ?? 'tool';
    if (!group || group.tool !== tool) {
      if (group && group.rows.length >= 8) { flush(); }
      else if (!group) { /* start */ }
      else { flush(); }
      if (!group) group = { kind: 'toolGroup', uid: `g-${it.uid}`, tool, rows: [], speech: lastSpeech };
    }
    if (it.kind === 'call') {
      group.rows.push({ uid: it.uid, tool, verdict: it.verdict });
    } else {
      const row = group.rows[group.rows.length - 1];
      if (row && !row.status) { row.status = it.status; row.output = it.output; }
      else group.rows.push({ uid: it.uid, tool, status: it.status, output: it.output });
    }
  }
  flush();
  return out;
}

export function isToolGroup(x: TranscriptItem | { kind: string }): x is { kind: 'toolGroup'; uid: string; tool: string; rows: CallRow[]; speech?: string } {
  return (x as { kind: string }).kind === 'toolGroup';
}

function describeOutput(output?: string): { lines: number; query: string } {
  if (!output) return { lines: 0, query: '' };
  const m = /(\d+)\s+(?:lines|matches|行|结果)/i.exec(output);
  const lines = m ? Number(m[1]) : output.split('\n').filter(Boolean).length;
  return { lines, query: output.split('\n')[0]?.slice(0, 90) ?? '' };
}

export function ToolCard({ tool, rows, speech }: { tool: string; rows: CallRow[]; speech?: string }) {
  const [open, setOpen] = useState(false);
  const [rawFor, setRawFor] = useState<string | null>(null);
  const [thinkOpen, setThinkOpen] = useState(false);
  const shown = rows.slice(0, 8);
  const searching = /search|grep|find/i.test(tool);
  const title = searching
    ? t('toolCard.searched', { n: rows.length })
    : t('toolCard.executed', { n: rows.length });
  const totalLines = rows.reduce((n, r) => n + describeOutput(r.output).lines, 0);

  return (
    <div className="tool-card" data-state={rows.some((r) => !r.status) ? 'pending' : 'done'}>
      <button type="button" className="tool-card-head" aria-expanded={open} aria-controls={`body-${tool}`} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <RotateCw size={13} className="tool-card-icon" />
        <span className="tool-card-title">{title}</span>
        <span className="tool-card-stats">
          <span className="tool-card-stat-lines">{t('toolCard.lines', { n: totalLines })}</span>
          <span className="tool-card-stat-count">{t('toolCard.calls', { n: rows.length })}</span>
        </span>
      </button>
      <div className="tool-card-body" id={`body-${tool}`} hidden={!open}>
        <ol className="tool-card-list">
          {shown.map((r) => {
            const d = describeOutput(r.output);
            const bad = !!r.status && !/^ok$/i.test(r.status);
            return (
              <li key={r.uid} className="tool-card-item" data-state={bad ? 'blocked' : r.status ? 'ok' : 'pending'}>
                <span className="tool-card-rail" aria-hidden="true" />
                <div className="tool-card-item-main">
                  <span className="tool-card-item-summary">
                    {r.status
                      ? (d.lines > 0 ? t('toolCard.foundLines', { n: d.lines, query: d.query }) : t('toolCard.noResult'))
                      : t('toolCard.pending')}
                  </span>
                  <span className={`status-pill ${r.status ?? 'pending'}`}>{r.status ?? t('toolCard.pending')}</span>
                  {r.output && (
                    <button type="button" className="tool-card-raw-toggle" onClick={() => setRawFor((v) => v === r.uid ? null : r.uid)}>
                      {t('toolCard.raw')}
                    </button>
                  )}
                </div>
                {r.output && (
                  <pre className="tool-card-raw" hidden={rawFor !== r.uid}>
                    <code>{r.output}</code>
                  </pre>
                )}
              </li>
            );
          })}
        </ol>
        {rows.length > 8 && <span className="tool-card-more">{t('toolCard.more', { n: rows.length - 8 })}</span>}
        {speech && (
          <>
            <button type="button" className="tool-card-think" onClick={() => setThinkOpen((v) => !v)}>
              <Lightbulb size={12} /> {t('toolCard.think')} {thinkOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            <div className="tool-card-think-body" hidden={!thinkOpen}>{speech}</div>
          </>
        )}
      </div>
    </div>
  );
}
