import { useEffect, useState } from 'react';

import { type Member, type Update } from '@pulseboard/shared';

import { NETWORK_ERROR_MESSAGE } from './api/client';
import { fetchSession } from './api/session';
import { AppShell } from './components/AppShell';
import { ComposerView } from './views/ComposerView';
import { HealthView } from './views/HealthView';
import { JoinView } from './views/JoinView';
import { PostedUpdatesView } from './views/PostedUpdatesView';
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
  /**
   * The updates posted from this tab, newest first — Stage 3's stand-in for the
   * board. Nothing is read back from the server yet: `GET /api/board` is Stage
   * 4, so this list is empty after a reload even though every row it showed is
   * still in the database.
   */
  const [posted, setPosted] = useState<Update[]>([]);

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
          <>
            <SignedInView
              member={session.member}
              onSignedOut={() => {
                // Somebody else may be about to join on this device: their
                // board must not open on the last person's updates.
                setPosted([]);
                setSession({ kind: 'anonymous', notice: null });
              }}
            />

            <ComposerView
              onPosted={(update) => {
                setPosted((previous) => [update, ...previous]);
              }}
            />

            <PostedUpdatesView updates={posted} />
          </>
        )}

        <HealthView />
      </div>
    </AppShell>
  );
}
