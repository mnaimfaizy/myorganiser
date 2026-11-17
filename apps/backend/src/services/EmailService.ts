import { EMAIL_BRAND_NAME } from '@myorganiser/email-shell';
import nodemailer, { SendMailOptions } from 'nodemailer';
import winston from 'winston';

export type MailAttachment = NonNullable<
  SendMailOptions['attachments']
>[number];

export interface EmailMessage {
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

// cPanel's Passenger keeps only stderr in the app root (`stderr.log`); stdout
// is dropped unless a Passenger log file is configured. A failed send must
// reach a log the operator can read, so errors and warnings go to stderr.
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ stderrLevels: ['error', 'warn'] }),
  ],
});

interface EmailOptions {
  service?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  tls?: {
    // do not fail on invalid certs
    rejectUnauthorized: boolean;
  };
}

class EmailService {
  private transporter: any;

  constructor(private options: EmailOptions) {
    this.transporter = nodemailer.createTransport(options);
  }

  // No callback: given one, nodemailer returns undefined, the `await` resolves
  // at once, and a delivery failure never reaches the caller.
  public async sendMail(mailOptions: SendMailOptions): Promise<void> {
    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Email sent: ' + info.response);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}

const getEmailService = (): EmailService => {
  const emailProviders: { [key: string]: () => EmailService } = {
    gmail: () =>
      new EmailService({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USERNAME,
          pass: process.env.GMAIL_PASSWORD,
        },
      }),
    smtp: () => {
      const hostFromEnv = process.env.MAIL_HOST?.trim();
      const host =
        hostFromEnv ||
        (process.env.NODE_ENV === 'production' ? undefined : 'localhost');

      const portRaw = process.env.MAIL_PORT?.trim();
      const portFromEnv = portRaw ? Number.parseInt(portRaw, 10) : undefined;
      const port =
        Number.isFinite(portFromEnv) && portFromEnv
          ? portFromEnv
          : process.env.NODE_ENV === 'production'
            ? undefined
            : 1453;

      const secure = (process.env.MAIL_SECURE ?? '').toLowerCase() === 'true';

      const user = process.env.MAIL_USERNAME;
      const pass = process.env.MAIL_PASSWORD;
      const auth = user && pass ? { user, pass } : undefined;

      return new EmailService({
        host,
        port,
        secure,
        auth,
        tls: {
          rejectUnauthorized: false,
        },
      });
    },
  };

  const defaultEmailProvider =
    process.env.DEFAULT_EMAIL_PROVIDER?.toLowerCase() || 'smtp';

  if (!emailProviders[defaultEmailProvider]) {
    throw new Error(
      `Invalid email provider '${defaultEmailProvider}'. Supported providers are ${Object.keys(
        emailProviders,
      ).join(', ')}`,
    );
  }

  return emailProviders[defaultEmailProvider]();
};

// A bare `EMAIL_SENDER` address is sent under the brand name, so the inbox
// shows "MyOrganiser" (#1185). A value that already names its sender, as
// `Name <address>`, is used as given.
const senderOf = (sender: string | undefined): SendMailOptions['from'] =>
  sender && !sender.includes('<')
    ? { name: EMAIL_BRAND_NAME, address: sender }
    : sender;

const sendEmail = async (
  to: string | string[],
  subject: string,
  message: EmailMessage,
): Promise<void> => {
  const emailService = getEmailService();

  const mailOptions: SendMailOptions = {
    from: senderOf(process.env.EMAIL_SENDER),
    to: Array.isArray(to) ? to.join(',') : to,
    subject: subject,
    html: message.html,
    text: message.text,
    attachments: message.attachments,
  };

  logger.info(`Sending mail to - ${to}`);
  await emailService.sendMail(mailOptions);
};

export default sendEmail;
