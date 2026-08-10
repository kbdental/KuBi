import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { Entry, PERSONAS } from './screens/entry.js';
import {
  installDemoBackend, signInAs, resetDemo, jumpToEndOfDay, PEOPLE,
} from './demo-backend.js';
import './styles.css';

/**
 * The real app, packaged as one file.
 *
 * Every screen below is the product's own component. Only the thing answering
 * the requests is different — see demo-backend.ts, which says plainly what it
 * is and is not.
 *
 * The bar at the top is demo scaffolding, but it is deliberately built in the
 * product's own colours rather than as a black "prototype" strip: a person
 * judging whether this looks like software they would use should be looking at
 * the software, not at a test harness wrapped around it. Switching person is
 * where an account menu would live, and it is how you see the whole morning —
 * an assistant hits a block she may not release, the manager releases it,
 * reception runs the day, the manager reads the numbers.
 */

installDemoBackend();

/**
 * One list, so the entry screen and the role menu cannot disagree.
 *
 * Roles, not names. The owner: *"names can change but roles do not change"* —
 * and every rule in the engine is written against a role, so the menu now
 * switches between the things the system actually reasons about.
 */
const WHO: Record<string, { role: string }> =
  Object.fromEntries(PERSONAS.map((p) => [p.key, { role: p.role }]));

/** "Dental assistant" → "DA". A role's mark, never a person's initials. */
const roleMark = (role: string) => {
  const words = role.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
};

function Demo() {
  // Null until somebody chooses. Opening straight into a stranger's shift at
  // 08:52 with no explanation is what made this feel abrupt.
  const [who, setWho] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [evening, setEvening] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => { setReady(true); }, []);

  // A menu that only closes by picking something from it is a trap on a phone.
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  function switchTo(key: string) {
    signInAs(key);
    setWho(key);
    setMenuOpen(false);
    setEpoch((n) => n + 1); // remount the app so it reloads as that person
  }

  function startOver() {
    resetDemo();
    setEvening(false);
    // All the way back to the front door, not to whoever you happened to be.
    setWho(null);
    setEpoch((n) => n + 1);
  }

  // A real clinic reaches closing time by working through eleven hours. Someone
  // reviewing the app in five minutes should not have to.
  function toEndOfDay() {
    jumpToEndOfDay();
    setEvening(true);
    setEpoch((n) => n + 1);
  }

  if (!ready) return null;

  if (!who) {
    return <Entry onEnter={(key) => { signInAs(key); setWho(key); }} />;
  }

  const current = WHO[who]!;

  return (
    <>
      <div className="demo-bar">
        <span className="demo-brand">KuBi</span>
        <span className="demo-sep" aria-hidden="true">/</span>
        <span className="demo-where">SYNTHETIC KB Dental Andheri</span>

        {!evening && (
          <button type="button" className="demo-reset" onClick={toEndOfDay}>
            <span className="demo-reset-long">Jump to </span>closing
          </button>
        )}
        <button type="button" className="demo-reset" onClick={startOver}>
          Start again
        </button>

        <div className="who-menu" ref={menu}>
          <button
            type="button"
            className="who-button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="who-avatar" aria-hidden="true">{roleMark(current.role)}</span>
            <span className="who-who">
              <span className="who-name">{current.role}</span>
            </span>
            <span className="who-caret" aria-hidden="true">▾</span>
          </button>

          {menuOpen && (
            <div className="who-panel" role="menu">
              <div className="who-panel-label">Signed in as</div>
              {PEOPLE.map((p) => {
                const w = WHO[p.key]!;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="menuitem"
                    className={p.key === who ? 'who-option is-on' : 'who-option'}
                    onClick={() => switchTo(p.key)}
                  >
                    <span className="who-avatar" aria-hidden="true">{roleMark(w.role)}</span>
                    <span className="who-who">
                      <span className="who-option-name">{w.role}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="demo-app">
        <App key={`${who}-${epoch}`} />
      </div>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
