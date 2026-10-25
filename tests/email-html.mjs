import assert from "node:assert/strict";
import { emailHtmlFromText } from "../src/marketplace/email-html.mjs";

const origin = "https://homlle.com";
const text = "Hello <script>alert(1)</script> & \"friends\",\n\nYour booking changed.\n\nOpen the next private step in Homle: https://homlle.com/bookings/2a0b?x=1&y=2\n\nSee also https://evil.example/phish and javascript:alert(1).";
const html = emailHtmlFromText(text, origin, "Homle: <b>booking</b> update");

// Everything the text carries is escaped: no tag, attribute or entity from the
// message can become markup.
assert(!html.includes("<script>") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "Message text reached the markup unescaped.");
assert(html.includes("&amp; &quot;friends&quot;"), "Ampersands and quotes were not escaped.");
assert(html.includes("<title>&lt;b&gt;booking&lt;/b&gt; update</title>"), "The subject reached the title unescaped.");

// Only Homle's own origin becomes a link; anything else stays inert text.
assert(html.includes('href="https://homlle.com/bookings/2a0b?x=1&amp;y=2"'), "The Homle action link was not rendered as a link.");
assert.equal((html.match(/Open in Homle/g) || []).length, 1, "The action button is missing or repeated.");
assert(!html.includes('href="https://evil.example') && html.includes("https://evil.example/phish"), "A foreign URL became a link.");
assert(!/href="javascript:/i.test(html), "A javascript: URL became a link.");
for (const lookalike of ["https://homlle.com.evil.example/x", "https://user:pass@homlle.com/x", "http://homlle.com/x"]) {
  assert(!emailHtmlFromText(`Go: ${lookalike}`, origin).includes(`href="${lookalike}"`), `${lookalike} was linked as if it were Homle.`);
}

// The HTML says what the text says.
for (const phrase of ["Your booking changed.", "Hello"]) assert(html.includes(phrase), `The HTML dropped "${phrase}".`);
assert.throws(() => emailHtmlFromText("", origin));

console.log("Email HTML passed: every character escaped, only Homle-origin links rendered, one action button, and the HTML says what the text says.");
