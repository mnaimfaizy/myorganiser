import {
  colorBorderVar,
  colorCardVar,
  colorPrimaryVar,
} from '@myorganiser/design-tokens';
import type { ReactNode } from 'react';

interface ClipRowProps {
  children: ReactNode;
  highlight?: boolean;
}

/** A single row inside a feature clip. The highlighted row is the one in progress. */
export function ClipRow({ children, highlight = false }: ClipRowProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-all duration-500 ease-out"
      style={{
        borderColor: highlight ? colorPrimaryVar : colorBorderVar,
        background: colorCardVar,
      }}
    >
      {children}
    </div>
  );
}
