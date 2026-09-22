import { z } from 'zod';
import { errorResponseSchema } from '@localstripe/contracts';
import type { Services } from '../app/services.js';

export interface RouteDeps {
  services: Services;
  strictParams: boolean;
}

/** With STRICT_PARAMS (default) unknown top-level params are rejected, like Stripe does. */
export function params<T extends z.ZodRawShape>(shape: T, strict: boolean) {
  return strict ? z.strictObject(shape) : z.object(shape);
}

export const errorResponses = {
  400: errorResponseSchema.describe('Invalid request'),
  401: errorResponseSchema.describe('Missing or invalid API key'),
  402: errorResponseSchema.describe('Card error (simulated decline)'),
  404: errorResponseSchema.describe('Resource not found'),
};

export const idParams = z.object({ id: z.string().min(1).max(255) });

/** Params that Stripe clients commonly send and that LocalStripe accepts but ignores. */
export const ignoredPaymentParams = {
  automatic_payment_methods: z.unknown().optional(),
  payment_method_options: z.unknown().optional(),
  setup_future_usage: z.unknown().optional(),
  off_session: z.unknown().optional(),
  use_stripe_sdk: z.unknown().optional(),
  statement_descriptor: z.unknown().optional(),
  statement_descriptor_suffix: z.unknown().optional(),
  mandate_data: z.unknown().optional(),
  shipping: z.unknown().optional(),
};
