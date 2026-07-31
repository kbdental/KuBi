import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
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

const WHO: Record<string, { name: string; role: string }> = {
  priya: { name: 'Priya S.', role: 'Dental assistant' },
  rahul: { name: 'Rahul M.', role: 'Clinic manager' },
  anita: { name: 'Anita K.', role: 'Senior assistant' },
  kavita: { name: 'Kavita R.', role: 'Reception' },
};

const initials = (name: string) =>
  name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2);

function Demo() {
  const [who, setWho] = useState('priya');
  const [epoch, setEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [evening, setEvening] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    signInAs('priya');
    setReady(true);
  }, []);

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
            <span className="who-avatar" aria-hidden="true">{initials(current.name)}</span>
            {/* No <br> between these: on a phone both are hidden and a stray
                line break would still take up a line inside the button. */}
            <span className="who-who">
              <span className="who-name">{current.name}</span>
              <span className="who-role">{current.role}</span>
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
                    <span className="who-avatar" aria-hidden="true">{initials(w.name)}</span>
                    <span className="who-who">
                      <span className="who-option-name">{w.name}</span>
                      <span className="who-option-role">{w.role}</span>
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
