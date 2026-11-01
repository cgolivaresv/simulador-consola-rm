/**
 * Age in whole years on a given day. The birth date is read as a calendar date, not as UTC midnight:
 * `new Date('1978-03-12')` is 11 March in the evening in Chile, which would add a year a day early.
 */
export function age(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number);
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}
