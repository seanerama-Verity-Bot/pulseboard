import { type ReactNode } from 'react';

import styles from './AppShell.module.css';

export type AppShellProps = {
  children: ReactNode;
};

/**
 * The one shell every view mounts inside: a header and a `<main>` sharing the
 * same content column. Later stages add routes *inside* `children` and never
 * around this component — which is also what keeps a future Act 2 Guide mount
 * to a single line (ADR 0009). No Guide code exists yet.
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={`pb-column ${styles.headerInner}`}>
          <h1 className={styles.title}>Pulseboard</h1>
          <p className={styles.tagline}>What the team is up to, right now.</p>
        </div>
      </header>

      <main className={styles.main}>
        <div className="pb-column">{children}</div>
      </main>
    </div>
  );
}
