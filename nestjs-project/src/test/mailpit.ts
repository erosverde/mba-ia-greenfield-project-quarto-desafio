interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
  From: { Address: string };
  Subject: string;
}

interface MailpitDetail {
  HTML: string;
}

const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export async function getMailpitMessages(): Promise<MailpitSummary[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = (await res.json()) as { messages?: MailpitSummary[] };
  return data.messages ?? [];
}

export async function getMailpitMessage(id: string): Promise<MailpitDetail> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return (await res.json()) as MailpitDetail;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
