import { Card } from '@myorganiser/web-ui';

interface CloudBackupUnavailableCardProps {
  reason: string;
}

export function CloudBackupUnavailableCard({
  reason,
}: CloudBackupUnavailableCardProps) {
  return (
    <Card className="h-full" data-testid="cloud-backup-unavailable">
      <div className="flex h-full flex-col gap-3 p-4 md:p-6">
        <h3 className="font-display text-title">Encrypted cloud backup</h3>
        <p className="text-body text-foreground-supporting">{reason}</p>
      </div>
    </Card>
  );
}
