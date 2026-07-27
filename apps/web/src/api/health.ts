import { type HealthResponse } from '@pulseboard/shared';

/**
 * Same-origin in production and, thanks to the Vite proxy, in dev too — so no
 * base URL is ever configured on the client.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/healthz', {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`The server answered ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    (body as { status?: unknown }).status !== 'ok' ||
    typeof (body as { version?: unknown }).version !== 'string'
  ) {
    throw new Error('The server answered with an unexpected shape.');
  }

  return body as HealthResponse;
}
