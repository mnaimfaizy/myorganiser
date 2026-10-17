'use client';

import { type ReactNode, useEffect, useRef } from 'react';

import { REDUCED_MOTION_QUERY } from '../hooks/reduced-motion-query';
import { LANDING_CSS } from '../styles/landingCss';

const SCROLL_DRIVEN_SUPPORT =
  '(animation-timeline: view()) and (animation-range: entry)';
const FALLBACK_TARGETS = '.lp-reveal:not(.is-in), .lp-scale:not(.is-in)';

interface LandingMotionProps {
  children: ReactNode;
}

/**
 * Page-scoped motion layer for the landing page. It renders the page's one
 * style element and a top scroll-progress bar, and wraps the page in the root
 * element the CSS is scoped to. Without scroll-driven animations, and when
 * motion is allowed, it marks the root so reveal content starts hidden and an
 * IntersectionObserver reveals it. Content is visible without JavaScript.
 */
export function LandingMotion({ children }: LandingMotionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    if (CSS.supports(SCROLL_DRIVEN_SUPPORT)) return;

    root.classList.add('lp-fallback');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    );
    const observeAll = () => {
      root
        .querySelectorAll(FALLBACK_TARGETS)
        .forEach((node) => observer.observe(node));
    };
    observeAll();
    // Sections render once, but keep the observer honest if children change.
    const mutations = new MutationObserver(observeAll);
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      root.classList.remove('lp-fallback');
    };
  }, []);

  return (
    <div ref={rootRef} className="mo-landing">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div aria-hidden="true" className="lp-progress" />
      {children}
    </div>
  );
}
