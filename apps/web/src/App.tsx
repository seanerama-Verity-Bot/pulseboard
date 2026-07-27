import { useEffect, useState } from 'react';

import { type Member } from '@pulseboard/shared';

import { fetchSession, NETWORK_ERROR_MESSAGE } from './api/session';
import { AppShell } from './components/AppShell';
import { HealthView } from './views/HealthView';
import { JoinView } from './views/JoinView';
import { SignedInView } from './views/SignedInView';
import styles from './App.module.css';

/**
 * `checking` is the brief moment before the session probe answers; `anonymous`
 * carries an optional notice for the case where the probe could not reach the
 * server at all. A `401` from the probe is **not** that case — it is the normal
 * signal that nobody has joined yet, and it renders the join form with no error
 * of any kind.
 */
type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous'; notice: string | null }
  | { kind: 'signedIn'; member: Member };

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetchSession(controller.signal)
      .then((member) => {
        if (!active) {
          return;
        }
        setSession(
          member === null ? { kind: 'anonymous', notice: null } : { kind: 'signedIn', member },
        );
      })
      .catch(() => {
        if (!active || controller.signal.aborted) {
          return;
        }
        // The door stays open: show the form, and say plainly that the board
        // could not be reached. No status code, no stack trace.
        setSession({ kind: 'anonymous', notice: NETWORK_ERROR_MESSAGE });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <AppShell>
      <div className={styles.stack}>
        {session.kind === 'checking' && (
          <p className={styles.checking} data-testid="session-checking">
            Checking whether you are signed in…
          </p>
        )}

        {session.kind === 'anonymous' && (
          <JoinView
            notice={session.notice}
            onJoined={(member) => {
              setSession({ kind: 'signedIn', member });
            }}
          />
        )}

        {session.kind === 'signedIn' && (
          <SignedInView
            member={session.member}
            onSignedOut={() => {
              setSession({ kind: 'anonymous', notice: null });
            }}
          />
        )}

        <HealthView />
      </div>
    </AppShell>
  );
}
