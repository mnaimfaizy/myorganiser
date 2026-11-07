import { youTubeDigestSchema } from './youtubeDigest';

describe('youTubeDigestSchema', () => {
  it.each([0, 3, 6])('accepts weekday %i', (weekday) => {
    expect(
      youTubeDigestSchema.safeParse({ enabled: true, weekday }).success,
    ).toBe(true);
  });

  it.each([-1, 7, 1.5])('rejects weekday %s', (weekday) => {
    const r = youTubeDigestSchema.safeParse({ enabled: true, weekday });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Select a day.');
  });

  it('rejects a non-boolean enabled flag', () => {
    expect(
      youTubeDigestSchema.safeParse({ enabled: 'yes', weekday: 1 }).success,
    ).toBe(false);
  });
});
