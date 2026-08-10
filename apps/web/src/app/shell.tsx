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
  clinicName, items, here, go, who, whoRole, title, onSignOut, children,
}: {
  clinicName: string;
  items: readonly RailItem[];
  here: string;
  go: (id: string) => void;
  who: string;
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
            <span className="shell-avatar" aria-hidden="true">{initials(who)}</span>
          </div>
        </header>
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}

/** "SYNTHETIC Kavita R." → "KR". Two letters, because three is a monogram. */
function initials(name: string): string {
  const words = name.replace(/^SYNTHETIC\s+/i, '').split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0] ?? '' : '';
  return (first + last).toUpperCase();
}
