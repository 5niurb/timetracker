import { Resend } from 'resend';
import twilio from 'twilio';

const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_PHONE = process.env.TWILIO_PHONE_NUMBER;
const FROM_EMAIL = 'paytrack@lemedspa.com';

export async function sendCOIReminder({ to_email, to_phone, worker_name, expiry_date, upload_url }) {
  if (!to_email) throw new Error(`sendCOIReminder: to_email is required (worker: ${worker_name ?? 'unknown'})`);
  const firstName = (worker_name ?? '').split(' ')[0] || 'there';
  const expiryStr = expiry_date
    ? `expiring ${new Date(expiry_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : 'on file';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: to_email,
      subject: `Hi ${firstName} — we still need your updated insurance certificate`,
      html: `
      <p>Hi ${firstName} 👋</p>
      <p>Your certificate of insurance is ${expiryStr}. Once your insurer sends you the updated certificate, just forward it to us and we'll take care of the rest.</p>
      <p><strong>Forward your COI email to:</strong><br>
      <a href="mailto:coi@lemedspa.app" style="font-size:1.1rem;color:#0066cc">coi@lemedspa.app</a></p>
      <p>Or if you have the file handy, upload it here:<br>
      <a href="${upload_url}">${upload_url}</a></p>
      <p>Questions? <a href="mailto:ops@lemedspa.com">ops@lemedspa.com</a></p>
    `,
    });
  } catch (err) {
    throw new Error(`sendCOIReminder: failed to send email to ${to_email} (${worker_name}): ${err.message}`);
  }

  if (to_phone) {
    try {
      await twilioClient.messages.create({
        from: FROM_PHONE,
        to: to_phone,
        body: `Le Med Spa: Hi ${firstName}! We still need your updated insurance cert. Forward your broker email to coi@lemedspa.app or upload here: ${upload_url}`,
      });
    } catch (err) {
      throw new Error(`sendCOIReminder: failed to send SMS to ${to_phone} (${worker_name}): ${err.message}`);
    }
  }
}

export async function sendCOIConfirmRequest({ to_email, to_phone, worker_name, confirm_url }) {
  if (!to_email) throw new Error(`sendCOIConfirmRequest: to_email is required (worker: ${worker_name ?? 'unknown'})`);
  const firstName = (worker_name ?? '').split(' ')[0] || 'there';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: to_email,
      subject: `Got your insurance certificate ✓ — takes 30 sec to confirm`,
      html: `
      <p>Hi ${firstName} 👋</p>
      <p>We received your certificate and pulled out the key details. Takes about 30 seconds to confirm everything looks right.</p>
      <p><a href="${confirm_url}" style="display:inline-block;padding:10px 20px;background:#e8c46a;color:#111;font-weight:bold;text-decoration:none;border-radius:6px">Review & Confirm →</a></p>
    `,
    });
  } catch (err) {
    throw new Error(`sendCOIConfirmRequest: failed to send email to ${to_email} (${worker_name}): ${err.message}`);
  }

  if (to_phone) {
    try {
      await twilioClient.messages.create({
        from: FROM_PHONE,
        to: to_phone,
        body: `Le Med Spa: Got your insurance doc! Takes 30 sec to confirm the details — tap here: ${confirm_url}`,
      });
    } catch (err) {
      throw new Error(
        `sendCOIConfirmRequest: failed to send SMS to ${to_phone} (${worker_name}): ${err.message}`,
      );
    }
  }
}

export async function sendCOIApproved({ to_email, worker_name, insurer, expiry_date }) {
  if (!to_email) throw new Error(`sendCOIApproved: to_email is required (worker: ${worker_name ?? 'unknown'})`);
  const firstName = (worker_name ?? '').split(' ')[0] || 'there';
  const expiryStr = expiry_date
    ? new Date(expiry_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'the date on file';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: to_email,
      subject: `Your insurance certificate is on file ✓`,
      html: `
      <p>Hi ${firstName} 👋</p>
      <p>All set! Your updated certificate from ${insurer} is on file, valid through ${expiryStr}. No further action needed.</p>
      <p>Thanks,<br>Le Med Spa Operations</p>
    `,
    });
  } catch (err) {
    throw new Error(`sendCOIApproved: failed to send email to ${to_email} (${worker_name}): ${err.message}`);
  }
}
