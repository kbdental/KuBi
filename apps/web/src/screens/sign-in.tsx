import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.js';

/**
 * Sign in. Two fields and one button, because that is the whole job.
 *
 * The failure message is deliberately the same whether the address is unknown
 * or the password is wrong — telling someone which half they got right tells
 * an attacker the same thing.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api.login(email.trim(), password);
      onSignedIn();
    } catch (err) {
      setProblem(
        err instanceof ApiError && err.status === 401
          ? "That email address and password don't match."
          : 'We could not sign you in just now. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <form className="signin" onSubmit={submit}>
      <div className="wordmark">KuBi</div>
      <p className="wordmark-sub">Your clinic, today.</p>

      {problem && (
        <div className="notice notice-stop" role="alert">
          {problem}
        </div>
      )}

      <label className="field-label" htmlFor="email">Email</label>
      <input
        id="email" className="field" type="email" autoComplete="username"
        autoCapitalize="none" autoCorrect="off" required
        value={email} onChange={(e) => setEmail(e.target.value)}
      />

      <label className="field-label" htmlFor="password">Password</label>
      <input
        id="password" className="field" type="password" autoComplete="current-password" required
        value={password} onChange={(e) => setPassword(e.target.value)}
      />

      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
