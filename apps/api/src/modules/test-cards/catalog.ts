import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  CARD_BRANDS,
  CARD_FUNDING,
  CARD_SCENARIOS,
  type CardScenario,
  type TestCard,
} from '@localstripe/contracts';
import { DEFAULT_TEST_CARDS } from './default-catalog.js';

const definitionSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9_]{1,64}$/),
    number: z.string().regex(/^\d{12,19}$/),
    brand: z.enum(CARD_BRANDS),
    funding: z.enum(CARD_FUNDING).default('credit'),
    label: z.string().min(1),
    scenario: z.enum(CARD_SCENARIOS),
    error_code: z.string().optional(),
    decline_code: z.string().optional(),
    settles_to: z.enum(['succeeded', 'declined']).optional(),
    delay_ms: z.number().int().min(0).optional(),
    payment_method_token: z
      .string()
      .regex(/^pm_card_[A-Za-z0-9_]+$/)
      .optional(),
    description: z.string().default(''),
  })
  .superRefine((card, ctx) => {
    const needsError =
      card.scenario === 'declined' ||
      (card.scenario === 'processing' && card.settles_to === 'declined');
    if (needsError && !card.error_code) {
      ctx.addIssue({ code: 'custom', message: `${card.id}: declining cards need an error_code` });
    }
    if (card.scenario === 'processing' && !card.settles_to) {
      ctx.addIssue({ code: 'custom', message: `${card.id}: processing cards need settles_to` });
    }
  });

export type TestCardDefinition = z.input<typeof definitionSchema>;
export type CatalogCard = z.output<typeof definitionSchema>;

const catalogFileSchema = z.strictObject({
  mode: z.enum(['extend', 'replace']).default('extend'),
  cards: z.array(z.unknown()),
});

export class CatalogError extends Error {}

export const normalizeCardNumber = (raw: string): string => raw.replace(/[\s-]/g, '');

export class TestCardCatalog {
  private readonly byNumber = new Map<string, CatalogCard>();
  private readonly byId = new Map<string, CatalogCard>();
  private readonly byToken = new Map<string, CatalogCard>();

  constructor(definitions: readonly unknown[]) {
    for (const raw of definitions) {
      const parsed = definitionSchema.safeParse(raw);
      if (!parsed.success) {
        throw new CatalogError(`Invalid test card definition: ${parsed.error.issues[0]?.message}`);
      }
      this.add(parsed.data);
    }
  }

  private add(card: CatalogCard) {
    if (this.byId.has(card.id)) throw new CatalogError(`Duplicate test card id: ${card.id}`);
    if (this.byNumber.has(card.number)) {
      throw new CatalogError(`Duplicate test card number for ${card.id}`);
    }
    if (card.payment_method_token && this.byToken.has(card.payment_method_token)) {
      throw new CatalogError(`Duplicate payment_method_token: ${card.payment_method_token}`);
    }
    this.byId.set(card.id, card);
    this.byNumber.set(card.number, card);
    if (card.payment_method_token) this.byToken.set(card.payment_method_token, card);
  }

  static fromFile(path: string): TestCardCatalog {
    let content: unknown;
    try {
      content = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new CatalogError(
        `Cannot read test card catalog at ${path}: ${(error as Error).message}`,
      );
    }
    const file = catalogFileSchema.safeParse(content);
    if (!file.success) {
      throw new CatalogError(`Invalid test card catalog file: ${file.error.issues[0]?.message}`);
    }
    const base = file.data.mode === 'replace' ? [] : DEFAULT_TEST_CARDS;
    return new TestCardCatalog([...base, ...file.data.cards]);
  }

  static load(path: string | undefined): TestCardCatalog {
    return path ? TestCardCatalog.fromFile(path) : new TestCardCatalog(DEFAULT_TEST_CARDS);
  }

  findByNumber(raw: string): CatalogCard | undefined {
    return this.byNumber.get(normalizeCardNumber(raw));
  }

  findById(id: string): CatalogCard | undefined {
    return this.byId.get(id);
  }

  findByToken(token: string): CatalogCard | undefined {
    return this.byToken.get(token);
  }

  list(): CatalogCard[] {
    return [...this.byId.values()];
  }

  static toResource(card: CatalogCard): TestCard {
    return {
      object: 'test_card',
      id: card.id,
      number: card.number,
      brand: card.brand,
      funding: card.funding,
      label: card.label,
      scenario: card.scenario,
      decline_code: card.decline_code ?? null,
      error_code: card.error_code ?? null,
      settles_to: card.settles_to ?? null,
      delay_ms: card.delay_ms ?? null,
      payment_method_token: card.payment_method_token ?? null,
      description: card.description,
    };
  }
}

export interface DelaySettings {
  globalDelayMs: number;
  scenarioDelays: Partial<Record<CardScenario, number>>;
  maxDelayMs: number;
}

/**
 * How long a payment with this card takes to reach its outcome. For synchronous scenarios this
 * is added to the confirm response time; for `processing` it is the time until the payment settles.
 * Precedence: per-request override > card definition > scenario setting > global setting.
 */
export function resolveDelayMs(
  card: CatalogCard,
  settings: DelaySettings,
  requestOverrideMs?: number,
): number {
  const delay =
    requestOverrideMs ??
    card.delay_ms ??
    settings.scenarioDelays[card.scenario] ??
    settings.globalDelayMs;
  return Math.min(Math.max(delay, 0), settings.maxDelayMs);
}
