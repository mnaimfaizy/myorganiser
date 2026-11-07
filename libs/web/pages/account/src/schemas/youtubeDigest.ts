import { z } from 'zod';

// Weekday is 0 (Sunday) to 6 (Saturday), as the notification settings API
// expects.
export const youTubeDigestSchema = z.object({
  enabled: z.boolean(),
  weekday: z
    .number()
    .int('Select a day.')
    .min(0, 'Select a day.')
    .max(6, 'Select a day.'),
});

export type YouTubeDigestValues = z.infer<typeof youTubeDigestSchema>;
