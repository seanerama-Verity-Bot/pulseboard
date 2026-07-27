import { useState, type FormEvent } from 'react';

import {
  countCharacters,
  MAX_UPDATE_LENGTH,
  MOODS,
  type Mood,
  type Update,
} from '@pulseboard/shared';

import { ApiRequestError } from '../api/client';
import { createUpdate } from '../api/updates';
import styles from './ComposerView.module.css';

export type ComposerViewProps = {
  /** Called with the update the server created, once it is durably stored. */
  onPosted: (update: Update) => void;
};

/** Sentence-case labels for the four moods. The wire values stay lowercase. */
const MOOD_LABELS: Record<Mood, string> = {
  focused: 'Focused',
  cruising: 'Cruising',
  blocked: 'Blocked',
  away: 'Away',
};

/**
 * One human message per `error.code` (`http-api-v1`'s registry). The composer
 * never renders a status number, a raw status line or a stack trace — and never
 * falls back to "something went wrong" for a code it could have explained.
 */
const ERROR_MESSAGES: Record<string, string> = {
  TEXT_EMPTY: 'Write a line about what you are up to before posting.',
  TEXT_TOO_LONG: `That is longer than ${MAX_UPDATE_LENGTH} characters. Trim it a little and post again.`,
  INVALID_MOOD: 'Pick one of the four moods before posting.',
  NOT_AUTHENTICATED: 'Your session has ended. Please join the board again to post.',
  NETWORK: 'We could not reach the board just now. Please check your connection and try again.',
};

const FALLBACK_ERROR_MESSAGE = 'We could not post that just now. Please try again.';

/** No mood is chosen for you: posting a mood the member did not pick is a lie. */
const NO_MOOD_MESSAGE = 'Pick the mood that fits before posting.';

function messageForCode(code: string): string {
  return ERROR_MESSAGES[code] ?? FALLBACK_ERROR_MESSAGE;
}

/**
 * The composer (spec feature 2): a textarea, a mood picker over exactly the
 * four moods, and a submit button.
 *
 * Three things here are deliberate rather than incidental:
 *
 * - The counter counts **code points**, using the same `countCharacters` the
 *   server's `validateUpdateText` uses. Two implementations that "obviously
 *   agree" is how a 280-emoji post gets accepted by the counter and rejected by
 *   the server.
 * - The mood picker is a `<fieldset>` of native `<input type="radio">`s, so
 *   arrow-key navigation, the roving tab stop and the label/legend association
 *   come from the platform rather than from hand-rolled ARIA.
 * - The counter is a **courtesy**. Over the limit it warns and disables submit,
 *   but a `TEXT_TOO_LONG` from a stale client still renders as a polite
 *   sentence: the server is the authority (criterion A7).
 */
export function ComposerView({ onPosted }: ComposerViewProps): JSX.Element {
  const [text, setText] = useState('');
  const [mood, setMood] = useState<Mood | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trimmed, because the server trims before it measures.
  const used = countCharacters(text.trim());
  const remaining = MAX_UPDATE_LENGTH - used;
  const overLimit = remaining < 0;
  const empty = used === 0;

  const counterText = overLimit
    ? `${-remaining} characters over the limit`
    : `${remaining} characters left`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // The in-flight guard. Together with `disabled` on the button this is what
    // makes a double-click one update rather than two.
    if (pending) {
      return;
    }

    // Belt and braces: submit is already disabled until a mood is picked, but a
    // form can also be submitted with Enter, and nothing here may guess a mood
    // on the member's behalf.
    if (mood === null) {
      setError(NO_MOOD_MESSAGE);
      return;
    }

    setError(null);
    setPending(true);

    try {
      const update = await createUpdate({ text, mood });

      // Back to the board: the composer is empty and ready for the next one.
      setText('');
      setMood(null);
      onPosted(update);
    } catch (caught: unknown) {
      setError(
        caught instanceof ApiRequestError ? messageForCode(caught.code) : FALLBACK_ERROR_MESSAGE,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="composer-heading" data-testid="composer">
      <h2 id="composer-heading" className={styles.heading}>
        Post an update
      </h2>

      <form
        className={styles.form}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="composer-text">
            What are you up to?
          </label>
          <textarea
            id="composer-text"
            className={styles.textarea}
            name="text"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            rows={3}
            disabled={pending}
            aria-invalid={overLimit}
            aria-describedby="composer-counter"
            data-testid="composer-text"
          />
          {/*
            `role="status"` rather than an alert: it changes on every keystroke,
            and a screen reader should mention it, not interrupt for it.
          */}
          <p
            id="composer-counter"
            className={overLimit ? `${styles.counter} ${styles.counterOver}` : styles.counter}
            role="status"
            data-over={overLimit ? 'true' : 'false'}
            data-testid="composer-counter"
          >
            {counterText}
          </p>
        </div>

        <fieldset className={styles.moods} disabled={pending} data-testid="composer-moods">
          <legend className={styles.label}>Mood</legend>
          <div className={styles.moodRow}>
            {MOODS.map((option) => (
              <label className={styles.mood} key={option}>
                <input
                  className={styles.moodInput}
                  type="radio"
                  name="mood"
                  value={option}
                  checked={mood === option}
                  onChange={() => {
                    setMood(option);
                  }}
                  data-testid={`composer-mood-${option}`}
                />
                <span className={styles.moodLabel}>{MOOD_LABELS[option]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error !== null && (
          <p className={styles.error} role="alert" data-testid="composer-error">
            {error}
          </p>
        )}

        <button
          className={styles.submit}
          type="submit"
          disabled={pending || overLimit || empty || mood === null}
          data-testid="composer-submit"
        >
          {pending ? 'Posting…' : 'Post update'}
        </button>
      </form>
    </section>
  );
}
