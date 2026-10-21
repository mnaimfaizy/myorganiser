'use client';

import { Progress } from '@myorganiser/web-ui';
import { formatMoney, pluralize } from '../../shared/utils';

interface ListSummaryAsideProps {
  knownSpend: number;
  checkedKnown: number;
  checkedCount: number;
  totalCount: number;
  unpricedCount: number;
}

/** The navy spend card: known spend, progress through the list, and where the money sits. */
export function ListSummaryAside({
  knownSpend,
  checkedKnown,
  checkedCount,
  totalCount,
  unpricedCount,
}: ListSummaryAsideProps) {
  return (
    <section className="flex flex-col gap-3.5 rounded-panel bg-navy p-5 text-navy-foreground">
      <span className="text-label-caps text-navy-accent">KNOWN SPEND</span>
      <span className="font-display text-display tabular-nums">
        {formatMoney(knownSpend)}
      </span>
      <Progress
        tone="navy"
        value={checkedCount}
        max={Math.max(totalCount, 1)}
        aria-label="Items checked"
      />
      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-navy-muted-foreground">In the basket</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(checkedKnown)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-navy-muted-foreground">Still to buy</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(knownSpend - checkedKnown)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-navy-muted-foreground">Without a price</dt>
          <dd className="font-semibold text-warning-edge">
            {pluralize(unpricedCount, 'item')}
          </dd>
        </div>
      </dl>
      <span className="text-caption text-navy-muted-foreground">
        Prices come from your Catalog. Amounts are labels, not multipliers.
      </span>
    </section>
  );
}
