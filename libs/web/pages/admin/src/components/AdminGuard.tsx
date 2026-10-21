'use client';

import {
  authSession,
  getCurrentUser,
  isPlatformAdmin,
  onSessionEnded,
  type OutboundGuardOutcome,
  resolveOutboundGuard,
} from '@myorganiser/auth';
import { type GateDecision, RetryableGate } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { type ReactNode } from 'react';

interface AdminGuardProps {
  children: ReactNode;
}

// Same outcome table as DashboardGuard. The two live in separate page libs,
// which cannot import each other.
const outcomeDecision = {
  allow: { kind: 'allow' },
  redirect_login: { kind: 'redirect', to: '/login' },
  restore_unavailable: { kind: 'unavailable' },
} as const satisfies Record<OutboundGuardOutcome['kind'], GateDecision>;

// The outbound guard decides the Session; the platform-admin check layers on
// top of an allowed Session.
async function checkPlatformAdmin(): Promise<GateDecision> {
  const outcome = await resolveOutboundGuard(authSession);
  const decision = outcomeDecision[outcome.kind];
  if (decision.kind !== 'allow') return decision;

  return isPlatformAdmin(getCurrentUser())
    ? decision
    : { kind: 'redirect', to: '/dashboard' };
}

export default function AdminGuard({ children }: AdminGuardProps) {
  const router = useRouter();

  return (
    <RetryableGate
      check={checkPlatformAdmin}
      navigate={router.replace}
      subscribeToEnd={onSessionEnded}
      endedRedirect="/login"
    >
      {children}
    </RetryableGate>
  );
}
