const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]!);

/** Tagged template that escapes every interpolated value unless it is wrapped with `raw()`. */
export class Raw {
  constructor(readonly html: string) {}
}
export const raw = (html: string): Raw => new Raw(html);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? '';
  values.forEach((value, index) => {
    const rendered = Array.isArray(value)
      ? value.map((item) => (item instanceof Raw ? item.html : escapeHtml(item))).join('')
      : value instanceof Raw
        ? value.html
        : escapeHtml(value);
    out += rendered + (strings[index + 1] ?? '');
  });
  return new Raw(out);
}

const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

export function formatAmount(amount: number, currency: string): string {
  const divisor = ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / divisor);
  } catch {
    return `${(amount / divisor).toFixed(divisor === 1 ? 0 : 2)} ${currency.toUpperCase()}`;
  }
}

/** Hosted pages allow inline styles only: no scripts, no external resources. */
export const HOSTED_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self' http: https:; frame-ancestors 'none'; base-uri 'none'";

const STYLES = `
:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--text:#1a1f36;--muted:#697386;--border:#e3e8ee;--accent:#5b5bd6;--danger:#c0123c;--warn-bg:#fff4e5;--warn:#8a5300}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--card:#181b24;--text:#e6e8ef;--muted:#9aa3b5;--border:#2a2f3b;--accent:#8b8bf5;--danger:#ff6b8b;--warn-bg:#2b2112;--warn:#f5c26b}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
.banner{background:var(--warn-bg);color:var(--warn);text-align:center;padding:8px 16px;font-size:13px;font-weight:600}
main{max-width:460px;margin:32px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 4px}.muted{color:var(--muted);font-size:13px}.total{font-size:28px;font-weight:700;margin:8px 0 16px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}td{padding:6px 0;border-bottom:1px solid var(--border)}td:last-child{text-align:right}
label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}input,select{width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:12px}.row>div{flex:1}button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:var(--danger);border:1px solid var(--danger)}.error{background:rgba(192,18,60,.1);color:var(--danger);padding:10px;border-radius:8px;margin:12px 0}
a{color:var(--accent)}.center{text-align:center}code{font-size:12px}`;

export function page(title: string, body: Raw): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · LocalStripe</title><style>${STYLES}</style></head><body><div class="banner">LocalStripe test mode — this is a simulation. No real payment will be made.</div><main>${body.html}</main></body></html>`;
}
