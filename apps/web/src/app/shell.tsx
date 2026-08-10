import type { ReactNode } from 'react';

/**
 * The shell: a left rail, and one thing at a time on the right.
 *
 * The owner's structure, from KuBi-V3. It replaces a row of horizontal tabs,
 * and the difference is not decoration — a rail has room for the name of the
 * clinic, for a count against an item, and for as many places as the product
 * eventually has. A tab row runs out at about seven and then starts hiding
 * things behind a chevron, which is where features go to be forgotten.
 *
 * Two items are named so far — the dashboard and clinic readiness. Everything
 * that already existed lives under More rather than being deleted, because a
 * screen somebody uses is not made obsolete by a new frame around it.
 */

export interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Shown as a pill on the right of the row. Omit for none. */
  count?: number;
  /** Draws the count in red rather than grey. Patient safety, not volume. */
  urgent?: boolean;
}

export function Shell({
  clinicName, items, here, go, whoRole, title, onSignOut, children,
}: {
  clinicName: string;
  items: readonly RailItem[];
  here: string;
  go: (id: string) => void;
  /**
   * The signed-in **role**, and deliberately not the person.
   *
   * The owner: *"please do not put a name to anything keep it role wise this
   * makes things simpler as names can change but roles do not change"*. He is
   * right about more than tidiness — every rule in the engine is written
   * against a role, so a screen that says "Priya" is showing something the
   * system does not actually reason about. The log still records which
   * employee did what; that is provenance, not the interface.
   */
  whoRole: string;
  /** The page's own name, in the bar above the content. */
  title: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <div className="rail-brand-name">KuBi</div>
          <div className="rail-brand-clinic">{clinicName}</div>
        </div>

        <nav className="rail-nav" aria-label="Sections">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-item ${here === item.id ? 'is-here' : ''}`}
              aria-current={here === item.id ? 'page' : undefined}
              onClick={() => go(item.id)}
            >
              <span className="rail-icon" aria-hidden="true">{item.icon}</span>
              <span className="rail-label">{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className={`rail-count ${item.urgent ? 'is-urgent' : ''}`}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          <button className="rail-signout" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="shell-body">
        <header className="shell-bar">
          <h1 className="shell-title">{title}</h1>
          <div className="shell-who">
            <span className="shell-who-role">{whoRole}</span>
            <span className="shell-avatar" aria-hidden="true">{roleMark(whoRole)}</span>
          </div>
        </header>
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}

/**
 * "Dental assistant" → "DA". The role's initials, never a person's.
 *
 * A single word gives its first two letters, so Reception is "RE" rather than
 * a lone R that could be anything.
 */
function roleMark(role: string): string {
  const words = role.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
