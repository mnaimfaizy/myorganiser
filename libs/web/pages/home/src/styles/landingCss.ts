import {
  colorOnPrimaryVar,
  colorSecondaryVar,
  colorSuccessOnDarkVar,
  fontDisplay,
  neutral50Var,
  neutral900Var,
} from '@myorganiser/design-tokens';

// Every rule for the landing page lives here and is rendered once by
// LandingMotion. All motion sits under prefers-reduced-motion: no-preference;
// the stage's static end state covers reduced motion and browsers without
// scroll-driven animations.

/**
 * The privacy stage shown as its finished state: no sticky scroll, no 340vh of
 * empty scrolling. Used for reduced motion and for unsupported browsers.
 */
const STAGE_END_STATE = `
  .mo-landing .lp-stage { height: auto; }
  .mo-landing .lp-sticky {
    position: relative;
    height: auto;
    min-height: 100vh;
    padding: 8rem 1rem 6rem;
    background: ${neutral900Var};
    color: ${neutral50Var};
  }
  .mo-landing .lp-stack { position: relative; margin-top: 3rem; }
  .mo-landing .lp-caption,
  .mo-landing .lp-cards,
  .mo-landing .lp-last { opacity: 1; transform: none; }
  .mo-landing .lp-card { transform: rotateY(180deg); }
  .mo-landing .lp-switch-wrap,
  .mo-landing .lp-hint { display: none; }
`;

const BASE_CSS = `
.mo-landing { interpolate-size: allow-keywords; }
.mo-landing [id] { scroll-margin-top: 5rem; }
.mo-landing h1,
.mo-landing h2,
.mo-landing h3 { font-family: ${fontDisplay}; letter-spacing: -0.02em; }

.mo-landing details > summary { list-style: none; }
.mo-landing details > summary::-webkit-details-marker { display: none; }

.mo-landing .lp-sticky {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8rem 1rem 6rem;
  background: ${colorSecondaryVar};
  color: ${colorOnPrimaryVar};
}
.mo-landing .lp-glyph { position: relative; display: inline-block; }
.mo-landing .lp-cipher {
  position: absolute;
  inset: 0;
  opacity: 0;
  color: ${colorSuccessOnDarkVar};
}
.mo-landing .lp-card { position: relative; height: 9rem; transform-style: preserve-3d; }
.mo-landing .lp-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.mo-landing .lp-face-back { transform: rotateY(180deg); }
.mo-landing .lp-hint {
  position: absolute;
  bottom: 2rem;
  left: 0;
  right: 0;
}
.mo-landing details[open] .lp-chevron { transform: rotate(180deg); }
`;

const MOTION_CSS = `
.mo-landing .lp-progress {
  position: fixed;
  inset: 0 0 auto 0;
  height: 3px;
  z-index: 60;
  background: ${colorSuccessOnDarkVar};
  transform-origin: 0 50%;
  transform: scaleX(0);
  pointer-events: none;
}
html:has(.mo-landing) { scroll-behavior: smooth; }
.mo-landing details .lp-chevron { transition: transform 300ms ease; }
.mo-landing details::details-content {
  block-size: 0;
  overflow: clip;
  opacity: 0;
  transition: block-size 350ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 350ms ease,
    content-visibility 350ms allow-discrete;
}
.mo-landing details[open]::details-content { block-size: auto; opacity: 1; }

.lp-fallback .lp-reveal,
.lp-fallback .lp-scale {
  opacity: 0;
  transform: translateY(32px);
  transition: opacity 700ms cubic-bezier(0.2, 0.7, 0.2, 1),
    transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.lp-fallback .lp-reveal.is-in,
.lp-fallback .lp-scale.is-in { opacity: 1; transform: none; }

.lp-float { animation: lp-float 6s ease-in-out infinite; }

.mo-btn-shimmer { position: relative; overflow: hidden; isolation: isolate; }
.mo-btn-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, ${colorOnPrimaryVar} 0%, transparent) 0,
    color-mix(in srgb, ${colorOnPrimaryVar} 20%, transparent) 20%,
    color-mix(in srgb, ${colorOnPrimaryVar} 50%, transparent) 60%,
    color-mix(in srgb, ${colorOnPrimaryVar} 0%, transparent)
  );
  animation: lp-shimmer 2.5s infinite;
  pointer-events: none;
}

@supports ((animation-timeline: view()) and (animation-range: entry)) {
  .mo-landing .lp-progress {
    animation: lp-grow linear both;
    animation-timeline: scroll(root);
  }
  .lp-reveal {
    animation: lp-fade-up linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 80%;
  }
  .lp-scale {
    animation: lp-scale-in linear both;
    animation-timeline: view();
    animation-range: entry 0% cover 35%;
  }

  .mo-landing .lp-stage { height: 340vh; view-timeline: --lp-stage; }
  .mo-landing .lp-sticky {
    position: sticky;
    top: 0;
    height: 100vh;
    padding: 0 1rem;
    overflow: hidden;
    animation: lp-night linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 8% contain 30%;
  }
  .mo-landing .lp-hero {
    animation: lp-shrink linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 40% contain 52%;
  }
  .mo-landing .lp-intro {
    animation: lp-fade-out linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 4% contain 12%;
  }
  .mo-landing .lp-toggle {
    animation: lp-flip-switch linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 2% contain 14%;
  }
  .mo-landing .lp-led {
    animation: lp-glow linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 10% contain 16%;
  }
  .mo-landing .lp-on {
    opacity: 0;
    animation: lp-label-on linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 10% contain 14%;
  }
  .mo-landing .lp-off {
    animation: lp-label-off linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 6% contain 10%;
  }
  .mo-landing .lp-plain {
    animation: lp-hide linear both;
    animation-timeline: --lp-stage;
    animation-range: contain calc(16% + var(--i) * 0.9%) contain calc(17% + var(--i) * 0.9%);
  }
  .mo-landing .lp-cipher {
    animation: lp-show linear both;
    animation-timeline: --lp-stage;
    animation-range: contain calc(16% + var(--i) * 0.9%) contain calc(17% + var(--i) * 0.9%);
  }
  .mo-landing .lp-switch-wrap {
    animation: lp-fade-opacity linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 34% contain 42%;
  }
  .mo-landing .lp-stack {
    position: absolute;
    inset-inline: 0;
    top: 40vh;
    padding: 0 1rem;
  }
  .mo-landing .lp-caption {
    animation: lp-fade-in linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 44% contain 54%;
  }
  .mo-landing .lp-cards {
    animation: lp-fade-in linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 48% contain 58%;
  }
  .mo-landing .lp-card {
    animation: lp-card-flip linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 70% contain 84%;
  }
  .mo-landing .lp-last {
    animation: lp-fade-in linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 76% contain 86%;
  }
  .mo-landing .lp-hint {
    animation: lp-fade-opacity linear both;
    animation-timeline: --lp-stage;
    animation-range: contain 0% contain 6%;
  }
}

@keyframes lp-grow { to { transform: scaleX(1); } }
@keyframes lp-fade-up { from { opacity: 0; transform: translateY(40px); } }
@keyframes lp-scale-in {
  from { opacity: 0; transform: scale(0.92) translateY(24px); }
}
@keyframes lp-float { 50% { transform: translateY(-10px); } }
@keyframes lp-shimmer { 100% { transform: translateX(100%); } }
@keyframes lp-night {
  to { background-color: ${neutral900Var}; color: ${neutral50Var}; }
}
@keyframes lp-flip-switch {
  from { transform: rotateX(28deg); }
  to { transform: rotateX(-28deg); }
}
@keyframes lp-glow {
  to {
    box-shadow: 0 0 80px 10px color-mix(in srgb, ${colorSuccessOnDarkVar} 45%, transparent);
    background-color: ${colorSuccessOnDarkVar};
  }
}
@keyframes lp-label-on { to { opacity: 1; } }
@keyframes lp-label-off { to { opacity: 0; } }
@keyframes lp-hide { to { opacity: 0; } }
@keyframes lp-show { to { opacity: 1; } }
@keyframes lp-fade-opacity { to { opacity: 0; } }
@keyframes lp-fade-out { to { opacity: 0; transform: translateY(-30px); } }
@keyframes lp-fade-in {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: none; }
}
@keyframes lp-card-flip { to { transform: rotateY(180deg); } }
@keyframes lp-shrink { to { transform: translateY(-18vh) scale(0.55); } }
`;

/** Everything LandingMotion renders into its single style element. */
export const LANDING_CSS = `
${BASE_CSS}
@media (prefers-reduced-motion: no-preference) {
${MOTION_CSS}
}
@supports not ((animation-timeline: view()) and (animation-range: entry)) {
${STAGE_END_STATE}
}
@media (prefers-reduced-motion: reduce) {
${STAGE_END_STATE}
  .mo-landing .lp-reveal,
  .mo-landing .lp-scale { opacity: 1; transform: none; }
}
`;
