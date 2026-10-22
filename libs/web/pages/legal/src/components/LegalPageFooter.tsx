import { cn } from '@myorganiser/web-ui';
import { LEGAL_CONTENT_WIDTH } from '../lib/legal-styles';

/** Footer line with the copyright and the vault encryption note. */
export function LegalPageFooter() {
  return (
    <footer className="border-t border-border bg-card px-6 py-5 text-caption text-muted-foreground">
      <div
        className={cn(
          LEGAL_CONTENT_WIDTH,
          'flex flex-wrap justify-between gap-x-6 gap-y-2',
        )}
      >
        <span>
          © {new Date().getFullYear()} MyOrganiser. All rights reserved.
        </span>
        <span>
          Your vault is encrypted on your device. We only ever store ciphertext.
        </span>
      </div>
    </footer>
  );
}
