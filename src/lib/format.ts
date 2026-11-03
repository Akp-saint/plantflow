export function money(value: unknown, currency = 'XOF') {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount.toLocaleString('fr-FR')} ${currency}`; }
}

export function quantity(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(amount) : '—';
}

export function shortDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
}

export function dateForInput(value = new Date()) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 10);
}

export function initials(name?: string | null) {
  return (name ?? 'PF').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'PF';
}
