/**
 * Encodes params with Stripe's bracket notation (`created[gte]=1`, `types[0]=a`), which the API
 * parses with `qs`. `undefined` and `null` values are omitted.
 */
export function encodeQuery(params: object | undefined): string {
  if (!params) return '';
  const pairs: string[] = [];
  const visit = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(`${key}[${index}]`, item));
    } else if (value instanceof Date) {
      visit(key, Math.floor(value.getTime() / 1000));
    } else if (typeof value === 'object') {
      for (const [child, childValue] of Object.entries(value))
        visit(`${key}[${child}]`, childValue);
    } else {
      pairs.push(`${encodeKey(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params)) visit(key, value);
  return pairs.join('&');
}

const encodeKey = (key: string) =>
  encodeURIComponent(key).replaceAll('%5B', '[').replaceAll('%5D', ']');
