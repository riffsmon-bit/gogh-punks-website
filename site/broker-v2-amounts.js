const UNIT = 10n ** 18n;
export function displayEth(wei) {
  if (typeof wei !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(wei) || BigInt(wei) >= 2n ** 256n) return '—';
  const value = BigInt(wei), fraction = (value % UNIT).toString().padStart(18, '0').replace(/0+$/, '').padEnd(4, '0');
  return `${value / UNIT}.${fraction}`;
}
export function displayEthBudget(balance, reserve) {
  const parse = value => {
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,59})(\.\d{1,18})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, '0'));
  };
  const total = parse(balance), protectedWei = parse(reserve);
  if (total === null || protectedWei === null) return '—';
  return displayEth((total > protectedWei ? total - protectedWei : 0n).toString());
}
