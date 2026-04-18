import nodemailer from 'nodemailer';

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: false,
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await mailer.sendMail({
    from: `"BDE Intra" <${process.env.SMTP_USER ?? 'noreply@bde.local'}>`,
    ...options,
  });
}
