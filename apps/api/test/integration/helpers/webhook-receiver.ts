import { type IncomingHttpHeaders, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  headers: IncomingHttpHeaders;
  body: string;
}

export interface WebhookReceiver {
  url: string;
  received: ReceivedWebhook[];
  /** The HTTP status the receiver answers with (200 by default). */
  respondWith(status: number): void;
  close(): Promise<void>;
}

/** A local HTTP endpoint on an ephemeral port that records every webhook it receives. */
export async function startWebhookReceiver(): Promise<WebhookReceiver> {
  const received: ReceivedWebhook[] = [];
  let status = 200;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(status, { 'content-type': 'text/plain' }).end(`status ${status}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/webhooks`,
    received,
    respondWith(next) {
      status = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
