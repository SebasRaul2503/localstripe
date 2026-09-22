import { describe, expect, it } from 'vitest';
import { AuthenticationError } from '@localstripe/sdk';
import { formatError } from '../src/errors.js';
import { createProgram } from '../src/program.js';

interface Recorded {
  url: URL;
  method: string;
  headers: Headers;
}

function run(args: string[], responses: unknown[] = [], env: Record<string, string> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requests: Recorded[] = [];
  const queue = [...responses];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: new URL(String(input)),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
    });
    const next = queue.shift() as { status?: number; body: unknown } | undefined;
    return new Response(JSON.stringify(next?.body ?? {}), {
      status: next?.status ?? 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_cli' },
    });
  }) as typeof globalThis.fetch;
  const program = createProgram({
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    env,
    color: false,
    readFile: () => undefined,
    fetch,
  });
  const done = program.parseAsync(['node', 'localstripe', ...args]);
  return {
    done,
    requests,
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

const list = (data: unknown[], hasMore = false) => ({
  body: { object: 'list', data, has_more: hasMore, url: '/v1/x' },
});

describe('cli', () => {
  it('lists payments with filters, auth and a human table', async () => {
    const cli = run(
      [
        '--api-url',
        'http://api.test',
        '--api-key',
        'sk_test_flag',
        'payments',
        'list',
        '--status',
        'succeeded',
        '--limit',
        '2',
      ],
      [
        list(
          [
            {
              id: 'pi_1',
              amount: 1990,
              currency: 'pen',
              status: 'succeeded',
              customer: null,
              created: 1_790_000_000,
            },
          ],
          true,
        ),
      ],
    );
    await cli.done;

    const request = cli.requests[0]!;
    expect(request.url.origin).toBe('http://api.test');
    expect(request.url.pathname).toBe('/v1/payment_intents');
    expect(request.url.searchParams.get('status')).toBe('succeeded');
    expect(request.url.searchParams.get('limit')).toBe('2');
    expect(request.headers.get('authorization')).toBe('Bearer sk_test_flag');
    expect(cli.stdout()).toContain('ID    AMOUNT     STATUS     CUSTOMER  CREATED');
    expect(cli.stdout()).toContain('pi_1  19.90 PEN  succeeded  -         2026-09-21T14:13:20Z');
    expect(cli.stdout()).toContain('more available');
  });

  it('prints raw JSON with --json and reads the key from the environment', async () => {
    const body = list([{ id: 'cus_1' }]);
    const cli = run(['--json', 'customers', 'list', '--email', 'a@b.c'], [body], {
      LOCALSTRIPE_API_KEY: 'sk_test_env',
      LOCALSTRIPE_API_URL: 'http://env.test',
    });
    await cli.done;
    expect(cli.requests[0]!.url.href).toBe('http://env.test/v1/customers?limit=10&email=a%40b.c');
    expect(cli.requests[0]!.headers.get('authorization')).toBe('Bearer sk_test_env');
    expect(JSON.parse(cli.stdout())).toEqual(body.body);
  });

  it('checks health without an API key', async () => {
    const cli = run(['health'], [{ body: { status: 'ok', service: 'localstripe-api' } }]);
    await cli.done;
    expect(cli.requests[0]!.url.href).toBe('http://localhost:9001/health');
    expect(cli.stdout()).toContain('ok  localstripe-api at http://localhost:9001');
  });

  it('fails clearly when no API key can be found', async () => {
    const cli = run(['customers', 'list']);
    await expect(cli.done).rejects.toThrow(/No API key found/);
    expect(cli.requests).toHaveLength(0);
  });

  it('rejects out-of-range limits and unknown trigger events', async () => {
    const limit = run(['--api-key', 'k', 'payments', 'list', '--limit', '0']);
    await expect(limit.done).rejects.toThrow(/between 1 and 100/);
    const trigger = run(['--api-key', 'k', 'trigger', 'invoice.paid']);
    await expect(trigger.done).rejects.toThrow(/must be one of/);
    expect(trigger.requests).toHaveLength(0);
  });

  it('triggers an event', async () => {
    const cli = run(
      ['--api-key', 'k', 'trigger', 'charge.refunded'],
      [
        {
          body: {
            object: 'trigger_result',
            event: 'charge.refunded',
            objects: ['pi_1'],
            events: ['evt_1'],
          },
        },
      ],
    );
    await cli.done;
    expect(cli.requests[0]!.method).toBe('POST');
    expect(cli.requests[0]!.url.pathname).toBe('/v1/localstripe/trigger');
    expect(cli.stdout()).toContain('Triggered charge.refunded');
  });

  it('re-sends an event or retries a single delivery', async () => {
    const resend = run(['--api-key', 'k', 'webhooks', 'retry', 'evt_1'], [list([])]);
    await resend.done;
    expect(resend.requests[0]!.url.pathname).toBe('/v1/localstripe/events/evt_1/resend');

    const retry = run(
      ['--api-key', 'k', 'webhooks', 'retry', '--delivery', 'wd_1'],
      [
        {
          body: { id: 'wd_1', event_type: 'charge.succeeded', url: 'http://x', status: 'pending' },
        },
      ],
    );
    await retry.done;
    expect(retry.requests[0]!.url.pathname).toBe('/v1/localstripe/webhook_deliveries/wd_1/retry');
  });

  it('formats API errors as type/code: message', async () => {
    const cli = run(
      ['--api-key', 'sk_bad', 'customers', 'list'],
      [
        {
          status: 401,
          body: {
            error: {
              type: 'authentication_error',
              code: 'api_key_invalid',
              message: 'Invalid API Key.',
            },
          },
        },
      ],
    );
    const error = await cli.done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(formatError(error)).toBe(
      'authentication_error/api_key_invalid: Invalid API Key. (request_id=req_cli)',
    );
    expect(formatError(new Error('boom'))).toBe('error: boom');
  });
});
