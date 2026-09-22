import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CatalogError,
  type CatalogCard,
  type DelaySettings,
  TestCardCatalog,
  normalizeCardNumber,
  resolveDelayMs,
} from '../../src/modules/test-cards/catalog.js';
import { DEFAULT_TEST_CARDS } from '../../src/modules/test-cards/default-catalog.js';

function isLuhnValid(number: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const LOCAL_ONLY_NUMBERS = [1, 2, 3, 4, 5, 6, 7].map((n) => `424242424242000${n}`);

const customCard = {
  id: 'custom_success',
  number: '6011000990139424',
  brand: 'discover',
  label: 'Custom',
  scenario: 'succeeded',
};

describe('default catalog', () => {
  const catalog = new TestCardCatalog(DEFAULT_TEST_CARDS);

  it('loads every default card', () => {
    expect(catalog.list()).toHaveLength(DEFAULT_TEST_CARDS.length);
  });

  it('has unique ids, numbers and payment method tokens', () => {
    const cards = catalog.list();
    const tokens = cards.flatMap((card) => card.payment_method_token ?? []);
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    expect(new Set(cards.map((card) => card.number)).size).toBe(cards.length);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('covers every scenario', () => {
    const scenarios = new Set(catalog.list().map((card) => card.scenario));
    expect([...scenarios].sort()).toEqual([
      'declined',
      'processing',
      'requires_action',
      'succeeded',
    ]);
  });

  it('contains the LocalStripe-only 4242 4242 4242 000X series', () => {
    for (const number of LOCAL_ONLY_NUMBERS) expect(catalog.findByNumber(number)).toBeDefined();
  });

  it('keeps the LocalStripe-only numbers Luhn-invalid, so they can never be real cards', () => {
    for (const number of LOCAL_ONLY_NUMBERS) expect(isLuhnValid(number), number).toBe(false);
  });

  it('uses Luhn-valid numbers for the Stripe-familiar cards', () => {
    const familiar = catalog.list().filter((card) => !LOCAL_ONLY_NUMBERS.includes(card.number));
    for (const card of familiar) expect(isLuhnValid(card.number), card.id).toBe(true);
  });

  it('normalizes spaces and dashes on lookup', () => {
    expect(normalizeCardNumber(' 4242-4242 4242-4242 ')).toBe('4242424242424242');
    expect(catalog.findByNumber('4242 4242 4242 4242')?.id).toBe('visa_success');
    expect(catalog.findByNumber('4242-4242-4242-4242')?.id).toBe('visa_success');
    expect(catalog.findByNumber('4111111111111111')).toBeUndefined();
  });

  it('looks cards up by id and by payment method token', () => {
    expect(catalog.findById('generic_decline')?.number).toBe('4000000000000002');
    expect(catalog.findByToken('pm_card_visa')?.id).toBe('visa_success');
    expect(catalog.findByToken('pm_card_chargeDeclined')?.id).toBe('generic_decline');
    expect(catalog.findByToken('pm_card_unknown')).toBeUndefined();
  });

  it('renders cards as test_card resources', () => {
    const card = catalog.findById('local_processing_declined')!;
    expect(TestCardCatalog.toResource(card)).toEqual({
      object: 'test_card',
      id: 'local_processing_declined',
      number: '4242424242420007',
      brand: 'visa',
      funding: 'credit',
      label: card.label,
      scenario: 'processing',
      decline_code: 'generic_decline',
      error_code: 'card_declined',
      settles_to: 'declined',
      delay_ms: null,
      payment_method_token: null,
      description: card.description,
    });
  });
});

describe('invalid definitions', () => {
  it.each([
    ['a declined card without error_code', { ...customCard, scenario: 'declined' }],
    ['a processing card without settles_to', { ...customCard, scenario: 'processing' }],
    [
      'a processing card settling to declined without error_code',
      { ...customCard, scenario: 'processing', settles_to: 'declined' },
    ],
    ['a non-numeric number', { ...customCard, number: '4242abcd42424242' }],
    ['a too short number', { ...customCard, number: '42424242' }],
    ['an unknown brand', { ...customCard, brand: 'dinersclubx' }],
    ['an invalid id', { ...customCard, id: 'Has Spaces' }],
    ['an unknown scenario', { ...customCard, scenario: 'exploded' }],
    ['an unknown property', { ...customCard, cvc: '123' }],
    ['a negative delay', { ...customCard, delay_ms: -1 }],
    ['a malformed token', { ...customCard, payment_method_token: 'tok_visa' }],
  ])('rejects %s', (_label, definition) => {
    expect(() => new TestCardCatalog([definition])).toThrow(CatalogError);
  });

  it('rejects duplicate ids, numbers and tokens', () => {
    expect(
      () => new TestCardCatalog([customCard, { ...customCard, number: '6011111111111117' }]),
    ).toThrow(/Duplicate test card id/);
    expect(() => new TestCardCatalog([customCard, { ...customCard, id: 'other' }])).toThrow(
      /Duplicate test card number/,
    );
    expect(
      () =>
        new TestCardCatalog([
          { ...customCard, payment_method_token: 'pm_card_x' },
          {
            ...customCard,
            id: 'other',
            number: '6011111111111117',
            payment_method_token: 'pm_card_x',
          },
        ]),
    ).toThrow(/Duplicate payment_method_token/);
  });
});

describe('custom catalog files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localstripe-catalog-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const writeCatalog = (name: string, content: unknown): string => {
    const path = join(dir, name);
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  };

  it('extends the default catalog by default', () => {
    const catalog = TestCardCatalog.load(writeCatalog('extend.json', { cards: [customCard] }));
    expect(catalog.list()).toHaveLength(DEFAULT_TEST_CARDS.length + 1);
    expect(catalog.findByNumber('6011 0009 9013 9424')?.id).toBe('custom_success');
    expect(catalog.findById('visa_success')).toBeDefined();
  });

  it('replaces the default catalog with mode=replace', () => {
    const catalog = TestCardCatalog.load(
      writeCatalog('replace.json', { mode: 'replace', cards: [customCard] }),
    );
    expect(catalog.list().map((card) => card.id)).toEqual(['custom_success']);
    expect(catalog.findById('visa_success')).toBeUndefined();
  });

  it('uses the defaults when no path is configured', () => {
    expect(TestCardCatalog.load(undefined).list()).toHaveLength(DEFAULT_TEST_CARDS.length);
  });

  it.each([
    ['malformed JSON', '{ not json'],
    ['a wrong shape', { cards: 'nope' }],
    ['an unknown mode', { mode: 'merge', cards: [] }],
    ['an unknown top-level key', { cards: [], extra: true }],
    [
      'a card clashing with a default number',
      { cards: [{ ...customCard, number: '4242424242424242' }] },
    ],
    ['an invalid card', { cards: [{ ...customCard, scenario: 'declined' }] }],
  ])('rejects %s', (label, content) => {
    const path = writeCatalog(`${label.replaceAll(' ', '-')}.json`, content);
    expect(() => TestCardCatalog.fromFile(path)).toThrow(CatalogError);
  });

  it('reports a missing file', () => {
    expect(() => TestCardCatalog.fromFile(join(dir, 'missing.json'))).toThrow(/Cannot read/);
  });
});

describe('resolveDelayMs', () => {
  const settings: DelaySettings = {
    globalDelayMs: 100,
    scenarioDelays: { succeeded: 200 },
    maxDelayMs: 1000,
  };
  const card = (overrides: Partial<CatalogCard> = {}): CatalogCard => ({
    id: 'c',
    number: '4242424242424242',
    brand: 'visa',
    funding: 'credit',
    label: 'c',
    scenario: 'succeeded',
    description: '',
    ...overrides,
  });

  it('prefers the request override', () => {
    expect(resolveDelayMs(card({ delay_ms: 300 }), settings, 400)).toBe(400);
    expect(resolveDelayMs(card({ delay_ms: 300 }), settings, 0)).toBe(0);
  });

  it('falls back to the card delay', () => {
    expect(resolveDelayMs(card({ delay_ms: 300 }), settings)).toBe(300);
  });

  it('falls back to the scenario delay', () => {
    expect(resolveDelayMs(card(), settings)).toBe(200);
  });

  it('falls back to the global delay', () => {
    expect(resolveDelayMs(card({ scenario: 'declined' }), settings)).toBe(100);
  });

  it('caps every source at maxDelayMs and never goes negative', () => {
    expect(resolveDelayMs(card(), settings, 5000)).toBe(1000);
    expect(resolveDelayMs(card({ delay_ms: 5000 }), settings)).toBe(1000);
    expect(resolveDelayMs(card(), { ...settings, scenarioDelays: { succeeded: 9999 } })).toBe(1000);
    expect(resolveDelayMs(card(), settings, -50)).toBe(0);
  });
});
