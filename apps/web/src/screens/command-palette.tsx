/**
 * The command palette — Ctrl-K.
 *
 * The problem this solves is not finding things. It is that a clinic system
 * with thirty operational concepts cannot be learned by exploring menus, and
 * a new assistant on her first morning should not have to. One box, everything
 * in it, no navigation.
 *
 * It is the only thing on the review list that *removes* navigation rather
 * than adding to it, which is why it was worth building when the instruction
 * was to stop adding screens.
 *
 * Three rules it keeps:
 *
 * 1. **Keyboard first, but not keyboard only.** A receptionist on a tablet has
 *    no Ctrl key, so there is a visible way in as well.
 * 2. **Never a dead end.** Every result goes somewhere. A row that matched and
 *    cannot be opened is worse than no row.
 * 3. **It closes on Escape, on choosing, and on clicking away.** A modal with
 *    one exit is a trap, and this one opens on a keystroke people press by
 *    accident.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type SearchHit } from '../api.js';

const KIND_ORDER = [
  'Patient', 'Problem', 'Task', 'Lab case', 'Equipment', 'Stock',
  'Standard', 'Person', 'Go to',
];

export function CommandPalette({
  open, onClose, onGo, onOpenPatient,
}: {
  open: boolean;
  onClose: () => void;
  onGo: (place: string) => void;
  onOpenPatient: (patientLabel: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setCursor(0);
      // Focus after paint, or the keystroke that opened it lands in the page.
      requestAnimationFrame(() => box.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let alive = true;
    // Debounced: a fast typist would otherwise fire a request per keystroke
    // and get results back out of order.
    const t = setTimeout(() => {
      void api.search(term).then((r) => { if (alive) { setHits(r); setCursor(0); } })
        .catch(() => { if (alive) setHits([]); });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);

  if (!open) return null;

  function choose(h: SearchHit) {
    onClose();
    if (h.patient) onOpenPatient(h.patient);
    else if (h.go) onGo(h.go);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); choose(hits[cursor]!); }
  }

  const grouped = KIND_ORDER
    .map((kind) => ({ kind, rows: hits.filter((h) => h.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="cp-scrim" onMouseDown={onClose} role="presentation">
      <div
        className="cp"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
      >
        <input
          ref={box}
          className="cp-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search patients, standards, equipment, anything…"
          aria-label="Search"
        />

        {q.trim().length < 2 ? (
          <p className="cp-hint">
            Type two letters. Patients, lab cases, equipment, stock, tasks, problems,
            people and all 101 standards.
          </p>
        ) : hits.length === 0 ? (
          <p className="cp-hint">Nothing matches “{q.trim()}”.</p>
        ) : (
          <ul className="cp-list">
            {grouped.map((g) => (
              <li key={g.kind}>
                <div className="cp-kind">{g.kind}</div>
                <ul className="cp-rows">
                  {g.rows.map((h) => {
                    const i = hits.indexOf(h);
                    return (
                      <li key={`${h.kind}-${h.label}`}>
                        <button
                          className={`cp-row ${i === cursor ? 'is-on' : ''}`}
                          type="button"
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => choose(h)}
                        >
                          <span className="cp-label">{h.label.replace('SYNTHETIC ', '')}</span>
                          {h.detail && <span className="row-note">{h.detail}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="cp-foot">
          <span>↑↓ to move · ⏎ to open · esc to close</span>
        </div>
      </div>
    </div>
  );
}

/** Ctrl-K and ⌘K, from anywhere. */
export function useCommandKey(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}
