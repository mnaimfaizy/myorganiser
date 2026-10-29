import type { Meta, StoryObj } from '@storybook/react';
import { renderEmailShell, type RenderedEmail } from '@myorganiser/email-shell';

/**
 * The shell references its inline logo as `cid:<id>` — a MIME Content-ID that
 * only resolves inside a mail client's parser. This bridges it to a `data:`
 * URI so the browser can actually paint it; nothing else
 * about `html` is touched.
 */
function resolveInlineImages({ html, attachments }: RenderedEmail): string {
  return attachments.reduce(
    (resolved, attachment) =>
      resolved.replaceAll(
        `cid:${attachment.cid}`,
        `data:${attachment.contentType};base64,${attachment.content.toString('base64')}`,
      ),
    html,
  );
}

function EmailPreview({ rendered }: { rendered: RenderedEmail }) {
  return (
    <div
      style={{ maxWidth: 640, margin: '0 auto' }}
      dangerouslySetInnerHTML={{ __html: resolveInlineImages(rendered) }}
    />
  );
}

const PLACEHOLDER_THUMBNAIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function VerificationEmailExample() {
  const rendered = renderEmailShell({
    emailClass: 'transactional',
    preheader: 'Confirm your email address to finish setting up your account.',
    blocks: [
      { kind: 'heading', text: 'Welcome to MyOrganiser' },
      {
        kind: 'paragraph',
        text: 'Thank you for registering. Confirm your email address to activate your account.',
      },
      {
        kind: 'button',
        label: 'Verify email',
        url: 'https://app.myorganiser.example/verify/email?token=fixture-token',
      },
      {
        kind: 'paragraph',
        text: 'If you did not create an account, no further action is required.',
      },
    ],
  });

  return <EmailPreview rendered={rendered} />;
}

function PasswordResetEmailExample() {
  const rendered = renderEmailShell({
    emailClass: 'transactional',
    preheader: 'Use the link inside to choose a new password.',
    blocks: [
      { kind: 'heading', text: 'Reset your password' },
      {
        kind: 'paragraph',
        text: 'We received a request to reset your password. Use the button below to choose a new one.',
      },
      {
        kind: 'button',
        label: 'Reset password',
        url: 'https://app.myorganiser.example/reset/password?token=fixture-token',
      },
      {
        kind: 'paragraph',
        text: 'If you did not request a password reset, no further action is required.',
      },
    ],
  });

  return <EmailPreview rendered={rendered} />;
}

/**
 * Fixture deliberately carries two edge cases the shell must escape correctly:
 * a first name with HTML-significant characters (interpolated straight into
 * the greeting heading, same as `buildDigestEmail`), and a long video title
 * that exercises the fluid media-row layout instead of a fixed thumbnail
 * width.
 */
function WeeklyDigestEmailExample() {
  const rendered = renderEmailShell({
    emailClass: 'notification',
    unsubscribeUrl:
      'https://app.myorganiser.example/youtube/unsubscribe?token=fixture-token',
    preheader: '3 new videos from your enabled channels.',
    blocks: [
      { kind: 'heading', text: `Hi Jamie "<Admin>" O'Brien,` },
      {
        kind: 'paragraph',
        text: 'Here is what is still new from your enabled channels. Watched uploads are left out.',
      },
      {
        kind: 'button',
        label: 'Open MyOrganiser',
        url: 'https://app.myorganiser.example/dashboard/youtube',
      },
      {
        kind: 'mediaList',
        items: [
          {
            title:
              'Advanced TypeScript Patterns for Building Type-Safe Applications at Scale in Enterprise Monorepos',
            meta: 'Web Dev Simplified · 8/15/2026',
            url: 'https://app.myorganiser.example/dashboard/youtube?channel=fixture-channel-1',
            imageUrl: PLACEHOLDER_THUMBNAIL,
            imageAlt: '',
          },
          {
            title: 'React 19 Upgrade Guide',
            meta: 'React Conference · 8/14/2026',
            url: 'https://app.myorganiser.example/dashboard/youtube?channel=fixture-channel-2',
            imageUrl: PLACEHOLDER_THUMBNAIL,
            imageAlt: '',
          },
          {
            title: 'Next.js 16 Release Notes',
            meta: 'Vercel · 8/13/2026',
            url: 'https://app.myorganiser.example/dashboard/youtube?channel=fixture-channel-3',
            imageUrl: null,
            imageAlt: '',
          },
        ],
      },
      {
        kind: 'footnote',
        text: 'MyOrganiser stores YouTube metadata only — never video files.',
        links: [
          {
            label: 'How we store your data',
            url: 'https://app.myorganiser.example/youtube/data-privacy',
          },
          {
            label: 'Digest settings',
            url: 'https://app.myorganiser.example/dashboard/youtube',
          },
        ],
      },
    ],
  });

  return <EmailPreview rendered={rendered} />;
}

const meta: Meta<typeof VerificationEmailExample> = {
  component: VerificationEmailExample,
  title: 'Components/EmailShell',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The shared MyOrganiser Email Shell (ADR 0034), rendered here with the same fixture shape each production email supplies. Every email declares whether it is Transactional (no unsubscribe link) or Notification (always carries one); these stories cover both branches.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof VerificationEmailExample>;

export const VerificationEmail: Story = {};

export const PasswordResetEmail: Story = {
  render: function Render() {
    return <PasswordResetEmailExample />;
  },
};

export const WeeklyDigestEmail: Story = {
  render: function Render() {
    return <WeeklyDigestEmailExample />;
  },
};
