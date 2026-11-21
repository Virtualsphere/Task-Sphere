// Outgoing email (Gmail / Google Workspace SMTP with an app password).
// Disabled automatically when GMAIL_USER / GMAIL_APP_PASSWORD are not set.
const nodemailer = require('nodemailer');

const user = (process.env.GMAIL_USER || '').trim();
// Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of it
const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const fromName = process.env.MAIL_FROM_NAME || 'TaskSphere';
const appUrl = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');

const enabled = Boolean(user && pass);
const transporter = enabled
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  : null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLE_TEXT = {
  admin: 'Admin – manage members, lists and statuses',
  member: 'Member – create and edit tickets, chat',
  viewer: 'Viewer – read-only access, can chat',
};

/**
 * Tell someone they were added to / invited to a space.
 * Never throws: returns true when the email was accepted by Gmail, false otherwise.
 */
async function sendSpaceInvite({ to, inviterName, inviterEmail, spaceName, role, alreadyUser }) {
  if (!enabled) return false;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const action = alreadyUser
    ? 'Open TaskSphere to see it on your dashboard.'
    : `Sign in with your Google account (<b>${esc(to)}</b>) to join – the space will be waiting for you.`;
  const actionText = alreadyUser
    ? 'Open TaskSphere to see it on your dashboard.'
    : `Sign in with your Google account (${to}) to join – the space will be waiting for you.`;

  const subject = `${inviterName} invited you to "${spaceName}" on TaskSphere`;
  const text = [
    `Hi,`,
    ``,
    `${inviterName} (${inviterEmail}) added you to the space "${spaceName}" on TaskSphere as ${roleLabel}.`,
    `Your access: ${ROLE_TEXT[role] || roleLabel}`,
    ``,
    actionText,
    `${appUrl}`,
    ``,
    `– TaskSphere`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb">
    <tr><td style="padding:28px 28px 8px">
      <div style="font-size:18px;font-weight:bold;color:#4f46e5">TaskSphere</div>
    </td></tr>
    <tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.6">
      <p style="margin:0 0 12px"><b>${esc(inviterName)}</b> (${esc(inviterEmail)}) added you to the space
        <b>“${esc(spaceName)}”</b> as <b>${esc(roleLabel)}</b>.</p>
      <p style="margin:0 0 12px;color:#4b5563">Your access: ${esc(ROLE_TEXT[role] || roleLabel)}</p>
      <p style="margin:0 0 20px">${action}</p>
    </td></tr>
    <tr><td style="padding:0 28px 28px">
      <a href="${esc(appUrl)}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Open TaskSphere</a>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Or copy this link: ${esc(appUrl)}</p>
    </td></tr>
  </table>
</body></html>`;

  try {
    await transporter.sendMail({
      from: { name: fromName, address: user },
      replyTo: inviterEmail ? { name: inviterName, address: inviterEmail } : undefined,
      to,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error(`Invite email to ${to} failed:`, err.message);
    return false;
  }
}

// ---------- Notification emails (huddle started, @mentions) ----------

// Same look as the invite email: a short message and one button
function card({ heading, lines, button, url, footer }) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb">
    <tr><td style="padding:28px 28px 8px">
      <div style="font-size:18px;font-weight:bold;color:#4f46e5">TaskSphere</div>
    </td></tr>
    <tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.6">
      <p style="margin:0 0 12px;font-size:17px"><b>${heading}</b></p>
      ${lines.map((l) => `<p style="margin:0 0 12px;color:#374151">${l}</p>`).join('')}
    </td></tr>
    <tr><td style="padding:8px 28px 28px">
      <a href="${esc(url)}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${esc(button)}</a>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Or copy this link: ${esc(url)}</p>
      ${footer ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af">${footer}</p>` : ''}
    </td></tr>
  </table>
</body></html>`;
}

async function send({ to, subject, text, html, replyTo }) {
  if (!enabled || !to) return false;
  try {
    await transporter.sendMail({ from: { name: fromName, address: user }, replyTo, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`Email "${subject}" to ${to} failed:`, err.message);
    return false;
  }
}

const absolute = (path) => `${appUrl}${path.startsWith('/') ? path : `/${path}`}`;

/** Someone started a huddle you can join. `where` is e.g. "a 1:1 chat" or "the space “Sales”". Never throws. */
function sendHuddleStarted({ to, starterName, starterEmail, where, direct, path }) {
  const url = absolute(path);
  const subject = direct ? `${starterName} is calling you on TaskSphere` : `${starterName} started a huddle in ${where}`;
  const heading = direct ? `🎧 ${esc(starterName)} is calling you` : `🎧 ${esc(starterName)} started a huddle`;
  const lines = [
    direct ? `${esc(starterName)} started a huddle with you on TaskSphere.` : `A huddle is live in <b>${esc(where)}</b>. Join now to talk with the team.`,
  ];
  const text = [`${direct ? `${starterName} started a huddle with you.` : `${starterName} started a huddle in ${where}.`}`, '', `Join: ${url}`, '', '– TaskSphere'].join('\n');
  return send({
    to, subject, text,
    html: card({ heading, lines, button: 'Join the huddle', url, footer: 'The huddle ends when everyone has left.' }),
    replyTo: starterEmail ? { name: starterName, address: starterEmail } : undefined,
  });
}

/** You were @mentioned. `where` is e.g. "the space “Sales”", "task #12 “Fix login”" or "a chat". Never throws. */
function sendMention({ to, fromName: who, fromEmail, where, snippet, path }) {
  const url = absolute(path);
  const subject = `${who} mentioned you in ${where}`;
  const quote = String(snippet || '').slice(0, 400);
  const text = [`${who} mentioned you in ${where}:`, '', `"${quote}"`, '', `Open: ${url}`, '', '– TaskSphere'].join('\n');
  return send({
    to, subject, text,
    html: card({
      heading: `💬 ${esc(who)} mentioned you`,
      lines: [
        `In ${esc(where)}:`,
        `<span style="display:block;border-left:3px solid #6366f1;padding:6px 12px;background:#f5f7ff;border-radius:4px;white-space:pre-wrap">${esc(quote)}</span>`,
      ],
      button: 'Open in TaskSphere',
      url,
    }),
    replyTo: fromEmail ? { name: who, address: fromEmail } : undefined,
  });
}

module.exports = { mailEnabled: enabled, sendSpaceInvite, sendHuddleStarted, sendMention, appUrl };
