/**
 * Shared lexical helpers for the mechanical hygiene scripts.
 *
 * These scripts deliberately do not parse TypeScript. A real parser would pull
 * a compiler dependency into a pre-commit path for rules that are all shape
 * checks, and it would still not answer the judgment questions the agents keep.
 * Masking comments and string literals gets pattern matching close enough to be
 * trustworthy, provided every rule matches on masked source and reads any text
 * it needs back out of the raw source at the same index.
 *
 * Consumers: check-test-hygiene.ts, check-component-hygiene.ts
 */

/**
 * Blanks out line comments, block comments, and string/template literals so
 * pattern matching does not fire on prose. Positions are preserved so line
 * numbers stay accurate.
 */
export function maskNonCode(source: string): string {
  const out = source.split('');
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | 'string' = 'code';
  let quote = '';
  let quoteStart = -1;
  /** Quote positions already proven not to open a string, so re-scanning the
   * line from one does not loop on it forever. */
  const abandoned = new Set<number>();

  const blank = (idx: number): void => {
    if (out[idx] !== '\n') out[idx] = ' ';
  };

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        if (abandoned.has(i)) {
          i += 1;
          continue;
        }
        state = 'string';
        quote = ch;
        quoteStart = i;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') state = 'code';
      else blank(i);
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        blank(i);
        blank(i + 1);
        state = 'code';
        i += 2;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    // state === 'string'
    //
    // A `'` or `"` that reaches end of line without closing was never a string
    // — it is an apostrophe in JSX text, as in `this device's vault`. Treating
    // it as one masks every character up to the next apostrophe further down
    // the file, which silently deletes real code from the masked copy and
    // leaves brace and paren scanning unbalanced. That made the component
    // checker measure one 15-line JSX block as 451 lines.
    //
    // Backticks are exempt: a template literal spans lines legitimately.
    if (ch === '\n' && quote !== '`') {
      for (let j = quoteStart; j < i; j += 1) out[j] = source[j];
      abandoned.add(quoteStart);
      state = 'code';
      quote = '';
      i = quoteStart + 1;
      continue;
    }
    if (ch === '\\') {
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (ch === quote) {
      state = 'code';
      quote = '';
      i += 1;
      continue;
    }
    blank(i);
    i += 1;
  }

  return out.join('');
}

/** 1-indexed line number of a character offset. */
export function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/** Returns the source slice of a balanced-brace block starting at `from`. */
export function blockAfter(code: string, from: number): string {
  const open = code.indexOf('{', from);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return code.slice(open);
}

/** Returns the source slice of a balanced-paren group starting at `from`. */
export function parenAfter(code: string, from: number): string {
  const open = code.indexOf('(', from);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return code.slice(open);
}

/**
 * Index just past the group closing the `open` character at or after `from`,
 * or -1 when the group never closes.
 */
function endOfBalanced(
  code: string,
  from: number,
  open: string,
  close: string,
): number {
  const start = code.indexOf(open, from);
  if (start === -1) return -1;
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === open) depth += 1;
    else if (code[i] === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Returns the *body* block of a function whose declaration begins at `from`,
 * skipping the parameter list and any return-type annotation.
 *
 * `blockAfter` takes the first `{` it sees, which is the body only when nothing
 * earlier in the signature carries one. That assumption breaks on ordinary
 * TypeScript: `options: { sandbox?: boolean } = {}` and `): { ok: boolean } {`
 * both put a brace ahead of the body, and a caller scanning the result for
 * assertions would read the type instead of the code. Use `blockAfter` for call
 * expressions such as `it(` or `beforeAll(`, where the first brace really is
 * the callback body, and this for declarations.
 */
export function signatureBodyAfter(code: string, from: number): string {
  const paren = code.indexOf('(', from);
  const firstBrace = code.indexOf('{', from);

  // No parameter list ahead of the body: nothing to skip past.
  if (paren === -1 || (firstBrace !== -1 && firstBrace < paren)) {
    return blockAfter(code, from);
  }

  let cursor = endOfBalanced(code, paren, '(', ')');
  if (cursor === -1) return '';

  while (cursor < code.length) {
    const brace = code.indexOf('{', cursor);
    if (brace === -1) return '';

    // An arrow between here and the next brace means the body follows it, so
    // anything braced in between belonged to the return type.
    const arrow = code.indexOf('=>', cursor);
    if (arrow !== -1 && arrow < brace) return blockAfter(code, arrow);

    const end = endOfBalanced(code, brace, '{', '}');
    if (end === -1) return code.slice(brace);

    // A brace group still followed by a brace or an arrow was part of the
    // return type; the body is what comes after it.
    if (!/^\s*(?:\{|=>)/.test(code.slice(end))) return code.slice(brace, end);

    cursor = end;
  }

  return '';
}

/** Normalizes CRLF so offsets and line numbers agree across platforms. */
export function normalize(source: string): string {
  return source.replace(/\r\n/g, '\n');
}

/**
 * The lines of a file that a `file:line` citation can actually name.
 *
 * A trailing newline is not a line of its own. `.editorconfig` enforces one on
 * nearly every tracked file, so `split('\n').length` uncorrected over-reports
 * every such file's last line by one — and a citation to the line past the real
 * end then resolves as in range instead of failing. Three call sites had their
 * own copy of this correction: the page checker's line count, the page scanner's
 * anchor comparison, and the review pipeline's citation verifier.
 *
 * A file that is empty or holds a single line keeps its one element, so `''` is
 * one empty line rather than no lines at all.
 */
export function citableLines(content: string): string[] {
  const lines = normalize(content).split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** One lexical finding reported by a hygiene checker. */
export interface Finding {
  level: 'error' | 'warn';
  rule: string;
  line: number;
  message: string;
}

/** One inspected (or skipped) file's findings, as a checker builds it. */
export interface FindingResult {
  file: string;
  /** A reason the file was out of scope, or absent when it was inspected. */
  skipped?: string;
  findings: Finding[];
}

/** The error/warning/skip tally `reportFindings` prints and returns. */
export interface FindingTally {
  errors: number;
  warnings: number;
  skipped: number;
  inspected: number;
}

/** Renders findings as text; returns the error/warning tally. */
/**
 * The summary counts skipped files as well as findings, and says so whenever
 * any were skipped.
 *
 * Without it, a run where every file fell out of scope prints the same
 * "0 error(s), 0 warning(s)" as a run that inspected everything and found
 * nothing. That is how a whole library sat unchecked behind a checker that
 * looked green: the skip was reported per file, but the line people read was
 * the last one. A checker that inspected nothing should not be able to look
 * like a checker that passed.
 */
export function reportFindings(
  results: FindingResult[],
  label: string,
): FindingTally {
  let errors = 0;
  let warnings = 0;
  let skipped = 0;
  let inspected = 0;
  for (const result of results) {
    console.log(`\n${result.file}`);
    if (result.skipped) {
      skipped += 1;
      console.log(`  SKIPPED (${result.skipped})`);
    } else {
      inspected += 1;
    }
    // A skipped result can still carry findings: a factual-assertion rule runs
    // over a LEGACY page even though its written reason exempts it from every
    // mechanical-hygiene one (ADR 0085), so SKIPPED and a finding both print.
    if (!result.findings.length) {
      if (!result.skipped) console.log('  PASS — no mechanical issues');
      continue;
    }
    for (const f of result.findings) {
      if (f.level === 'error') errors += 1;
      else warnings += 1;
      const tag = f.level === 'error' ? 'ERROR' : 'WARN ';
      console.log(`  ${tag} ${f.rule} (line ${f.line})\n        ${f.message}`);
    }
  }
  const summary = `${label}: ${errors} error(s), ${warnings} warning(s)`;
  console.log(
    skipped
      ? `\n${summary} — ${inspected} file(s) inspected, ${skipped} skipped as out of scope`
      : `\n${summary}`,
  );
  return { errors, warnings, skipped, inspected };
}
