export function truncateHash(hash: string, lead = 8, trail = 6): string {
  if (!hash) return '';
  if (hash.length <= lead + trail + 3) return hash;
  return `${hash.slice(0, lead)}...${hash.slice(-trail)}`;
}

export function formatTimeAgo(dateString?: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// Daml Decimal has 10 fractional digits; scale before using integer arithmetic.
export function sumTokenAmounts(amounts: string[]): string {
  const scale = BigInt('10000000000');
  let total = BigInt(0);
  for (const amount of amounts) {
    if (!/^\d+(\.\d{1,10})?$/.test(amount)) return 'Unavailable';
    const [whole, fraction = ''] = amount.split('.');
    total += BigInt(whole) * scale + BigInt(fraction.padEnd(10, '0'));
  }
  const fraction = (total % scale).toString().padStart(10, '0').replace(/0+$/, '');
  return (total / scale).toString() + (fraction ? '.' + fraction : '');
}
