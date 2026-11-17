import { EMAIL_BRAND_NAME } from '@myorganiser/email-shell';
import nodemailer from 'nodemailer';
import winston from 'winston';
import sendEmail, { EmailMessage, MailAttachment } from './EmailService';

jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({ error: jest.fn(), info: jest.fn() })),
  format: { json: jest.fn(() => ({})) },
  transports: { Console: jest.fn() },
}));

jest.mock('nodemailer');

const mockNodemailer = jest.mocked(nodemailer);
// EmailService builds its logger once at module load; grab that instance here.
const mockLogger = jest.mocked(winston.createLogger).mock.results[0].value;
// The Console transport is constructed at the same module-load time, so its
// options are captured here too (beforeEach's clearAllMocks would drop them).
const consoleTransportOptions = jest.mocked(winston.transports.Console).mock
  .calls[0][0];

describe('EmailService', () => {
  let mockSendMail: jest.Mock;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nodemailer's Transporter has 25+ internal fields irrelevant to this mock
  let mockTransporter: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up env vars for SMTP provider
    process.env.MAIL_HOST = 'localhost';
    process.env.MAIL_PORT = '1453';
    delete process.env.MAIL_USERNAME;
    delete process.env.MAIL_PASSWORD;
    process.env.MAIL_SECURE = 'false';
    process.env.EMAIL_SENDER = 'noreply@example.com';
    process.env.DEFAULT_EMAIL_PROVIDER = 'smtp';

    // Mock transporter and sendMail (promise API: no callback argument)
    mockSendMail = jest.fn().mockResolvedValue({ response: 'OK' });

    mockTransporter = {
      sendMail: mockSendMail,
    };

    mockNodemailer.createTransport.mockReturnValue(mockTransporter);
  });

  afterEach(() => {
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_PORT;
    delete process.env.MAIL_USERNAME;
    delete process.env.MAIL_PASSWORD;
    delete process.env.MAIL_SECURE;
    delete process.env.EMAIL_SENDER;
    delete process.env.DEFAULT_EMAIL_PROVIDER;
  });

  describe('sendEmail with plain-text and html', () => {
    it('should send email with both html and text parts', async () => {
      const message: EmailMessage = {
        html: '<h1>Welcome</h1>',
        text: 'Welcome',
      };

      await sendEmail('user@example.com', 'Welcome', message);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.html).toBe('<h1>Welcome</h1>');
      expect(mailOptions.text).toBe('Welcome');
      expect(mailOptions.to).toBe('user@example.com');
      expect(mailOptions.subject).toBe('Welcome');
      expect(mailOptions.from).toEqual({
        name: EMAIL_BRAND_NAME,
        address: 'noreply@example.com',
      });
    });

    it('should not include attachments field when none are provided', async () => {
      const message: EmailMessage = {
        html: '<h1>Welcome</h1>',
        text: 'Welcome',
      };

      await sendEmail('user@example.com', 'Welcome', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.attachments).toBeUndefined();
    });
  });

  describe('sendEmail attachment pass-through', () => {
    it('should pass through single attachment to nodemailer unchanged', async () => {
      const attachment: MailAttachment = {
        filename: 'logo.png',
        content: Buffer.from('fake-png-data'),
        cid: 'company-logo',
      };

      const message: EmailMessage = {
        html: '<img src="cid:company-logo" alt="Logo" />',
        text: 'Logo image',
        attachments: [attachment],
      };

      await sendEmail('user@example.com', 'Test', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      // Verify the sender forwards html, text, and attachments unchanged.
      expect(mailOptions.html).toBe(message.html);
      expect(mailOptions.text).toBe(message.text);
      expect(mailOptions.attachments).toEqual(message.attachments);
      // CID linkage invariant (every attachment referenced, every reference attached)
      // is owned by the shell, not the sender. See assertCidLinkage in email-shell.
    });

    it('should pass through multiple attachments to nodemailer unchanged', async () => {
      const attachments: MailAttachment[] = [
        {
          filename: 'logo.png',
          content: Buffer.from('logo-data'),
          cid: 'logo',
        },
        {
          filename: 'footer.jpg',
          content: Buffer.from('footer-data'),
          cid: 'footer',
        },
      ];

      const message: EmailMessage = {
        html: '<img src="cid:logo" /><img src="cid:footer" />',
        text: 'Multi-attachment email',
        attachments,
      };

      await sendEmail('user@example.com', 'Test', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      // Verify the sender forwards html, text, and attachments unchanged.
      expect(mailOptions.html).toBe(message.html);
      expect(mailOptions.text).toBe(message.text);
      expect(mailOptions.attachments).toEqual(message.attachments);
    });
  });

  describe('sendEmail with recipient addressing', () => {
    it('should handle single recipient as string', async () => {
      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail('single@example.com', 'Subject', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe('single@example.com');
    });

    it('should join multiple recipients with comma', async () => {
      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail(
        ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        'Subject',
        message,
      );

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe(
        'user1@example.com,user2@example.com,user3@example.com',
      );
    });
  });

  describe('sendEmail integration', () => {
    it('should create transport once per invocation and send mail', async () => {
      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail('user@example.com', 'Subject', message);

      expect(mockNodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('should use configured email sender under the brand name', async () => {
      process.env.EMAIL_SENDER = 'custom-sender@example.com';

      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail('user@example.com', 'Subject', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.from).toEqual({
        name: EMAIL_BRAND_NAME,
        address: 'custom-sender@example.com',
      });
    });

    it('should pass an already-named EMAIL_SENDER through unchanged', async () => {
      process.env.EMAIL_SENDER = 'Ops <ops@example.com>';

      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail('user@example.com', 'Subject', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.from).toBe('Ops <ops@example.com>');
    });

    it('should leave from undefined when EMAIL_SENDER is unset', async () => {
      delete process.env.EMAIL_SENDER;

      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail('user@example.com', 'Subject', message);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.from).toBeUndefined();
    });
  });

  describe('sendEmail SMTP auth configuration', () => {
    it('should construct transport with auth: undefined when credentials are not set', async () => {
      // beforeEach deletes MAIL_USERNAME and MAIL_PASSWORD via delete (not = undefined)
      // so they should be undefined, and auth should be omitted or undefined
      const message: EmailMessage = {
        html: '<p>Test</p>',
        text: 'Test',
      };

      await sendEmail('user@example.com', 'Subject', message);

      const createTransportCall = mockNodemailer.createTransport.mock
        .calls[0][0] as Record<string, unknown>;
      expect(createTransportCall.auth).toBeUndefined();
    });
  });

  describe('sendEmail delivery outcome', () => {
    const message: EmailMessage = {
      html: '<p>Test</p>',
      text: 'Test',
    };

    it('should call transporter.sendMail with a single argument and no callback', async () => {
      await sendEmail('user@example.com', 'Subject', message);

      expect(mockSendMail.mock.calls[0]).toHaveLength(1);
    });

    it('should log the SMTP response once the send succeeds', async () => {
      await sendEmail('user@example.com', 'Subject', message);

      expect(mockLogger.info).toHaveBeenCalledWith('Email sent: OK');
    });

    it('should reject with the transporter error when delivery fails', async () => {
      const deliveryError = new Error('SMTP connection failed');
      mockSendMail.mockRejectedValue(deliveryError);

      await expect(
        sendEmail('user@example.com', 'Subject', message),
      ).rejects.toBe(deliveryError);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(deliveryError);
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Email sent'),
      );
    });
  });

  describe('logger configuration', () => {
    it('should send the Console transport output to stderr for error and warn levels', () => {
      expect(consoleTransportOptions).toEqual({
        stderrLevels: ['error', 'warn'],
      });
    });
  });
});
