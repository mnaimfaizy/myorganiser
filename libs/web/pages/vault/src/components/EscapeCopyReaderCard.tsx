'use client';

import { Button, Card, Illustration } from '@myorganiser/web-ui';

import {
  ESCAPE_COPY_READER_CHECKSUM_FILENAME,
  ESCAPE_COPY_READER_FILENAME,
  ESCAPE_COPY_READER_RELEASES_URL,
} from '../constants';

interface EscapeCopyReaderCardProps {
  /**
   * Whether an Escape Copy has been made while this page has been open —
   * a local Export, a Drive backup the User asked for, or a scheduled Drive
   * backup that ran unattended. All three raise the same callout, because
   * ADR 0064 asks for the prompt on *every* copy and the unattended one is
   * the copy the User is least likely to know about.
   *
   * That is why the wording says a copy was made rather than that the User
   * made one: the scheduler makes copies with nobody present, and telling
   * somebody they just did something they did not is how a prompt starts
   * getting ignored.
   *
   * Sticky for the life of the page, deliberately. The User this is for is
   * the one who leaves to go and find the downloaded file; taking the
   * reminder away while they are gone serves nobody.
   */
  justMadeACopy?: boolean;
}

export function EscapeCopyReaderCard({
  justMadeACopy,
}: EscapeCopyReaderCardProps) {
  return (
    <Card>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex items-center gap-4">
          <Illustration kind="vault" size={48} />
          <div className="flex flex-col gap-0.5">
            <h3 className="font-display text-title">
              Open your Escape Copy without us
            </h3>
            <p className="text-body text-foreground-supporting">
              A self-contained reader that works offline and needs no account
            </p>
          </div>
        </div>

        {justMadeACopy && (
          <div
            className="rounded-control border border-warning-edge bg-warning-faint p-4"
            data-testid="escape-copy-reader-just-made"
          >
            <p className="text-body-sm font-medium text-warning-text">
              An Escape Copy was just made. Get the reader and keep it with your
              copy — a copy you cannot open is not a backup.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-6">
          <div className="flex min-w-72 flex-1 flex-col gap-3">
            <p className="text-body text-foreground-supporting">
              The Escape Copy reader is one self-contained HTML file. It
              requires no account, no server, and no Google account. It works
              completely offline, displays your data on screen only, and never
              writes decrypted files to disk.
            </p>

            <p className="text-body text-foreground-supporting">
              Download{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-caption">
                {ESCAPE_COPY_READER_FILENAME}
              </code>{' '}
              from the GitHub Releases page and keep it in the same folder as
              your Escape Copy. When you need to read your copy, open the
              reader, select your Escape Copy file, and enter either your
              passphrase or your recovery key — both open it. Your data appears
              on screen.
            </p>

            <Button asChild className="w-full md:w-auto md:self-start">
              <a
                href={ESCAPE_COPY_READER_RELEASES_URL}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="escape-copy-reader-download-link"
              >
                Get the reader from GitHub Releases
              </a>
            </Button>
          </div>

          <aside className="flex min-w-72 flex-1 flex-col gap-2.5 rounded-panel bg-brand-soft p-4">
            <p className="text-body-sm font-bold text-brand-text-strong">
              Verify the file before opening it with your passphrase. A file
              that accepts a vault passphrase is exactly what an attacker would
              want to substitute.
            </p>

            <p className="text-body-sm text-foreground-supporting">
              After downloading, verify the reader&apos;s integrity against the
              published{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-caption">
                {ESCAPE_COPY_READER_CHECKSUM_FILENAME}
              </code>{' '}
              file using:
            </p>

            <ul className="list-disc space-y-1.5 pl-4 text-body-sm text-foreground-supporting">
              <li>
                <code className="rounded bg-muted px-1 py-0.5 text-caption">
                  sha256sum
                </code>{' '}
                (Linux/macOS/WSL)
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5 text-caption">
                  shasum -a 256
                </code>{' '}
                (macOS legacy)
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5 text-caption">
                  Get-FileHash
                </code>{' '}
                (Windows PowerShell)
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </Card>
  );
}
