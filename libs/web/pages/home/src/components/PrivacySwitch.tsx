import {
  colorBorderVar,
  colorCardVar,
  colorMutedVar,
  colorSuccessOnDarkVar,
  colorSurfaceContainerVar,
} from '@myorganiser/design-tokens';

/** The privacy switch that flips from Off to On as the stage scrolls. Decorative. */
export function PrivacySwitch() {
  return (
    <div
      aria-hidden="true"
      className="lp-switch-wrap mt-10 flex flex-col items-center gap-3"
      style={{ perspective: '600px' }}
    >
      <div
        className="relative flex h-32 w-24 items-center justify-center rounded-[1.75rem] border shadow-2xl"
        style={{
          borderColor: colorBorderVar,
          background: colorSurfaceContainerVar,
        }}
      >
        <div
          className="lp-toggle h-20 w-12 rounded-2xl shadow-lg"
          style={{
            background: `linear-gradient(to bottom, ${colorCardVar}, ${colorSurfaceContainerVar})`,
            transformOrigin: '50% 50%',
          }}
        />
        <span
          className="lp-led absolute right-3 top-3 h-2.5 w-2.5 rounded-full"
          style={{ background: colorMutedVar }}
        />
      </div>
      <div className="relative h-5 text-xs font-bold uppercase tracking-[0.3em]">
        <span className="lp-off absolute left-1/2 -translate-x-1/2">Off</span>
        <span
          className="lp-on absolute left-1/2 -translate-x-1/2"
          style={{ color: colorSuccessOnDarkVar }}
        >
          On
        </span>
      </div>
    </div>
  );
}
