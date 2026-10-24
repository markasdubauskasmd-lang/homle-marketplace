// The HTML part of a transactional email, derived from its plain text.
//
// The plain text stays the message of record: it is what every validator in
// email-delivery-message.mjs checks, and it is what a text-only client shows.
// This renders that same text, so the two parts cannot say different things,
// and nothing reaches the markup that the text validators did not already
// accept. Every character is escaped; the only markup added is paragraphs and
// a link for a URL on Homle's own origin. Any other URL stays inert text.
//
// Colours are the Landlord workspace palette (the single design system, see
// DECISIONS.md), inlined because email clients drop stylesheets.

const palette = Object.freeze({
  canvas: "#f7f6f5",
  paper: "#ffffff",
  ink: "#1a1a1a",
  muted: "#666666",
  border: "#e7e4e0",
  action: "#c4151b"
});

const urlPattern = /https?:\/\/[^\s<>"']+/g;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ownUrl(value, appOrigin) {
  // A sentence can end a link with punctuation; it is not part of the URL.
  const trimmed = value.replace(/[.,;:!?)]+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.origin !== appOrigin || url.username || url.password) return null;
    return { href: url.toString(), consumed: trimmed.length };
  } catch {
    return null;
  }
}

function paragraphHtml(paragraph, appOrigin) {
  let html = "";
  let last = 0;
  let firstLink = true;
  for (const match of paragraph.matchAll(urlPattern)) {
    const own = ownUrl(match[0], appOrigin);
    if (!own) continue;
    const before = paragraph.slice(last, match.index).replace(/:\s*$/, firstLink ? "" : ":");
    html += escapeHtml(before).replaceAll("\n", "<br>");
    html += firstLink
      ? `</p><p style="margin:24px 0"><a href="${escapeHtml(own.href)}" style="display:inline-block;background:${palette.action};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Open in Homle</a></p><p style="margin:0 0 16px;color:${palette.muted};font-size:13px;word-break:break-all">Or paste this link into your browser: <a href="${escapeHtml(own.href)}" style="color:${palette.ink}">${escapeHtml(own.href)}</a>`
      : `<a href="${escapeHtml(own.href)}" style="color:${palette.ink}">${escapeHtml(own.href)}</a>`;
    firstLink = false;
    last = match.index + own.consumed;
  }
  html += escapeHtml(paragraph.slice(last)).replaceAll("\n", "<br>");
  return `<p style="margin:0 0 16px">${html}</p>`.replaceAll(`<p style="margin:0 0 16px"></p>`, "");
}

export function emailHtmlFromText(text, appOrigin, subject = "") {
  if (typeof text !== "string" || !text) throw new TypeError("Email text is required for its HTML part.");
  const origin = new URL(appOrigin).origin;
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const body = paragraphs.map((paragraph) => paragraphHtml(paragraph, origin)).join("\n");
  const title = escapeHtml(String(subject).replace(/^Homle:\s*/, "") || "Homle");
  return `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${palette.canvas}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.canvas};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${palette.paper};border:1px solid ${palette.border};border-radius:12px">
<tr><td style="padding:24px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:${palette.action}">Homle</td></tr>
<tr><td style="padding:8px 28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:${palette.ink}">
${body}
</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${palette.muted}">You are receiving this because of activity on your Homle account.</p>
</td></tr>
</table>
</body>
</html>`;
}
