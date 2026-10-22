import Link from 'next/link';

type YouTubeSectionId = 'videos' | 'shorts' | 'channels';

/** One table for every section: its href and its label. The nav fans out over its keys. */
const YOUTUBE_SECTION_LINKS = {
  videos: { href: '/dashboard/youtube', label: 'Videos' },
  shorts: { href: '/dashboard/youtube/shorts', label: 'Shorts' },
  channels: { href: '/dashboard/youtube/channels', label: 'Channels' },
} as const satisfies Record<YouTubeSectionId, { href: string; label: string }>;

const YOUTUBE_SECTION_IDS = Object.keys(
  YOUTUBE_SECTION_LINKS,
) as YouTubeSectionId[];

interface YouTubeSectionNavProps {
  current: YouTubeSectionId;
  /** Desktop only: shown as "Channels · N" when a number. Phone labels never carry counts. */
  channelCount?: number | null;
  variant: 'desktop' | 'phone';
}

/**
 * The Videos / Shorts / Channels section navigation. It is route navigation,
 * so it is a `nav` of links with `aria-current="page"` on the current one,
 * not a tablist.
 */
const YouTubeSectionNav = ({
  current,
  channelCount,
  variant,
}: YouTubeSectionNavProps) => {
  const isPhone = variant === 'phone';

  const labelFor = (id: YouTubeSectionId): string => {
    const { label } = YOUTUBE_SECTION_LINKS[id];
    if (!isPhone && id === 'channels' && typeof channelCount === 'number') {
      return `${label} · ${channelCount}`;
    }
    return label;
  };

  if (isPhone) {
    return (
      <nav aria-label="YouTube">
        <ul className="m-0 grid grid-cols-3 gap-1 rounded-control bg-muted p-1 list-none">
          {YOUTUBE_SECTION_IDS.map((id) => {
            const isCurrent = id === current;
            return (
              <li key={id}>
                <Link
                  href={YOUTUBE_SECTION_LINKS[id].href}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={
                    isCurrent
                      ? 'flex h-11 items-center justify-center rounded-control-sm bg-raised-surface text-body-sm font-semibold text-foreground shadow-segment'
                      : 'flex h-11 items-center justify-center rounded-control-sm text-body-sm font-semibold text-muted-foreground'
                  }
                >
                  {labelFor(id)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="YouTube" className="border-b border-border">
      <ul className="m-0 flex flex-wrap gap-6 p-0 list-none">
        {YOUTUBE_SECTION_IDS.map((id) => {
          const isCurrent = id === current;
          return (
            <li key={id}>
              <Link
                href={YOUTUBE_SECTION_LINKS[id].href}
                aria-current={isCurrent ? 'page' : undefined}
                className={
                  isCurrent
                    ? '-mb-px flex h-11 items-center border-b-3 border-brand text-body-sm font-semibold text-foreground'
                    : 'flex h-11 items-center border-b-3 border-transparent text-body-sm font-semibold text-muted-foreground hover:text-foreground'
                }
              >
                {labelFor(id)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export { YouTubeSectionNav };
export type { YouTubeSectionId, YouTubeSectionNavProps };
