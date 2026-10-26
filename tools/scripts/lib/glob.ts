/**
 * The one glob→RegExp compiler for the tooling in tools/scripts.
 *
 * It existed twice: once for the Review Tier classifier and once, written
 * again, for the obligation selector. The copies disagreed. `libs/**\/x.ts`
 * matched `libs/ax.ts` in the second, because it consumed the separator
 * after `**` without putting one back, and `?` was a literal there and a
 * wildcard here. A glob moved between the two catalogues therefore changed
 * meaning, and a fix to one copy left the other wrong — so both now import
 * this.
 *
 * The syntax: `**` spans directories, `*` and `?` stay inside one segment,
 * everything else is literal. Patterns match the whole path.
 *
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        // `**/` is optional so `a/**\/b` matches `a/b` as well as `a/x/b`;
        // a trailing `**` spans the rest of the path.
        if (glob[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}
