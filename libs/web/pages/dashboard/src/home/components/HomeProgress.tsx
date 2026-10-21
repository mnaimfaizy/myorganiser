import { Progress } from '@myorganiser/web-ui';

export interface HomeProgressProps {
  done: number;
  total: number;
}

/** Today's task progress on a navy ground. The bar's name is its label. */
export function HomeProgress({ done, total }: HomeProgressProps) {
  return (
    <Progress
      tone="navy"
      min={0}
      max={total}
      value={done}
      aria-label="Today's tasks done"
      className="h-2 max-w-[420px]"
    />
  );
}
