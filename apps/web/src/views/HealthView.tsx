import { useEffect, useState } from 'react';

import { type HealthResponse } from '@pulseboard/shared';

import { fetchHealth } from '../api/health';
import styles from './HealthView.module.css';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  | { kind: 'failed'; reason: string };

/**
 * The walking skeleton's only view: it proves the browser can reach the API
 * this process serves. There is no blank-screen state — loading, success and
 * failure all render something a human can act on.
 */
export function HealthView(): JSX.Element {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetchHealth(controller.signal)
      .then((health) => {
        if (active) {
          setState({ kind: 'ok', health });
        }
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setState({
          kind: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown error.',
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <section className={styles.card} aria-labelledby="health-heading">
      <h2 id="health-heading" className={styles.heading}>
        Service health
      </h2>

      {state.kind === 'loading' && (
        <p className={`${styles.status} ${styles.pending}`} data-testid="health-status">
          Checking the server…
        </p>
      )}

      {state.kind === 'ok' && (
        <>
          <p className={styles.status} data-testid="health-status">
            Server status: <span className={styles.ok}>ok</span>
          </p>
          <p className={styles.detail} data-testid="health-version">
            Version {state.health.version}
          </p>
        </>
      )}

      {state.kind === 'failed' && (
        <>
          <p className={`${styles.status} ${styles.failed}`} data-testid="health-status">
            Server status: unreachable
          </p>
          <p className={styles.detail}>
            We could not reach the server just now. Nothing is lost — reload the page in a moment
            and it should come back. ({state.reason})
          </p>
        </>
      )}
    </section>
  );
}
