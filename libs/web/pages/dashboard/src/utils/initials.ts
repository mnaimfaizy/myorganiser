/**
 * The first letter of up to two words in a name, upper-cased, for an avatar.
 * An empty or blank name gives an empty string.
 */
export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
