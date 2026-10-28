/**
 * `archiver` ships no types and has no `@types/archiver` package. Only the
 * shape `package-web.ts` calls is declared here: the default-exported
 * factory, and the `pipe`/`glob`/`finalize`/`on` methods of the archive it
 * returns.
 */
declare module 'archiver' {
  import type { Writable } from 'node:stream';

  interface ArchiverGlobOptions {
    cwd?: string;
    dot?: boolean;
    ignore?: string[];
  }

  interface ArchiverOptions {
    zlib?: { level?: number };
  }

  interface Archiver {
    pipe(destination: Writable): void;
    glob(pattern: string, options?: ArchiverGlobOptions): void;
    finalize(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): Archiver;
  }

  function archiver(format: string, options?: ArchiverOptions): Archiver;

  export default archiver;
}
