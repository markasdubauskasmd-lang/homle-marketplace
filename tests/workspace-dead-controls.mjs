import { readFile } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

/*
 * No workspace ships a control that cannot do anything.
 *
 * This repository's recurring defect is not missing features, it is finished
 * features nobody can reach. checklist-change-review.js was written, tested and
 * imported by nothing for weeks. The Cleaner-profile endpoints existed and were
 * permission-checked while the Landlord side never called one of them. In both
 * cases the unit tests passed the whole time, because a unit test on a module no
 * page loads proves the maths and not the feature.
 *
 * So this asserts something a string-matching test cannot: that every
 * INTERACTIVE element carrying a data-* hook has something that actually reads
 * that hook. A button whose hook nothing queries renders perfectly and does
 * nothing when pressed.
 *
 * Scoped to interactive elements on purpose. Inert containers carry data-*
 * attributes for styling or as vestigial markers; those are untidy, not broken,
 * and flagging them would bury the real finding in noise.
 */

const workspaces = [
  {
    page: "public/landlord-dashboard.html",
    scripts: ["public/landlord-dashboard.js", "public/landlord-prepare-wizard.js", "public/account-menu.js", "public/notification-badge.js"],
  },
  {
    page: "public/cleaner-dashboard.html",
    scripts: ["public/cleaner-dashboard.js", "public/cleaner-sidebar.js", "public/account-menu.js", "public/notification-badge.js"],
  },
];

const readOptional = async (path) => {
  try { return await readFile(new URL(`../${path}`, import.meta.url), "utf8"); } catch { return ""; }
};

// Hooks that carry state for CSS or assistive tech rather than behaviour.
const stateAttribute = /^data-(state|kind|status|current|role|value|index|key|label|open|resolved|done)$/;

for (const workspace of workspaces) {
  const markup = await readOptional(workspace.page);
  assert(markup, `${workspace.page} could not be read; the dead-control check is not running against it.`);
  const scripts = (await Promise.all(workspace.scripts.map(readOptional))).join("\n");

  // Every hook any script can reach: [data-x] selectors, and dataset.fooBar
  // property access, which addresses data-foo-bar.
  const reachable = new Set([...scripts.matchAll(/\[(data-[a-z0-9-]+)[\]="']/g)].map((match) => match[1]));
  for (const [, property] of scripts.matchAll(/dataset\.([a-zA-Z0-9]+)/g)) {
    reachable.add("data-" + property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`));
  }

  const dead = [];
  for (const [tag] of markup.matchAll(/<(?:button|a|input|select|textarea|summary)\b[^>]*>/gi)) {
    // A link with a working href navigates on its own; it needs no script.
    const navigates = /\shref="(?!#?")[^"]+"/.test(tag) && !/^<button/i.test(tag);
    const hooks = [...tag.matchAll(/\s(data-[a-z0-9-]+)/g)].map((match) => match[1]);
    for (const hook of hooks) {
      if (stateAttribute.test(hook) || reachable.has(hook)) continue;
      if (navigates) continue;
      dead.push({ hook, tag: tag.slice(0, 110) });
    }
  }

  assert(dead.length === 0,
    `${workspace.page} has ${dead.length} control(s) whose data hook no script reads, so pressing them does nothing:\n` +
    dead.map((entry) => `    ${entry.hook}  in  ${entry.tag}`).join("\n"));
}

/* ── Every internal link resolves to a served route ────────────────────────
   A nav entry pointing at an unrouted path is a 404 with a professional
   veneer. Checked against the server's own route table rather than a list
   maintained here, so adding a page cannot make this stale. */
const server = await readOptional("server.mjs");
assert(server, "server.mjs could not be read; link routing is unverified.");
for (const workspace of workspaces) {
  const markup = await readOptional(workspace.page);
  const links = new Set([...markup.matchAll(/href="(\/[a-z0-9/-]*)"/g)].map((match) => match[1]));
  for (const link of links) {
    if (link === "/") continue;                       // the root is served directly
    if (/\.[a-z0-9]+$/.test(link)) continue;          // static assets, not routes
    assert(server.includes(`"${link}":`),
      `${workspace.page} links to ${link}, which server.mjs does not route. That is a 404 from inside a signed-in workspace.`);
  }
}

console.log("Workspace dead-control tests passed: every interactive hook in the Landlord and Cleaner dashboards is read by a script that ships with the page, and every internal link resolves to a served route.");
