import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import PrivacyPolicyPage from './PrivacyPolicyPage';

jest.mock('next/link', () => {
  return ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

describe('PrivacyPolicyPage', () => {
  afterEach(() => {
    delete process.env.OPERATOR_NAME;
    delete process.env.OPERATOR_CONTACT_EMAIL;
  });

  describe('Public rendering', () => {
    it('should render the "Privacy Policy" heading', () => {
      render(<PrivacyPolicyPage />);
      expect(
        screen.getByRole('heading', {
          name: /Privacy Policy/i,
          level: 1,
        }),
      ).toBeInTheDocument();
    });

    it('should render without throwing when no env vars are set', () => {
      expect(() => {
        render(<PrivacyPolicyPage />);
      }).not.toThrow();
    });
  });

  describe('YouTube Integration disclosure', () => {
    it('should state the feature is available only to accounts the operator has enabled, and is not offered to the public', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /is available only to accounts the operator has enabled in MyOrganiser; without that, YouTube is not available to your account/,
      );
      expect(text).toMatch(/is not offered to the public/);
      expect(text).not.toMatch(/personally know/);
    });

    it('should state the feature uses YouTube API Services', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/uses YouTube API Services/);
    });

    it('should disclose the youtube.readonly scope and describe it as read-only access', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/youtube\.readonly/);
      expect(text).toMatch(/read-only access to your YouTube subscriptions/);
    });

    it('should link "Google Privacy Policy" to policies.google.com/privacy', () => {
      render(<PrivacyPolicyPage />);
      const link = screen.getByRole('link', { name: /Google Privacy Policy/i });
      expect(link).toHaveAttribute(
        'href',
        'https://policies.google.com/privacy',
      );
    });

    it('should disclose the stored channel, video, and watched metadata', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/channel ID, title, and thumbnail/);
      expect(text).toMatch(
        /video ID, title, thumbnail, publish date, and duration/,
      );
      expect(text).toMatch(/which uploads you have marked as watched/);
    });

    it('should disclose that video files are never stored', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/We never store the video files themselves/);
    });

    it('should state the metadata is not part of the end-to-end encrypted Vault', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/is not part of the end-to-end encrypted Vault/);
    });

    it('should state OAuth tokens are encrypted at rest with AES-256-GCM', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /Your YouTube OAuth tokens are encrypted at rest on our servers with AES-256-GCM/,
      );
    });

    it('should state the data is not sold, not used for advertising, and not used to train AI/ML models', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/We do not sell it/);
      expect(text).toMatch(/we do not use it for advertising/);
      expect(text).toMatch(
        /we do not use it to train artificial intelligence or machine learning models/,
      );
    });

    it('should say the data is stored with the hosting provider, digests go through the email delivery provider, and it is not shared with anyone else', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/stored with our hosting provider/);
      expect(text).toMatch(/sent through our email delivery provider/);
      expect(text).toMatch(/It is not shared with anyone else/);
    });

    it('should link "Google API Services User Data Policy" and mention Limited Use', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const link = screen.getByRole('link', {
        name: /Google API Services User Data Policy/i,
      });
      expect(link).toHaveAttribute(
        'href',
        'https://developers.google.com/terms/api-services-user-data-policy',
      );
      const text = container.textContent || '';
      expect(text).toMatch(/including the Limited Use requirements/);
    });

    it('should describe revocation via the dashboard YouTube page and link "Google security settings"', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /disconnecting YouTube from the YouTube page in your dashboard/,
      );
      const link = screen.getByRole('link', {
        name: /Google security settings/i,
      });
      expect(link).toHaveAttribute(
        'href',
        'https://security.google.com/settings/security/permissions',
      );
    });

    it('should state disconnecting immediately deletes tokens, followed channels, cached uploads, watched marks, and digest settings, with no 30-day retention', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /Disconnecting revokes MyOrganiser's access at Google and immediately deletes your stored tokens, followed channels, cached uploads, watched marks, and notification and digest settings/,
      );
      expect(text).not.toMatch(/kept for 30 days/);
    });

    it("should state revoking MyOrganiser's access at Google stops syncing and deletes the same data within seven days unless the User reconnects", () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /If you revoke MyOrganiser's access at Google instead, MyOrganiser stops syncing and deletes the same data within seven days unless you reconnect\./,
      );
    });

    it('should state withdrawing the feature from an account deletes the same data as a disconnect, including watched marks and the revoke at Google', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /The operator may also withdraw the feature from an account; doing so deletes the same data as a disconnect, revoking MyOrganiser's access at Google and deleting your stored tokens, followed channels, cached uploads, watched marks, and notification and digest settings\./,
      );
    });

    it('should render link to YouTube Data Privacy page', () => {
      render(<PrivacyPolicyPage />);
      const link = screen.getByRole('link', {
        name: /YouTube Data Privacy page/i,
      });
      expect(link).toHaveAttribute('href', '/youtube/data-privacy');
    });

    it('should no longer render the earlier Google user data headings', () => {
      render(<PrivacyPolicyPage />);
      expect(
        screen.queryByRole('heading', { name: /How We Use Google User Data/i }),
      ).toBeNull();
      expect(
        screen.queryByRole('heading', {
          name: /Sharing and Disclosure of Google User Data/i,
        }),
      ).toBeNull();
      expect(
        screen.queryByRole('heading', { name: /How We Protect Your Data/i }),
      ).toBeNull();
    });
  });

  describe('Your Rights section', () => {
    it('should point account deletion to the self-serve flow and a data copy to the contact route', () => {
      render(<PrivacyPolicyPage />);
      const rightsSection = screen
        .getByRole('heading', { name: /Your Rights/i, level: 2 })
        .closest('section');
      expect(rightsSection).not.toBeNull();
      const rights = rightsSection?.textContent || '';
      expect(rights).toMatch(/delete your account as described above/);
      expect(rights).toMatch(/contact us using the information below/);
    });

    it('should no longer say deletion is done on request or from account settings', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).not.toMatch(/done on request/i);
      expect(text).not.toMatch(/from your account settings/i);
    });
  });

  describe('Operator & Contact section', () => {
    it('should render operator section when OPERATOR_NAME is set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/Operator & Contact/i);
      expect(text).toMatch(/Acme Ops/);
    });

    it('should render contact email link when both OPERATOR_NAME and OPERATOR_CONTACT_EMAIL are set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      process.env.OPERATOR_CONTACT_EMAIL = 'privacy@acme.test';
      render(<PrivacyPolicyPage />);
      const emailLink = screen.getByRole('link', {
        name: /privacy@acme\.test/i,
      });
      expect(emailLink).toHaveAttribute('href', 'mailto:privacy@acme.test');
    });

    it('should not render contact email link when only OPERATOR_NAME is set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      // Do not set OPERATOR_CONTACT_EMAIL
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(/Acme Ops/);
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('should render contact email when only OPERATOR_CONTACT_EMAIL is set (no OPERATOR_NAME)', () => {
      process.env.OPERATOR_CONTACT_EMAIL = 'privacy@acme.test';
      render(<PrivacyPolicyPage />);
      const emailLink = screen.getByRole('link', {
        name: /privacy@acme\.test/i,
      });
      expect(emailLink).toHaveAttribute('href', 'mailto:privacy@acme.test');
    });

    it('should not render Operator section when OPERATOR_NAME is not set', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).not.toMatch(/Operator & Contact/i);
      // Ensure no placeholder text like "Your Company" or "[operator name]"
      expect(text).not.toMatch(/\[operator name\]/i);
      expect(text).not.toMatch(/Your Company/i);
    });

    it('should not render Operator section when OPERATOR_NAME is empty string', () => {
      process.env.OPERATOR_NAME = '';
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).not.toMatch(/Operator & Contact/i);
    });
  });

  describe('Cross-links', () => {
    it('should render Back to Home link', () => {
      render(<PrivacyPolicyPage />);
      const homeLink = screen.getByRole('link', { name: /Back to Home/i });
      expect(homeLink).toHaveAttribute('href', '/');
    });

    it('should render the Terms of Service action in the main content, linking to /terms', () => {
      render(<PrivacyPolicyPage />);
      // The Legal nav in the header has a Terms of Service link too; scope to main.
      const termsLink = within(screen.getByRole('main')).getByRole('link', {
        name: /Terms of Service/i,
      });
      expect(termsLink).toHaveAttribute('href', '/terms');
    });
  });

  describe('Back control', () => {
    it('should place the Back link before the single h1', () => {
      render(<PrivacyPolicyPage />);
      const backLink = screen.getByRole('link', { name: 'Back' });
      const heading = screen.getByRole('heading', { level: 1 });

      expect(backLink).toHaveAttribute('href', '/');
      expect(
        backLink.compareDocumentPosition(heading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
  });

  describe('YouTube Data Privacy link', () => {
    it('should open in the same tab on the standalone page', () => {
      render(<PrivacyPolicyPage />);
      const link = screen.getByRole('link', {
        name: /YouTube Data Privacy page/i,
      });
      expect(link).not.toHaveAttribute('target');
    });
  });

  describe('Page structure', () => {
    it('should mark the Privacy Policy link as the current page in the Legal nav and leave Terms of Service unmarked', () => {
      render(<PrivacyPolicyPage />);
      const legalNav = screen.getByRole('navigation', { name: 'Legal' });
      expect(
        within(legalNav).getByRole('link', { name: 'Privacy Policy' }),
      ).toHaveAttribute('aria-current', 'page');
      expect(
        within(legalNav).getByRole('link', { name: 'Terms of Service' }),
      ).not.toHaveAttribute('aria-current');
    });

    it('should show the Last updated date exactly once', () => {
      const { container } = render(<PrivacyPolicyPage />);
      expect(
        screen.getByText('Last updated: 15 October 2026'),
      ).toBeInTheDocument();
      expect(container.textContent?.match(/Last updated/g)).toHaveLength(1);
    });

    it('should render the footer line about the encrypted vault', () => {
      render(<PrivacyPolicyPage />);
      expect(
        screen.getByText(
          'Your vault is encrypted on your device. We only ever store ciphertext.',
        ),
      ).toBeInTheDocument();
    });

    it('should list every section in On this page with an anchor to a section headed by the same h2 text', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      render(<PrivacyPolicyPage />);
      const toc = screen.getByRole('navigation', { name: 'On this page' });
      const links = within(toc).getAllByRole('link');

      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '#overview',
        '#mobile-app',
        '#youtube',
        '#account-data',
        '#cookies',
        '#deleting',
        '#rights',
        '#contact',
        '#changes',
      ]);
      for (const link of links) {
        const id = (link.getAttribute('href') ?? '').slice(1);
        expect(document.getElementById(id)).toHaveAccessibleName(
          link.textContent ?? '',
        );
      }
    });

    it('should omit Operator & Contact from the page and the On this page list when no operator is set', () => {
      render(<PrivacyPolicyPage />);
      const toc = screen.getByRole('navigation', { name: 'On this page' });
      expect(
        within(toc).queryByRole('link', { name: 'Operator & Contact' }),
      ).toBeNull();
      expect(
        screen.queryByRole('heading', { name: 'Operator & Contact' }),
      ).toBeNull();
      expect(document.getElementById('contact')).toBeNull();
    });

    it('should show Operator & Contact in the page and the On this page list when OPERATOR_NAME is set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      render(<PrivacyPolicyPage />);
      const toc = screen.getByRole('navigation', { name: 'On this page' });
      expect(
        within(toc).getByRole('link', { name: 'Operator & Contact' }),
      ).toHaveAttribute('href', '#contact');
      expect(
        screen.getByRole('heading', { name: 'Operator & Contact', level: 2 }),
      ).toBeInTheDocument();
    });

    it('should number the sections without a gap when the operator section is absent', () => {
      render(<PrivacyPolicyPage />);
      const changes = document.getElementById('changes');
      expect(changes).not.toBeNull();
      expect(
        within(changes as HTMLElement).getByText('08'),
      ).toBeInTheDocument();
    });

    it('should number the sections in order, including Operator & Contact, when the operator section is present', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      render(<PrivacyPolicyPage />);
      const contact = document.getElementById('contact');
      const changes = document.getElementById('changes');
      expect(
        within(contact as HTMLElement).getByText('08'),
      ).toBeInTheDocument();
      expect(
        within(changes as HTMLElement).getByText('09'),
      ).toBeInTheDocument();
    });
  });

  describe('Overview and account data wording', () => {
    it('should state in the overview that the servers store only the encrypted Vault', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /our servers store only the encrypted version, which we cannot read/,
      );
    });

    it('should state the account data is stored unencrypted to operate the account', () => {
      const { container } = render(<PrivacyPolicyPage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /is stored unencrypted, because we need it to operate your account/,
      );
    });
  });
});
