import { useEffect, useRef, useState, type FormEvent } from 'react';

import { MAX_DISPLAY_NAME_LENGTH, type Member } from '@pulseboard/shared';

import { ApiRequestError } from '../api/client';
import { createSession } from '../api/session';
import styles from './JoinView.module.css';

export type JoinViewProps = {
  /** Called with the member the server created or recognized. */
  onJoined: (member: Member) => void;
  /**
   * A one-off message from before the form was shown — e.g. the session probe
   * could not reach the server. Never an error the user caused.
   */
  notice?: string | null;
};

type FieldErrors = {
  teamCode: string | null;
  displayName: string | null;
  form: string | null;
};

const NO_ERRORS: FieldErrors = { teamCode: null, displayName: null, form: null };

/**
 * Which field to focus, plus a nonce so asking for the same field twice in a
 * row still moves focus. It has to be a render-time effect rather than an
 * imperative call in the catch block: the inputs are disabled while the request
 * is in flight, and a disabled input cannot take focus.
 */
type FocusRequest = { field: 'teamCode' | 'displayName'; nonce: number };

/**
 * The app's only door (ADR 0005). A real `<form>`, so Enter submits; both
 * fields carry a `<label>`; and a rejection lands next to the field that caused
 * it, is announced with `role="alert"`, and takes focus.
 *
 * The team-code message is deliberately non-blaming (criterion A2): a wrong
 * code is usually a stale copy-paste, not a break-in.
 */
export function JoinView({ onJoined, notice = null }: JoinViewProps): JSX.Element {
  const [teamCode, setTeamCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const teamCodeRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest === null) {
      return;
    }
    const target = focusRequest.field === 'teamCode' ? teamCodeRef : displayNameRef;
    target.current?.focus();
  }, [focusRequest]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) {
      return;
    }

    setErrors(NO_ERRORS);
    setPending(true);

    try {
      onJoined(await createSession({ teamCode, displayName }));
    } catch (error: unknown) {
      const code = error instanceof ApiRequestError ? error.code : 'NETWORK';
      const message =
        error instanceof ApiRequestError
          ? error.message
          : 'Something went wrong. Please try again.';

      if (code === 'INVALID_TEAM_CODE') {
        setErrors({ ...NO_ERRORS, teamCode: message });
        setFocusRequest((previous) => ({ field: 'teamCode', nonce: (previous?.nonce ?? 0) + 1 }));
      } else if (code === 'INVALID_DISPLAY_NAME') {
        setErrors({ ...NO_ERRORS, displayName: message });
        setFocusRequest((previous) => ({
          field: 'displayName',
          nonce: (previous?.nonce ?? 0) + 1,
        }));
      } else {
        // A network failure or a 500: never a status code, never a stack trace.
        setErrors({ ...NO_ERRORS, form: message });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="join-heading" data-testid="join-view">
      <h2 id="join-heading" className={styles.heading}>
        Join the board
      </h2>
      <p className={styles.intro}>
        Enter the team code someone shared with you, pick the name your teammates will see, and you
        are in. No password, no account to set up.
      </p>

      {notice !== null && (
        <p className={styles.notice} role="status" data-testid="join-notice">
          {notice}
        </p>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="join-team-code">
            Team code
          </label>
          <input
            id="join-team-code"
            className={styles.input}
            ref={teamCodeRef}
            type="text"
            name="teamCode"
            value={teamCode}
            onChange={(event) => {
              setTeamCode(event.target.value);
            }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            aria-invalid={errors.teamCode !== null}
            aria-describedby={errors.teamCode === null ? undefined : 'join-team-code-error'}
            data-testid="join-team-code"
          />
          {errors.teamCode !== null && (
            <p
              id="join-team-code-error"
              className={styles.error}
              role="alert"
              data-testid="join-team-code-error"
            >
              {errors.teamCode}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="join-display-name">
            Display name
          </label>
          <input
            id="join-display-name"
            className={styles.input}
            ref={displayNameRef}
            type="text"
            name="displayName"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            autoComplete="nickname"
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            disabled={pending}
            aria-invalid={errors.displayName !== null}
            aria-describedby={errors.displayName === null ? undefined : 'join-display-name-error'}
            data-testid="join-display-name"
          />
          {errors.displayName !== null && (
            <p
              id="join-display-name-error"
              className={styles.error}
              role="alert"
              data-testid="join-display-name-error"
            >
              {errors.displayName}
            </p>
          )}
        </div>

        {errors.form !== null && (
          <p className={styles.error} role="alert" data-testid="join-form-error">
            {errors.form}
          </p>
        )}

        <button
          className={styles.submit}
          type="submit"
          disabled={pending}
          data-testid="join-submit"
        >
          {pending ? 'Joining…' : 'Join the board'}
        </button>
      </form>
    </section>
  );
}
