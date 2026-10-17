import {
  colorPrimaryVar,
  colorSurfaceVar,
  fontBody,
} from '@myorganiser/design-tokens';

import { FeatureCards } from './FeatureCards';
import { FreePlan } from './FreePlan';
import { LandingFaq } from './LandingFaq';
import { LandingFooter } from './LandingFooter';
import { LandingMotion } from './LandingMotion';
import { LandingNav } from './LandingNav';
import { LandingPillars } from './LandingPillars';
import { PrivacySwitchStage } from './PrivacySwitchStage';
import { RentersBlock } from './RentersBlock';

/**
 * The landing page compositor. It arranges the sections in order and holds no
 * state of its own. Server-compatible: it renders without a session provider.
 */
export default function LandingContent() {
  return (
    <LandingMotion>
      <div
        className="min-h-screen w-full"
        style={{
          background: colorSurfaceVar,
          color: colorPrimaryVar,
          fontFamily: fontBody,
        }}
      >
        <LandingNav />
        <PrivacySwitchStage />
        <LandingPillars />
        <RentersBlock />
        <FeatureCards />
        <FreePlan />
        <LandingFaq />
        <LandingFooter />
      </div>
    </LandingMotion>
  );
}
