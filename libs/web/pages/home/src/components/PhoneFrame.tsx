import type { ReactNode } from 'react';

interface PhoneFrameProps {
  children: ReactNode;
}

/** A phone bezel with a notch, framing a clip. */
export function PhoneFrame({ children }: PhoneFrameProps) {
  return (
    <div className="relative mx-auto w-[270px] rounded-[2.75rem] border-[10px] border-black bg-white shadow-2xl">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black"
      />
      <div className="overflow-hidden rounded-[2rem] pt-8">{children}</div>
    </div>
  );
}
