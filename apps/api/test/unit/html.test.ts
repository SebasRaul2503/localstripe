import { describe, expect, it } from 'vitest';
import {
  HOSTED_PAGE_CSP,
  escapeHtml,
  formatAmount,
  html,
  page,
  raw,
} from '../../src/modules/hosted/html.js';
import { parseExpiry } from '../../src/modules/hosted/hosted.routes.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('renders null and undefined as empty strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('html template', () => {
  it('escapes interpolated values', () => {
    const name = '<script>alert(1)</script>';
    expect(html`<p>${name}</p>`.html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('keeps raw() and nested templates unescaped', () => {
    const inner = html`<b>${'&'}</b>`;
    expect(html`<p>${inner}${raw('<i>ok</i>')}</p>`.html).toBe('<p><b>&amp;</b><i>ok</i></p>');
  });

  it('joins arrays, escaping plain items', () => {
    const items = ['<a>', html`<b>b</b>`];
    expect(html`<span>${items}</span>`.html).toBe('<span>&lt;a&gt;<b>b</b></span>');
  });

  it('page() escapes the title and shows the test-mode banner', () => {
    const rendered = page('<Checkout>', html`<p>body</p>`);
    expect(rendered).toContain('<title>&lt;Checkout&gt; · LocalStripe</title>');
    expect(rendered).toContain('No real payment will be made');
    expect(rendered).not.toContain('<script');
  });

  it('forbids scripts in the hosted page CSP', () => {
    expect(HOSTED_PAGE_CSP).toContain("default-src 'none'");
    expect(HOSTED_PAGE_CSP).not.toContain('script-src');
  });
});

describe('formatAmount', () => {
  it('formats minor units', () => {
    expect(formatAmount(1990, 'usd')).toBe('$19.90');
    expect(formatAmount(500, 'JPY')).toBe('¥500');
  });

  it('falls back for unknown currencies', () => {
    expect(formatAmount(1234, 'zzz')).toMatch(/12\.34/);
  });
});

describe('parseExpiry', () => {
  it.each([
    ['12/40', { exp_month: 12, exp_year: 40 }],
    ['1/2030', { exp_month: 1, exp_year: 2030 }],
    [' 06 / 29 ', { exp_month: 6, exp_year: 29 }],
  ])('%j → %j', (input, expected) => {
    expect(parseExpiry(input)).toEqual(expected);
  });

  it.each(['', '1240', '12/', '/40', '12/401', '123/40', 'ab/cd', '12-40'])(
    'rejects %j',
    (input) => {
      expect(parseExpiry(input)).toBeNull();
    },
  );
});
