import { type Mood, type Update } from '@pulseboard/shared';

import styles from './PostedUpdatesView.module.css';

export type PostedUpdatesViewProps = {
  /** Newest first. */
  updates: Update[];
};

const MOOD_LABELS: Record<Mood, string> = {
  focused: 'Focused',
  cruising: 'Cruising',
  blocked: 'Blocked',
  away: 'Away',
};

/**
 * "Return to the board" (spec feature 2), at the only fidelity Stage 3 can
 * honestly offer: the updates posted from this tab, newest first, straight from
 * the server's `201` response.
 *
 * It is deliberately **not** a board. There is no read endpoint yet —
 * `GET /api/board` and its grouping, mood badges and 3-second polling are
 * Stage 4 — so this list starts empty after a reload. The row itself is durable
 * the moment the server answered; what is missing is the way to read it back,
 * not the storage.
 */
export function PostedUpdatesView({ updates }: PostedUpdatesViewProps): JSX.Element {
  return (
    <section
      className={styles.card}
      aria-labelledby="posted-updates-heading"
      data-testid="posted-updates"
    >
      <h2 id="posted-updates-heading" className={styles.heading}>
        Posted just now
      </h2>

      {updates.length === 0 ? (
        <p className={styles.empty} data-testid="posted-updates-empty">
          Nothing posted from this tab yet. Whatever you post will appear here, and on the full team
          board once it lands.
        </p>
      ) : (
        <ul className={styles.list} data-testid="update-list">
          {updates.map((update) => (
            <li
              className={styles.item}
              key={update.id}
              data-mood={update.mood}
              data-testid="update-item"
            >
              <div className={styles.meta}>
                <span className={styles.author} data-testid="update-item-author">
                  {update.authorName}
                </span>
                <span className={styles.mood} data-testid="update-item-mood">
                  {MOOD_LABELS[update.mood]}
                </span>
              </div>
              <p className={styles.text} data-testid="update-item-text">
                {update.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
