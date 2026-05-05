import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const email = await parser.parse(rawEmail);

    const pdfAttachments = (email.attachments || []).filter(
      (a) => a.mimeType === 'application/pdf' || a.mimeType.startsWith('image/'),
    );

    if (pdfAttachments.length === 0) {
      await message.forward('ops@lemedspa.com');
      return;
    }

    const fromEmail = message.from;

    for (const attachment of pdfAttachments) {
      const formData = new FormData();
      formData.append('from_email', fromEmail);
      formData.append('filename', attachment.filename || `coi-${Date.now()}.pdf`);
      formData.append(
        'file',
        new Blob([attachment.content], { type: attachment.mimeType }),
        attachment.filename || `coi-${Date.now()}.pdf`,
      );

      const response = await fetch(`${env.PAYTRACK_API_URL}/api/compliance/coi-inbound`, {
        method: 'POST',
        headers: { 'x-email-worker-secret': env.EMAIL_WORKER_SECRET },
        body: formData,
      });

      if (!response.ok) {
        console.error('Failed to POST to paytrack:', await response.text());
      }
    }
  },
};
