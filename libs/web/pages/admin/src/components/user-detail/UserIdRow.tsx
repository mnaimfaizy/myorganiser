'use client';

import type { AdminVariant } from '../../paged-list/adminVariant';
import * as React from 'react';
import { Button, useToast } from '@myorganiser/web-ui';
import { Check, Copy } from 'lucide-react';

export interface UserIdRowProps {
  userId: string;
  variant: AdminVariant;
}

const COPIED_FEEDBACK_MS = 2000;

/**
 * The User's ID as a labelled meta row: the full ID in monospace, selectable
 * so it can be read or copied by hand, with a copy button beside it.
 */
export function UserIdRow({ userId, variant }: UserIdRowProps) {
  const isPhone = variant === 'phone';
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyUserId = React.useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      toast({ title: 'User ID copied' });
    } catch {
      toast({
        title: 'Could not copy User ID',
        description: 'Copy it manually from the page.',
        variant: 'destructive',
      });
    }
  }, [toast, userId]);

  // Fire-and-forget: the outcome is reported through the toast.
  const handleCopyClick = React.useCallback(() => {
    void copyUserId();
  }, [copyUserId]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-caption text-muted-foreground">User ID</span>
      <span className="min-w-0 break-all font-mono text-body-sm text-foreground select-text">
        {userId}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Copy User ID"
        className={isPhone ? undefined : 'md:size-10'}
        onClick={handleCopyClick}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}
