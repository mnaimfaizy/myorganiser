import {
  colorBorderVar,
  colorMutedVar,
  colorPrimaryVar,
  colorSuccessVar,
} from '@myorganiser/design-tokens';
import { Cloud, Laptop, Lock, Smartphone } from 'lucide-react';

import { type ClipBodyProps, VAULT_CIPHERTEXT } from '../content/featureClips';
import { ClipDevice } from './ClipDevice';

// Where the encrypted packet sits for each step: laptop, server, phone, then
// the copy saved to Google Drive.
const PACKET_POSITIONS = [
  'left-[8%]',
  'left-[30%]',
  'left-[46%]',
  'left-[62%]',
  'left-[84%]',
  'left-[84%]',
] as const;

/** An encrypted packet travelling from device to server, then a copy to the user's own Google Drive. */
export function VaultCopyClip({ step }: ClipBodyProps) {
  const position =
    PACKET_POSITIONS[Math.min(step, PACKET_POSITIONS.length - 1)];
  const copied = step >= 5;
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="relative flex items-center justify-between px-2 py-6">
        <ClipDevice icon={<Laptop className="h-7 w-7" />} label="Web" />
        <ClipDevice
          icon={<Cloud className="h-7 w-7" />}
          label="Server (ciphertext)"
        />
        <ClipDevice icon={<Smartphone className="h-7 w-7" />} label="Phone" />
        <span
          className={`absolute top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-white transition-all duration-1000 ease-in-out ${position}`}
          style={{ background: colorPrimaryVar }}
        >
          <Lock className="inline h-3 w-3" /> {VAULT_CIPHERTEXT.slice(0, 5)}…
        </span>
      </div>
      <div
        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all duration-500 ease-out ${copied ? 'opacity-100' : 'opacity-30'}`}
        style={{ borderColor: colorBorderVar, color: colorMutedVar }}
      >
        <Cloud
          className="h-4 w-4 shrink-0"
          style={{ color: colorSuccessVar }}
        />
        {/* Both captions share one grid cell, so the box keeps the taller
            caption's height whichever one is showing. */}
        <span className="grid text-center">
          <span
            className={`col-start-1 row-start-1 transition-opacity duration-500 ease-out ${copied ? 'opacity-0' : 'opacity-100'}`}
          >
            Copy to your Google Drive
          </span>
          <span
            className={`col-start-1 row-start-1 transition-opacity duration-500 ease-out ${copied ? 'opacity-100' : 'opacity-0'}`}
          >
            Encrypted copy saved to your Google Drive ✓
          </span>
        </span>
      </div>
    </div>
  );
}
