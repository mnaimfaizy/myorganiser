import {
  colorBorderVar,
  colorMutedVar,
  colorPrimaryVar,
  colorSurfaceContainerVar,
} from '@myorganiser/design-tokens';
import type { ReactNode } from 'react';

interface ClipDeviceProps {
  icon: ReactNode;
  label: string;
}

/** A device or service node in the vault-copy clip diagram. */
export function ClipDevice({ icon, label }: ClipDeviceProps) {
  return (
    <div className="z-0 flex flex-col items-center gap-1">
      <div
        className="rounded-2xl border p-3"
        style={{
          borderColor: colorBorderVar,
          background: colorSurfaceContainerVar,
          color: colorPrimaryVar,
        }}
      >
        {icon}
      </div>
      <span className="text-[10px]" style={{ color: colorMutedVar }}>
        {label}
      </span>
    </div>
  );
}
