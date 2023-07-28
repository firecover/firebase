export function timeAfter(days: number, startDate = new Date()): Date {
  const msToAdd = days * 24 * 60 * 60 * 1000;
  return new Date(startDate.getTime() + msToAdd);
}
