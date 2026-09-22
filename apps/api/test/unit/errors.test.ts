import { describe, expect, it } from 'vitest';
import { toStripeParam, validationIssueToError } from '../../src/http/errors.js';
import { extractApiKey } from '../../src/http/auth.js';
import { ApiError, cardError, notFound } from '../../src/shared/errors.js';

describe('toStripeParam', () => {
  it.each([
    ['/amount', 'amount'],
    ['/card/number', 'card[number]'],
    ['/line_items/0/price_data/currency', 'line_items[0][price_data][currency]'],
    ['', ''],
    ['/', ''],
  ])('%j → %j', (path, expected) => {
    expect(toStripeParam(path)).toBe(expected);
  });

  it('accepts path arrays', () => {
    expect(toStripeParam(['line_items', 0, 'quantity'])).toBe('line_items[0][quantity]');
  });
});

describe('validationIssueToError', () => {
  it('maps unknown top-level keys to parameter_unknown', () => {
    const error = validationIssueToError({
      keyword: 'unrecognized_keys',
      instancePath: '/',
      message: 'Unrecognized key',
      params: { keys: ['foo'] },
    });
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Received unknown parameter: foo');
    expect(error.options).toMatchObject({ code: 'parameter_unknown', param: 'foo' });
  });

  it('maps unknown nested keys to a bracketed param', () => {
    const error = validationIssueToError({
      keyword: 'unrecognized_keys',
      instancePath: '/line_items/0',
      message: 'Unrecognized key',
      params: { keys: ['bogus'] },
    });
    expect(error.options.param).toBe('line_items[0][bogus]');
  });

  it('maps missing values to parameter_missing', () => {
    const error = validationIssueToError({
      keyword: 'invalid_type',
      instancePath: '/currency',
      message: 'Invalid input: expected string, received undefined',
      params: {},
    });
    expect(error.options).toMatchObject({ code: 'parameter_missing', param: 'currency' });
    expect(error.message).toBe('Missing required param: currency.');
  });

  it('maps absent union-typed values (integers, booleans) to parameter_missing', () => {
    const error = validationIssueToError({
      keyword: 'invalid_union',
      instancePath: '/amount',
      message: 'Invalid input',
      params: {
        errors: [
          [
            {
              code: 'invalid_type',
              path: [],
              message: 'Invalid input: expected number, received undefined',
            },
          ],
          [{ code: 'invalid_value', path: [], message: 'Invalid option' }],
        ],
      },
    });
    expect(error.options).toMatchObject({ code: 'parameter_missing', param: 'amount' });
  });

  it('keeps present but invalid union-typed values as parameter_invalid', () => {
    const error = validationIssueToError({
      keyword: 'invalid_union',
      instancePath: '/amount',
      message: 'Invalid input',
      params: {
        errors: [
          [
            {
              code: 'invalid_type',
              path: [],
              message: 'Invalid input: expected number, received object',
            },
          ],
        ],
      },
    });
    expect(error.options.code).toBe('parameter_invalid');
  });

  it('maps other issues to parameter_invalid', () => {
    const error = validationIssueToError({
      keyword: 'too_small',
      instancePath: '/amount',
      message: 'Too small',
      params: {},
    });
    expect(error.options).toMatchObject({ code: 'parameter_invalid', param: 'amount' });
    expect(error.message).toBe('Invalid amount: Too small');
  });
});

describe('ApiError', () => {
  it('renders a Stripe error envelope with only the present fields', () => {
    expect(notFound('customer', 'cus_x').toBody()).toEqual({
      error: {
        type: 'invalid_request_error',
        message: "No such customer: 'cus_x'",
        code: 'resource_missing',
        param: 'id',
      },
    });
    expect(new ApiError(500, 'api_error', 'boom').toBody()).toEqual({
      error: { type: 'api_error', message: 'boom' },
    });
  });

  it('includes decline_code for card errors', () => {
    expect(
      cardError('Declined', { code: 'card_declined', declineCode: 'fraudulent' }).toBody(),
    ).toEqual({
      error: {
        type: 'card_error',
        message: 'Declined',
        code: 'card_declined',
        decline_code: 'fraudulent',
      },
    });
  });
});

describe('extractApiKey', () => {
  const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`;

  it.each([
    [undefined, null],
    ['', null],
    ['Bearer sk_test_abc', 'sk_test_abc'],
    ['bearer sk_test_abc', 'sk_test_abc'],
    [basic('sk_test_abc:'), 'sk_test_abc'],
    [basic('sk_test_abc'), 'sk_test_abc'],
    [basic(':password'), null],
    ['Token sk_test_abc', null],
    ['Bearer', null],
  ])('%j → %j', (header, expected) => {
    expect(extractApiKey(header)).toBe(expected);
  });
});
