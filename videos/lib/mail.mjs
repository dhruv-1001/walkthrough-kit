// Emailed links (sign-up, magic link, invite) out of a Mailpit inbox, so a
// scene can carry on where a real user would open their mail.
// Scenes get it as `mail` (built from data.mailpitUrl):
//   const { link } = await mail.waitForLink(email, { since, match: /verify/ });
// A Mailpit behind basic auth: MAILPIT_AUTH="user:password" in the environment.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const headers = () => (process.env.MAILPIT_AUTH
  ? { Authorization: `Basic ${Buffer.from(process.env.MAILPIT_AUTH).toString('base64')}` }
  : {});

/** The newest message to `email` received after `since` (ms epoch), or null. */
async function latestMessage(mailpitUrl, email, since) {
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`, { headers: headers() });
  if (!res.ok) throw new Error(`mailpit search ${res.status}`);
  const { messages = [] } = await res.json();
  const fresh = messages.filter((m) => Date.parse(m.Created) >= since - 2000);
  return fresh[0] ?? null;
}

/** Wait for a mail to `email` and return the first link in it matching `match`. */
export async function waitForMailLink(mailpitUrl, email, { since = Date.now(), match = /https?:\/\/[^\s"'<>]+/, timeoutMs = 90000 } = {}) {
  if (!mailpitUrl) throw new Error('waiting for a mailed link, but the data file has no mailpitUrl');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = await latestMessage(mailpitUrl, email, since);
    if (m) {
      const full = await (await fetch(`${mailpitUrl}/api/v1/message/${m.ID}`, { headers: headers() })).json();
      const body = `${full.HTML || ''}\n${full.Text || ''}`.replace(/&amp;/g, '&');
      const links = [...body.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((x) => x[0]);
      const link = links.find((l) => match.test(l));
      if (link) return { link, subject: full.Subject };
    }
    await sleep(1500);
  }
  throw new Error(`no mail with a link for ${email} within ${timeoutMs / 1000}s`);
}

/** The `mail` a scene receives. */
export function mailbox(mailpitUrl) {
  return { waitForLink: (email, opts) => waitForMailLink(mailpitUrl, email, opts) };
}
