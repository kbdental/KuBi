import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { installDemoBackend, signInAs, resetDemo, PEOPLE } from './demo-backend.js';
import './styles.css';

/**
 * The real app, packaged as one file.
 *
 * Every screen below is the product's own component. Only the thing answering
 * the requests is different — see demo-backend.ts, which says plainly what it
 * is and is not.
 *
 * The strip at the top is demo scaffolding, not part of KuBi. Switching people
 * is how you see the whole morning: an assistant hits a block she may not
 * release, the manager releases it, reception runs the day.
 */

installDemoBackend();

const WHO: Record<string, string> = {
  priya: 'Priya · assistant',
  rahul: 'Rahul · manager',
  anita: 'Anita · senior assistant',
  kavita: 'Kavita · reception',
};

function Demo() {
  const [who, setWho] = useState('priya');
  const [epoch, setEpoch] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    signInAs('priya');
    setReady(true);
  }, []);

  function switchTo(key: string) {
    signInAs(key);
    setWho(key);
    setEpoch((n) => n + 1); // remount the app so it reloads as that person
  }

  function startOver() {
    resetDemo();
    setEpoch((n) => n + 1);
  }

  if (!ready) return null;

  return (
    <>
      <div className="demo-bar">
        <div className="demo-top">
          <span className="demo-tag">Demo</span>
          <span className="demo-hint">Switch person to see the whole morning</span>
          <button type="button" className="demo-reset" onClick={startOver}>
            Start again
          </button>
        </div>
        <div className="demo-people">
          {PEOPLE.map((p) => (
            <button
              key={p.key}
              type="button"
              className={p.key === who ? 'demo-who is-on' : 'demo-who'}
              onClick={() => switchTo(p.key)}
            >
              {WHO[p.key]}
            </button>
          ))}
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
