const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:19901';
const SINK_URL = process.env['E2E_SINK_URL'] ?? 'http://localhost:14242';

async function isUp(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/** Fails fast with a helpful message when the docker stack is not running. */
export default async function setup() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await isUp(`${API_URL}/ready`)) && (await isUp(`${SINK_URL}/health`))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `LocalStripe stack is not reachable at ${API_URL}. Start it with: pnpm e2e:up`,
  );
}
