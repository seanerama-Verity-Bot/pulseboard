import { useState } from 'react';

import { type Member } from '@pulseboard/shared';

import { deleteSession, SessionApiError } from '../api/session';
import styles from './SignedInView.module.css';

export type SignedInViewProps = {
  member: Member;
  /** Called once the server has cleared the cookie. */
  onSignedOut: () => void;
};

/**
 * The signed-in state: who the board thinks you are, and the way out. The board
 * itself arrives in Stage 4; this is the identity strip it will sit under.
 */
export function SignedInView({ member, onSignedOut }: SignedInViewProps): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    if (pending) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      await deleteSession();
      onSignedOut();
    } catch (caught: unknown) {
      setError(
        caught instanceof SessionApiError
          ? caught.message
          : 'We could not sign you out just now. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={styles.card}
      aria-labelledby="signed-in-heading"
      data-testid="signed-in-view"
    >
      <h2 id="signed-in-heading" className={styles.heading}>
        You are on the board
      </h2>

      <div className={styles.row}>
        <p className={styles.identity}>
          Signed in as{' '}
          <span className={styles.name} data-testid="session-member-name">
            {member.displayName}
          </span>
        </p>

        <button
          className={styles.signOut}
          type="button"
          onClick={() => {
            void handleSignOut();
          }}
          disabled={pending}
          data-testid="sign-out"
        >
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      {error !== null && (
        <p className={styles.error} role="alert" data-testid="sign-out-error">
          {error}
        </p>
      )}
    </section>
  );
}
