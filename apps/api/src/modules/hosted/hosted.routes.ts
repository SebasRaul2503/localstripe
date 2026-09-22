import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply } from 'fastify';
import type { CheckoutSession, PaymentIntent } from '@localstripe/contracts';
import type { Services } from '../../app/services.js';
import { ApiError } from '../../shared/errors.js';
import { SYSTEM_ORIGIN } from '../../shared/context.js';
import { HOSTED_PAGE_CSP, formatAmount, html, page, type Raw } from './html.js';

const idParams = z.object({ id: z.string().min(1).max(255) });

function sendPage(reply: FastifyReply, title: string, body: Raw, status = 200) {
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', HOSTED_PAGE_CSP)
    .header('cache-control', 'no-store')
    .send(page(title, body));
}

const successRedirect = (session: CheckoutSession) =>
  session.success_url.replaceAll('{CHECKOUT_SESSION_ID}', session.id);

/** Parses `MM/YY`, `MM/YYYY` or `MM / YY`. */
export function parseExpiry(value: string): { exp_month: number; exp_year: number } | null {
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!match) return null;
  return { exp_month: Number(match[1]), exp_year: Number(match[2]) };
}

/**
 * Hosted pages: a minimal checkout page for Checkout Sessions and the simulated 3D Secure
 * challenge. They are reachable without an API key; the unguessable session id and the
 * PaymentIntent client secret act as capabilities, like Stripe's hosted pages.
 */
export function hostedRoutes(services: Services): FastifyPluginAsyncZod {
  const catalog = services.catalog;

  function checkoutForm(
    session: CheckoutSession,
    lineItems: Awaited<ReturnType<Services['checkoutSessions']['listLineItems']>>,
    error?: string,
  ) {
    const cards = catalog.list();
    return html` <div class="card">
      <p class="muted">Pay with LocalStripe (test)</p>
      <div class="total">${formatAmount(session.amount_total, session.currency)}</div>
      <table>
        ${lineItems.data.map(
          (item) =>
            html`<tr>
              <td>${item.description} × ${item.quantity}</td>
              <td>${formatAmount(item.amount_total, item.currency)}</td>
            </tr>`,
        )}
      </table>
      ${error ? html`<div class="error" role="alert">${error}</div>` : ''}
      <form method="post" action="/checkout/${session.id}/pay">
        <label for="test_card">Test card</label>
        <select id="test_card" name="test_card">
          ${cards.map((card) => html`<option value="${card.id}">${card.label} — ${card.number}</option>`)}
        </select>
        <label for="card_number">…or type a test card number</label>
        <input
          id="card_number"
          name="card_number"
          inputmode="numeric"
          autocomplete="off"
          placeholder="4242 4242 4242 4242"
        />
        <div class="row">
          <div>
            <label for="expiry">Expiry (MM/YY)</label
            ><input
              id="expiry"
              name="expiry"
              value="12/${String((new Date().getUTCFullYear() + 3) % 100).padStart(2, '0')}"
              required
            />
          </div>
          <div>
            <label for="cvc">CVC</label
            ><input id="cvc" name="cvc" value="123" inputmode="numeric" autocomplete="off" />
          </div>
        </div>
        <button type="submit">Pay ${formatAmount(session.amount_total, session.currency)}</button>
      </form>
      ${session.cancel_url ? html`<p class="center"><a href="${session.cancel_url}">Cancel and return</a></p>` : ''}
      <p class="muted center">Session <code>${session.id}</code></p>
    </div>`;
  }

  return async (app) => {
    app.get(
      '/checkout/:id',
      { schema: { hide: true, params: idParams } },
      async (request, reply) => {
        let session: CheckoutSession;
        try {
          session = await services.checkoutSessions.retrieve(request.params.id);
        } catch {
          return sendPage(
            reply,
            'Not found',
            html`<div class="card"><h1>Checkout session not found</h1></div>`,
            404,
          );
        }
        if (session.status === 'complete') return reply.redirect(successRedirect(session), 303);
        if (session.status === 'expired') {
          return sendPage(
            reply,
            'Expired',
            html`<div class="card">
              <h1>This checkout session has expired</h1>
              <p class="muted">${session.id}</p>
            </div>`,
            410,
          );
        }
        const lineItems = await services.checkoutSessions.listLineItems(session.id);
        return sendPage(
          reply,
          'Checkout',
          checkoutForm(session, lineItems, lastErrorOf(await paymentIntentOf(session))),
        );
      },
    );

    app.post(
      '/checkout/:id/pay',
      {
        schema: {
          hide: true,
          params: idParams,
          body: z.object({
            test_card: z.string().max(64).optional(),
            card_number: z.string().max(32).optional(),
            expiry: z.string().max(10).default(''),
            cvc: z.string().max(4).optional(),
          }),
        },
      },
      async (request, reply) => {
        const session = await services.checkoutSessions
          .retrieve(request.params.id)
          .catch(() => null);
        if (!session)
          return sendPage(
            reply,
            'Not found',
            html`<div class="card"><h1>Checkout session not found</h1></div>`,
            404,
          );
        // A double-submitted form must not show the payment form again once the session is paid.
        if (session.status === 'complete') return reply.redirect(successRedirect(session), 303);
        const lineItems = await services.checkoutSessions.listLineItems(session.id);

        const number =
          request.body.card_number?.trim() ||
          catalog.findById(request.body.test_card ?? '')?.number;
        const expiry = parseExpiry(request.body.expiry);
        if (!number || !expiry) {
          return sendPage(
            reply,
            'Checkout',
            checkoutForm(
              session,
              lineItems,
              'Enter a test card number and an expiry date (MM/YY).',
            ),
            400,
          );
        }
        try {
          const result = await services.checkoutSessions.complete(
            session.id,
            { card: { number, ...expiry, cvc: request.body.cvc || undefined } },
            { ...SYSTEM_ORIGIN, requestId: request.id },
          );
          const nextAction = result.paymentIntent.next_action?.redirect_to_url.url;
          if (nextAction) return reply.redirect(nextAction, 303);
          return reply.redirect(successRedirect(result.session), 303);
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          const refreshed = await services.checkoutSessions.retrieve(session.id);
          return sendPage(
            reply,
            'Checkout',
            checkoutForm(refreshed, lineItems, error.message),
            error.statusCode,
          );
        }
      },
    );

    app.get(
      '/3ds/:id',
      {
        schema: {
          hide: true,
          params: idParams,
          querystring: z.object({ client_secret: z.string().max(255).default('') }),
        },
      },
      async (request, reply) => {
        const paymentIntent = await services.paymentIntents
          .retrieve(request.params.id, request.query.client_secret)
          .catch(() => null);
        if (!paymentIntent) {
          return sendPage(
            reply,
            'Not found',
            html`<div class="card"><h1>Authentication request not found</h1></div>`,
            404,
          );
        }
        if (paymentIntent.status !== 'requires_action') {
          return sendPage(
            reply,
            '3D Secure',
            html`<div class="card">
              <h1>Nothing to authenticate</h1>
              <p>This payment is <strong>${paymentIntent.status}</strong>.</p>
              ${returnLink(paymentIntent)}
            </div>`,
          );
        }
        return sendPage(
          reply,
          '3D Secure',
          html`<div class="card">
            <p class="muted">Simulated 3D Secure challenge</p>
            <h1>Authenticate ${formatAmount(paymentIntent.amount, paymentIntent.currency)}</h1>
            <p class="muted">Choose the outcome of this simulated bank challenge.</p>
            <form method="post" action="/3ds/${paymentIntent.id}">
              <input type="hidden" name="client_secret" value="${request.query.client_secret}" />
              <button type="submit" name="outcome" value="succeed">Complete authentication</button>
              <button type="submit" name="outcome" value="fail" class="secondary">
                Fail authentication
              </button>
            </form>
            <p class="muted center"><code>${paymentIntent.id}</code></p>
          </div>`,
        );
      },
    );

    app.post(
      '/3ds/:id',
      {
        schema: {
          hide: true,
          params: idParams,
          body: z.object({
            client_secret: z.string().max(255),
            outcome: z.enum(['succeed', 'fail']),
          }),
        },
      },
      async (request, reply) => {
        let paymentIntent: PaymentIntent;
        let returnUrl: string | null = null;
        try {
          const before = await services.paymentIntents.retrieve(
            request.params.id,
            request.body.client_secret,
          );
          returnUrl = before.next_action?.redirect_to_url.return_url ?? null;
          paymentIntent = await services.paymentIntents.authenticate(
            request.params.id,
            request.body.outcome,
            { ...SYSTEM_ORIGIN, requestId: request.id },
            request.body.client_secret,
          );
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          return sendPage(
            reply,
            '3D Secure',
            html`<div class="card">
              <h1>Authentication failed</h1>
              <p class="error">${error.message}</p>
            </div>`,
            error.statusCode,
          );
        }
        if (returnUrl) return reply.redirect(withPaymentParams(returnUrl, paymentIntent), 303);
        return sendPage(
          reply,
          '3D Secure',
          html`<div class="card">
            <h1>Authentication ${request.body.outcome === 'succeed' ? 'completed' : 'failed'}</h1>
            <p>
              The payment is now <strong>${paymentIntent.status}</strong>. You can close this page.
            </p>
          </div>`,
        );
      },
    );
  };

  async function paymentIntentOf(session: CheckoutSession): Promise<PaymentIntent | null> {
    return session.payment_intent ? services.paymentIntents.retrieve(session.payment_intent) : null;
  }
}

function lastErrorOf(paymentIntent: PaymentIntent | null): string | undefined {
  return paymentIntent?.last_payment_error?.message;
}

/** Like Stripe, the return URL receives the PaymentIntent id and client secret as query params. */
function withPaymentParams(returnUrl: string, paymentIntent: PaymentIntent): string {
  const url = new URL(returnUrl);
  url.searchParams.set('payment_intent', paymentIntent.id);
  url.searchParams.set('payment_intent_client_secret', paymentIntent.client_secret);
  url.searchParams.set(
    'redirect_status',
    paymentIntent.status === 'succeeded' ? 'succeeded' : 'failed',
  );
  return url.toString();
}

function returnLink(paymentIntent: PaymentIntent): Raw | string {
  const returnUrl = paymentIntent.next_action?.redirect_to_url.return_url;
  return returnUrl
    ? html`<p>
        <a href="${withPaymentParams(returnUrl, paymentIntent)}">Return to the merchant</a>
      </p>`
    : '';
}
