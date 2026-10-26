/**
 * The Escape Copy reader's page — the only part of the reader that is not
 * shared with the app.
 *
 * Everything that decides anything lives in `@myorganiser/vault-core`:
 * `openEscapeCopy` parses the envelope, unwraps the Master Key and decrypts
 * every Vault Blob Type, using the same schema and the same crypto the
 * exporter ran. This file reads a file the User picked, reads a secret the
 * User typed, and renders what comes back. Keeping the split exactly there is
 * what ADR 0064's gate can assert: a reader with its own copy of the crypto
 * would be a second implementation of the thing that must never disagree with
 * the first.
 *
 * Three properties are load-bearing and are asserted by
 * `tools/scripts/check-escape-copy-reader.ts`:
 *
 *   1. **Nothing is sent.** No `fetch`, no `XMLHttpRequest`, no `WebSocket`,
 *      no dynamic `import()`, and no external `src`/`href` in the page. The
 *      file opens from `file://` with the network cable out, which is the
 *      only situation it was built for.
 *   2. **Nothing is stored.** No `localStorage`, no `sessionStorage`, no
 *      cookies. A passphrase typed into this page exists for as long as the
 *      tab does.
 *   3. **Nothing is written to disk.** v1 browses on screen. Offering a
 *      "download decrypted archive" button would turn one deliberate act of
 *      recovery into a plaintext file the User then has to remember to
 *      delete.
 *
 * `bootstrap` is exported and called only when a `document` is present, so the
 * gate can load this bundle outside a browser and call `openEscapeCopy`
 * against the real artifact.
 */
import {
  isEscapeCopySecretMismatchError,
  isVaultImportError,
  openEscapeCopy,
  type EscapeCopySecret,
  type OpenedEscapeCopy,
  type OpenedEscapeCopySection,
  type VaultImportError,
  type VaultImportErrorCode,
} from '@myorganiser/vault-core';

/** The human name each Vault Blob Type is shown under. */
const SECTION_LABELS: Record<OpenedEscapeCopySection['type'], string> = {
  addresses: 'Addresses',
  groceries: 'Groceries',
  mobileNumbers: 'Mobile numbers',
  subscriptions: 'Subscriptions',
  tasks: 'Tasks',
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Reader page is missing #${id}`);
  return found as T;
}

/**
 * What each import failure is told to the User as.
 *
 * A pinned table rather than a `switch` with a `default`, for the reason
 * [ADR 0053](../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)
 * gives: the `satisfies` clause fails to compile when a tenth
 * `VaultImportErrorCode` appears, where a `default` would silently absorb it
 * and show whatever the internal message happened to say. This page is read by
 * somebody whose vault will not open and who has nobody to ask, so the words
 * are the whole product at that moment.
 *
 * The wrong-secret case is not in here at all — it is a different error class,
 * handled first. That separation is deliberate: "check your passphrase" is the
 * opposite of helpful when the passphrase was right, and "this copy is
 * damaged" is the opposite of helpful when it is not.
 */
const IMPORT_FAILURE_MESSAGES = {
  'corrupt-file': () =>
    'That file is not a MyOrganiser Escape Copy, or it has been damaged.',
  'empty-envelope': () => 'That Escape Copy carries no data.',
  oversize: () => 'That file is too large to be an Escape Copy.',
  'unknown-blob-type': () =>
    'That Escape Copy contains a section this reader does not know about. Get a newer reader.',
  // Both already carry a message naming the two versions, which is the only
  // thing a User can act on here.
  'schema-version-downgrade': (error: VaultImportError) => error.message,
  'schema-version-unsupported': (error: VaultImportError) => error.message,
  'decrypt-failed': (error: VaultImportError) =>
    `${error.message} The secret was accepted, so the copy itself is damaged.`,
  // Neither belongs to opening a copy — one is the app's replay tracker, the
  // other its import upload, and this reader has neither. They are here
  // because the table is over the whole union, and a User who somehow sees one
  // is better served by a sentence than by an internal string.
  'replay-detected': () =>
    'This reader does not track repeats, so it should not be showing you this. Try a reader from a newer release.',
  'network-failed': () =>
    'This reader uses no network, so it should not be showing you this. Try a reader from a newer release.',
} as const satisfies Record<
  VaultImportErrorCode,
  (error: VaultImportError) => string
>;

/**
 * What to tell the User about a failure.
 */
export function describeFailure(error: unknown): string {
  if (isEscapeCopySecretMismatchError(error)) return error.message;

  if (isVaultImportError(error)) {
    const describe = IMPORT_FAILURE_MESSAGES[error.code];
    // The table is total over the union, but `code` arrives from a file the
    // User picked: a hand-edited envelope can carry anything.
    return describe ? describe(error) : error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function renderSection(section: OpenedEscapeCopySection): HTMLElement {
  const wrapper = document.createElement('details');
  wrapper.className = 'section';
  wrapper.dataset['blobType'] = section.type;

  const summary = document.createElement('summary');
  const count = Array.isArray(
    (section.plaintext as { records?: unknown })?.records,
  )
    ? (section.plaintext as { records: unknown[] }).records.length
    : null;

  summary.textContent = section.present
    ? `${SECTION_LABELS[section.type]}${count === null ? '' : ` — ${count} record${count === 1 ? '' : 's'}`}`
    : `${SECTION_LABELS[section.type]} — not in this copy`;
  if (!section.present) summary.className = 'absent';
  wrapper.append(summary);

  const body = document.createElement('pre');
  body.textContent = section.present
    ? JSON.stringify(section.plaintext, null, 2)
    : 'This Escape Copy does not carry this section. Your vault had nothing in it when the copy was made.';
  wrapper.append(body);

  return wrapper;
}

function render(opened: OpenedEscapeCopy, into: HTMLElement): void {
  into.replaceChildren();

  const summary = document.createElement('p');
  summary.className = 'copy-meta';
  summary.textContent =
    `Opened. Made ${opened.exportedAt} · export ${opened.exportId} · ` +
    `schema version ${opened.schemaVersion}.`;
  into.append(summary);

  for (const section of opened.sections) into.append(renderSection(section));
}

/** The secret the form currently describes, or `null` if none was typed. */
export function secretFromForm(options: {
  kind: string;
  value: string;
}): EscapeCopySecret | null {
  const value = options.value;
  if (!value) return null;
  return options.kind === 'recovery-key'
    ? { kind: 'recovery-key', value }
    : { kind: 'passphrase', value };
}

export function bootstrap(): void {
  const fileInput = element<HTMLInputElement>('envelope-file');
  const secretInput = element<HTMLInputElement>('secret');
  const form = element<HTMLFormElement>('open-form');
  const status = element<HTMLParagraphElement>('status');
  const output = element<HTMLDivElement>('output');
  const fileName = element<HTMLSpanElement>('file-name');

  let envelopeText: string | null = null;

  fileInput.addEventListener('change', () => {
    output.replaceChildren();
    const file = fileInput.files?.[0] ?? null;
    if (!file) {
      envelopeText = null;
      fileName.textContent = 'No file chosen.';
      return;
    }
    fileName.textContent = file.name;
    status.textContent = 'Reading file…';
    // `FileReader`, not `fetch`: reading a file the User picked never leaves
    // the page, and the reader has no network capability at all.
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      envelopeText = String(reader.result ?? '');
      status.textContent =
        'File loaded. Enter your passphrase or Recovery Key.';
    });
    reader.addEventListener('error', () => {
      envelopeText = null;
      status.textContent = 'That file could not be read.';
    });
    reader.readAsText(file);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    output.replaceChildren();

    if (!envelopeText) {
      status.textContent = 'Choose your Escape Copy file first.';
      return;
    }

    const kind =
      form.querySelector<HTMLInputElement>('input[name="secret-kind"]:checked')
        ?.value ?? 'passphrase';
    const secret = secretFromForm({ kind, value: secretInput.value });
    if (!secret) {
      status.textContent =
        kind === 'recovery-key'
          ? 'Enter your Recovery Key.'
          : 'Enter your passphrase.';
      return;
    }

    status.textContent =
      'Opening… this takes a moment: the key derivation is deliberately slow.';

    void openEscapeCopy({ text: envelopeText, secret })
      .then((opened) => {
        status.textContent = '';
        render(opened, output);
      })
      .catch((error: unknown) => {
        status.textContent = describeFailure(error);
      })
      .finally(() => {
        // The secret is cleared whether or not it worked. It is not needed
        // again, and the page has no reason to keep holding it in a field.
        secretInput.value = '';
      });
  });
}

/**
 * Wire the page up if this really is the reader page.
 *
 * Guarded on the form being present, not merely on a `document` existing.
 * Two callers load this module without the shell around it — the gate, which
 * evaluates the built bundle in a bare Node context, and the page suite, which
 * mounts the shell itself and calls `bootstrap` when it is ready. Binding on
 * import would make the first impossible and the second order-dependent.
 */
if (typeof document !== 'undefined') {
  const startIfReaderPage = () => {
    if (document.getElementById('open-form')) bootstrap();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startIfReaderPage);
  } else {
    startIfReaderPage();
  }
}

/**
 * The reader's own API, exposed for the gate.
 *
 * `tools/scripts/check-escape-copy-reader.ts` loads the built HTML, evaluates
 * the script it carries outside a browser, and opens a freshly produced
 * envelope through this handle. That is ADR 0064's second decision, and it is
 * only an assertion about the artifact if it runs the artifact.
 */
(globalThis as Record<string, unknown>)['MyOrganiserEscapeCopyReader'] = {
  openEscapeCopy,
  describeFailure,
  bootstrap,
};
