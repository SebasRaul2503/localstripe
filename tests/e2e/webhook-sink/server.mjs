// A tiny webhook receiver used by the end-to-end suite. It records every request so tests can
// assert on deliveries, and can be told to fail so retries can be exercised.
import { createServer } from 'node:http';

const received = [];
// Remaining forced failures per webhook path, so tests can fail one endpoint without affecting others.
const failNext = new Map();

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://sink');
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');

    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'GET' && url.pathname === '/received') {
      const eventId = url.searchParams.get('event');
      return send(res, 200, eventId ? received.filter((entry) => entry.eventId === eventId) : received);
    }
    if (req.method === 'DELETE' && url.pathname === '/received') {
      received.length = 0;
      failNext.clear();
      return send(res, 200, { cleared: true });
    }
    if (req.method === 'POST' && url.pathname === '/fail-next') {
      const path = url.searchParams.get('path') ?? '/webhooks';
      failNext.set(path, Number(url.searchParams.get('count') ?? '1'));
      return send(res, 200, { path, count: failNext.get(path) });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/webhooks')) {
      const remaining = failNext.get(url.pathname) ?? 0;
      const failed = remaining > 0;
      if (failed) failNext.set(url.pathname, remaining - 1);
      let eventId = null;
      try {
        eventId = JSON.parse(body).id ?? null;
      } catch {
        // Recorded as-is; the test decides what to do with an unparsable body.
      }
      received.push({ eventId, path: url.pathname, headers: req.headers, body, respondedWith: failed ? 500 : 200 });
      return send(res, failed ? 500 : 200, { received: !failed });
    }
    send(res, 404, { error: 'not found' });
  });
}).listen(4242, () => console.log('webhook sink listening on :4242'));
