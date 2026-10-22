import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import TermsOfServicePage from './TermsOfServicePage';

jest.mock('next/link', () => {
  return ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

describe('TermsOfServicePage', () => {
  afterEach(() => {
    delete process.env.OPERATOR_NAME;
    delete process.env.OPERATOR_CONTACT_EMAIL;
  });

  describe('Public rendering', () => {
    it('should render the "Terms of Service" heading', () => {
      render(<TermsOfServicePage />);
      expect(
        screen.getByRole('heading', {
          name: /Terms of Service/i,
          level: 1,
        }),
      ).toBeInTheDocument();
    });

    it('should render without throwing when no env vars are set', () => {
      expect(() => {
        render(<TermsOfServicePage />);
      }).not.toThrow();
    });
  });

  describe('Description of Service section', () => {
    it('should describe the Vault as end-to-end encrypted with ciphertext-only server storage', () => {
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).toMatch(/end-to-end encrypted Vault/i);
      expect(text).toMatch(/server stores only the encrypted version/i);
      expect(text).toMatch(/ciphertext/i);
      expect(text).toMatch(/never has access to the unencrypted contents/i);
    });

    it('should state the YouTube feature is available only to accounts the operator has enabled, uses YouTube API Services, and is read-only', () => {
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).toMatch(
        /optional YouTube feature, which is available only to accounts the operator has enabled/,
      );
      expect(text).toMatch(/It uses YouTube API Services and is read-only/);
      expect(text).not.toMatch(/personally know/);
    });

    it('should bind the User to the YouTube Terms of Service through a link', () => {
      const { container } = render(<TermsOfServicePage />);
      const link = screen.getByRole('link', {
        name: /YouTube Terms of Service/i,
      });
      expect(link).toHaveAttribute('href', 'https://www.youtube.com/t/terms');
      const text = container.textContent || '';
      expect(text).toMatch(/agree to be bound by the YouTube Terms of Service/);
    });
  });

  describe('Acceptable Use section', () => {
    it('should prohibit unlawful use', () => {
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).toMatch(/unlawful purpose or activity/i);
    });

    it('should prohibit security breach and bypass attempts', () => {
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).toMatch(/breach.*compromise.*security/i);
      expect(text).toMatch(/bypass/i);
    });
  });

  describe('Limitation of Liability section', () => {
    it('should have Limitation of Liability heading', () => {
      render(<TermsOfServicePage />);
      expect(
        screen.getByRole('heading', {
          name: /Limitation of Liability/i,
          level: 2,
        }),
      ).toBeInTheDocument();
    });
  });

  describe('Operator & Contact section', () => {
    it('should render operator section when OPERATOR_NAME is set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).toMatch(/Operator & Contact/i);
      expect(text).toMatch(/Acme Ops/);
    });

    it('should render contact email link when both OPERATOR_NAME and OPERATOR_CONTACT_EMAIL are set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      process.env.OPERATOR_CONTACT_EMAIL = 'legal@acme.test';
      render(<TermsOfServicePage />);
      const emailLink = screen.getByRole('link', {
        name: /legal@acme\.test/i,
      });
      expect(emailLink).toHaveAttribute('href', 'mailto:legal@acme.test');
    });

    it('should not render contact email link when only OPERATOR_NAME is set', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      // Do not set OPERATOR_CONTACT_EMAIL
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).toMatch(/Acme Ops/);
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('should render contact email when only OPERATOR_CONTACT_EMAIL is set (no OPERATOR_NAME)', () => {
      process.env.OPERATOR_CONTACT_EMAIL = 'legal@acme.test';
      render(<TermsOfServicePage />);
      const emailLink = screen.getByRole('link', { name: /legal@acme\.test/i });
      expect(emailLink).toHaveAttribute('href', 'mailto:legal@acme.test');
    });

    it('should not render Operator section when OPERATOR_NAME is not set', () => {
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).not.toMatch(/Operator & Contact/i);
      // Ensure no placeholder text like "Your Company" or "[operator name]"
      expect(text).not.toMatch(/\[operator name\]/i);
      expect(text).not.toMatch(/Your Company/i);
    });

    it('should not render Operator section when OPERATOR_NAME is empty string', () => {
      process.env.OPERATOR_NAME = '';
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).not.toMatch(/Operator & Contact/i);
    });

    it('should not render Operator section when OPERATOR_NAME is whitespace only', () => {
      process.env.OPERATOR_NAME = '   ';
      const { container } = render(<TermsOfServicePage />);
      const text = container.textContent || '';
      expect(text).not.toMatch(/Operator & Contact/i);
    });
  });

  describe('Cross-links', () => {
    it('should render Back to Home link to /', () => {
      render(<TermsOfServicePage />);
      const homeLink = screen.getByRole('link', { name: /Back to Home/i });
      expect(homeLink).toHaveAttribute('href', '/');
    });

    it('should render the Privacy Policy action in the main content, linking to /privacy', () => {
      render(<TermsOfServicePage />);
      // The Legal nav in the header has a Privacy Policy link too; scope to main.
      const privacyLink = within(screen.getByRole('main')).getByRole('link', {
        name: /Privacy Policy/i,
      });
      expect(privacyLink).toHaveAttribute('href', '/privacy');
    });
  });

  describe('Back control', () => {
    it('should place the Back link before the single h1', () => {
      render(<TermsOfServicePage />);
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

  describe('Page structure', () => {
    it('should mark the Terms of Service link as the current page in the Legal nav and leave Privacy Policy unmarked', () => {
      render(<TermsOfServicePage />);
      const legalNav = screen.getByRole('navigation', { name: 'Legal' });
      expect(
        within(legalNav).getByRole('link', { name: 'Terms of Service' }),
      ).toHaveAttribute('aria-current', 'page');
      expect(
        within(legalNav).getByRole('link', { name: 'Privacy Policy' }),
      ).not.toHaveAttribute('aria-current');
    });

    it('should render the footer line about the encrypted vault', () => {
      render(<TermsOfServicePage />);
      expect(
        screen.getByText(
          'Your vault is encrypted on your device. We only ever store ciphertext.',
        ),
      ).toBeInTheDocument();
    });

    it('should list every section in On this page with an anchor to a section headed by the same h2 text', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      render(<TermsOfServicePage />);
      const toc = screen.getByRole('navigation', { name: 'On this page' });
      const links = within(toc).getAllByRole('link');

      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '#acceptance',
        '#description',
        '#accounts',
        '#acceptable-use',
        '#availability',
        '#liability',
        '#changes',
        '#contact',
      ]);
      for (const link of links) {
        const id = (link.getAttribute('href') ?? '').slice(1);
        expect(document.getElementById(id)).toHaveAccessibleName(
          link.textContent ?? '',
        );
      }
    });

    it('should omit Operator & Contact from the page and the On this page list when no operator is set', () => {
      render(<TermsOfServicePage />);
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
      render(<TermsOfServicePage />);
      const toc = screen.getByRole('navigation', { name: 'On this page' });
      expect(
        within(toc).getByRole('link', { name: 'Operator & Contact' }),
      ).toHaveAttribute('href', '#contact');
      expect(
        screen.getByRole('heading', { name: 'Operator & Contact', level: 2 }),
      ).toBeInTheDocument();
    });

    it('should number the sections without a gap when the operator section is absent', () => {
      render(<TermsOfServicePage />);
      const changes = document.getElementById('changes');
      expect(changes).not.toBeNull();
      expect(
        within(changes as HTMLElement).getByText('07'),
      ).toBeInTheDocument();
    });

    it('should number Operator & Contact 08 when the operator section is present', () => {
      process.env.OPERATOR_NAME = 'Acme Ops';
      render(<TermsOfServicePage />);
      const contact = document.getElementById('contact');
      expect(
        within(contact as HTMLElement).getByText('08'),
      ).toBeInTheDocument();
    });

    it('should render no Last updated line', () => {
      render(<TermsOfServicePage />);
      expect(screen.queryByText(/Last updated/)).toBeNull();
    });
  });
});
