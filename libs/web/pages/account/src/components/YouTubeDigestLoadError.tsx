'use client';

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from '@myorganiser/web-ui';

interface YouTubeDigestLoadErrorProps {
  message: string;
  onRetry: () => void;
}

export function YouTubeDigestLoadError({
  message,
  onRetry,
}: YouTubeDigestLoadErrorProps) {
  return (
    <Alert variant="banner" tone="danger">
      <AlertTitle>
        {"Couldn't load your weekly YouTube digest settings"}
      </AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
