/*
 * The 404 page.
 *
 * Until it existed, every mistyped URL, stale bookmark and expired share link
 * in the product returned `{"ok":false,"error":"Not found."}` as
 * application/json — unstyled Times New Roman on white, with no way back into
 * Homle. It was then added with no test at all, and rendering it against the
 * running app found the next version of the same fault: a signed-in
 * administrator was offered the marketing site and a help link to
 * /landlord/help, a page that refuses them because they hold no Landlord
 * workspace. An error page whose only exits are the wrong site and a second
 * error is not a recovery.
 *
 * The destination decision is EXECUTED here. What cannot be executed — that the
 * document is on the shared design system, carries a skip link, and is wired to
 * the decision — is asserted against the source, and says so.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("public/not-found.html");
const script = read("public/not-found.js");

/* ── The real decision, executed ── */

const { notFoundDestination } = await import("../public/not-found-destination.js");

const landlord = { roles: ["landlord"], selectedRole: "landlord" };
const cleaner = { roles: ["cleaner"], selectedRole: "cleaner" };
const dualAsLandlord = { roles: ["cleaner", "landlord"], selectedRole: "landlord" };
const dualAsCleaner = { roles: ["cleaner", "landlord"], selectedRole: "cleaner" };
const administrator = { roles: ["administrator"], selectedRole: null };
const staffLandlord = { roles: ["administrator", "landlord"], selectedRole: "landlord" };
// A preference the account is not entitled to must not open a workspace.
const staleSelection = { roles: ["landlord"], selectedRole: "cleaner" };

for (const [account, href, helpHref, why] of [
  [null, "/", "/landlord/help", "a signed-out visitor"],
  [landlord, "/landlord/home", "/landlord/help", "a Landlord"],
  [cleaner, "/cleaner/dashboard", "/cleaner/help-centre", "a Cleaner"],
  [dualAsLandlord, "/landlord/home", "/landlord/help", "a dual-role account in its Landlord workspace"],
  [dualAsCleaner, "/cleaner/dashboard", "/cleaner/help-centre", "a dual-role account in its Cleaner workspace"],
  [administrator, "/admin", null, "an administrator"],
  [staffLandlord, "/landlord/home", "/landlord/help", "an administrator who is also a Landlord in their Landlord workspace"],
  [staleSelection, "/onboarding", "/landlord/help", "an account whose selected role it no longer holds"],
  [{ roles: [], selectedRole: null }, "/onboarding", "/landlord/help", "a signed-in account with no workspace yet"]
]) {
  const destination = notFoundDestination(account);
  assert.equal(destination.href, href, `The 404 page sends ${why} to ${destination.href}; it must send them to ${href}.`);
  assert.equal(
    destination.helpHref,
    helpHref,
    helpHref === null
      ? `The 404 page offers ${why} a help link to ${destination.helpHref}, which refuses them. It must offer none.`
      : `The 404 page offers ${why} help at ${destination.helpHref} rather than ${helpHref}.`
  );
  assert.ok(destination.label && destination.label.length > 0, `The 404 page offers ${why} an unlabelled action.`);
}

// A Cleaner must never be handed the Landlord workspace, in either direction.
assert.notEqual(notFoundDestination(dualAsCleaner).href, notFoundDestination(dualAsLandlord).href, "The 404 page sends both workspaces of a dual-role account to the same place, so one of them is being told their workspace is the other one.");

/* ── The page itself ── */

assert.ok(script.includes("notFoundDestination(account)"), "The 404 page no longer asks the shared destination decision, so the page and this test would be judging the way back by different rules.");
assert.ok(/\(help\.closest\("p"\) \|\| help\)\.hidden = true/.test(script), "The 404 page no longer hides the help sentence when there is no support page the reader may open, so it offers a link that answers the error with a second refusal.");
assert.ok(script.includes("history.length > 1") && script.includes("back.hidden = true"), "The 404 page offers Go back with no history entry behind it, which is a button that silently does nothing.");

assert.ok(page.includes('class="skip-link"') && page.includes('href="#not-found-main"') && page.includes('id="not-found-main"'), "The 404 page lost the skip link that lets a keyboard reader reach its content.");
assert.ok(page.includes("/homle-tokens.css") && page.includes("/homle-workspace.css") && page.includes('class="homle-workspace not-found-page"'), "The 404 page is no longer on the shared design system, so a mistyped URL lands the reader on a page from a different product.");
assert.ok(page.includes('href="/" aria-label="Homle home"'), "The 404 page lost the brand mark that returns to Homle regardless of what the primary action resolves to.");
assert.ok(page.includes('name="robots" content="noindex'), "The 404 page is indexable.");
// The markup ships the visitor's answer, so a reader whose account lookup fails
// or whose JavaScript never runs still gets a working exit.
assert.ok(page.includes('href="/" data-not-found-primary>Go to Homle<'), "The 404 page's markup no longer carries the signed-out destination, so a failed account lookup leaves the primary action pointing nowhere useful.");

console.log("404 page tests passed: the way back resolves correctly for a visitor, a Landlord, a Cleaner, both workspaces of a dual-role account, an administrator and an account with no workspace yet; no reader is offered a support link that would refuse them; and the document keeps its skip link, brand mark and shared design system.");


import { mkdir, writeFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";
import { inspectCustomerMotion, assertCustomerMotion } from "./customer-motion-state-helper.mjs";

if(resolveChromiumPath()){
  let accountMode="landlord";
  const fixture=await serveStatic({extraFiles:{
    "/api/marketplace/account":()=>accountMode==="unavailable"
      ? {status:503,body:{error:"Synthetic account unavailable"}}
      : {body:{ok:true,account:accountMode==="visitor"?null:{roles:["landlord"],selectedRole:"landlord"}}}
  }});
  const browser=await launchBrowser(),rows=[],inlineObservations=[];
  const root=new URL("../test-artifacts/customer-responsive/",import.meta.url);
  await mkdir(root,{recursive:true});
  try{
    for(const width of [390,768,1440]){
      await browser.setViewport({width,height:width===768?1024:900});
      for(const mode of ["landlord","visitor","unavailable"]){
        accountMode=mode;
        await browser.goto(fixture.origin+"/not-found.html");
        await browser.evaluate("await document.fonts.ready; await new Promise(r=>setTimeout(r,250)); return null;");
        const state=await browser.evaluate(`return {
          href:document.querySelector("[data-not-found-primary]").getAttribute("href"),
          help:document.querySelector("[data-not-found-help]").getAttribute("href"),
          overflow:document.documentElement.scrollWidth>innerWidth
        };`);
        assert.equal(state.href,mode==="landlord"?"/landlord/home":"/");
        assert.equal(state.help,"/landlord/help");
        assert.equal(state.overflow,false);
        const row=await inspectCustomerMotion(browser,"404-"+mode+" "+width);
        // The support link is embedded in a sentence: the same WCAG 2.5.5
        // inline-prose exception used for legal documents, recorded explicitly.
        const inline=await browser.evaluate(`const a=document.querySelector("[data-not-found-help]"); return getComputedStyle(a).display==="inline" && a.closest("p").textContent.trim()!==a.textContent.trim();`);
        const prose=row.targetFindings.filter(f=>inline&&f.tag==="a"&&f.name==="Ask Homle for help");
        inlineObservations.push({label:row.label,findings:prose});
        rows.push({...row,targetFindings:row.targetFindings.filter(f=>!prose.includes(f))});
        await writeFile(new URL("targets-404-"+mode+"-"+width+".png",root),await browser.screenshot());
      }
    }
    console.log("404 inline-prose target observations "+JSON.stringify(inlineObservations));
    assertCustomerMotion(rows);
    assert.deepEqual(browser.pageErrors,[]);
  }finally{await browser.close();await fixture.close();}
  console.log("404 rendered recovery targets passed at390/768/1440 with documented inline-prose exception.");
}else console.log("404 rendered recovery targets SKIPPED: Chromium unavailable.");

// The 500 page. The 404 work removed the unstyled-JSON experience for a
// mistyped URL and left it in place for a server fault, which is the worse of
// the two: the person did nothing wrong, and they are most likely to be
// mid-booking when it happens.
{
  const { readFile: readSource } = await import("node:fs/promises");
  const serverSource = await readSource(new URL("../server.mjs", import.meta.url), "utf8");
  const errorPage = await readSource(new URL("../public/server-error.html", import.meta.url), "utf8");

  // Scriptless by design. This page renders when something has already failed,
  // so it must not depend on a module loading or a session resolving — either
  // could be the thing that broke.
  if (/<script/i.test(errorPage)) throw new Error("The 500 page loads a script, so the failure that produced it could also stop the page explaining it.");
  if (!errorPage.includes("Error 500")) throw new Error("The 500 page does not say what happened.");
  // Somebody mid-booking needs to know whether they were charged.
  if (!/(?:Nothing|not)[^.]*charged or confirmed/.test(errorPage)) throw new Error("The 500 page does not tell a customer whether their booking or payment went through.");
  if (!errorPage.includes('href="/"') || !errorPage.includes("/landlord/help")) throw new Error("The 500 page offers no way back into Homle and no way to ask for help.");
  if (!errorPage.includes('class="skip-link"')) throw new Error("The 500 page has no skip link.");
  if (!/noindex/.test(errorPage)) throw new Error("The 500 page is indexable.");

  // Only for browsers, only for faults this server did not author, and it must
  // fall through to JSON if the page itself cannot be read — otherwise a
  // missing file becomes a second error inside the first.
  const catchBlock = serverSource.slice(serverSource.indexOf("const authored = clientErrorStatuses.has"), serverSource.indexOf("const authored = clientErrorStatuses.has") + 1200);
  if (!catchBlock.includes("wantsHtmlDocument(request, requestUrl)")) throw new Error("A browser hitting a server fault still receives raw JSON.");
  if (!catchBlock.includes("!authored")) throw new Error("An authored client error is being replaced by the generic 500 page, hiding the real reason.");
  if (!/serveErrorDocument\(request, response, 500, "server-error\.html"\)\) return;/.test(catchBlock)) throw new Error("The 500 page does not fall through to JSON when it cannot itself be served.");
  // One implementation for both pages so they cannot drift apart.
  if (!serverSource.includes("return serveErrorDocument(request, response, 404, \"not-found.html\")")) throw new Error("The 404 and 500 pages are served by two separate implementations.");
  console.log("Server-error page tests passed: a browser fault renders a designed, scriptless page that says whether money moved, while API callers keep their JSON and an unreadable page falls through rather than failing twice.");
}

// One structured line per request, so an error has a trail to sit in.
//
// Error monitoring recorded what broke and nothing about the request that broke
// it — no method, no path, no timing, no way to correlate two events from one
// visitor. During an incident that is the difference between "something is
// throwing" and "every POST to this route has taken nine seconds since the
// deploy".
{
  const { readFile: readLogSource } = await import("node:fs/promises");
  const logSource = await readLogSource(new URL("../server.mjs", import.meta.url), "utf8");
  const logger = logSource.slice(logSource.indexOf("function logRequest"), logSource.indexOf("function logRequest") + 900);
  for (const field of ["requestId", "method", "path", "status", "durationMs"]) {
    if (!logger.includes(field)) throw new Error(`The request log omits ${field}, without which it cannot be correlated or triaged.`);
  }
  // Tokens travel in query strings across this product — tracker links,
  // opportunity links, verification links. A log is the easiest place in a
  // system to leak one and the hardest to clean up afterwards.
  for (const forbidden of ["requestUrl.search", "headers", "cookie", "authorization", "req.body"]) {
    if (logger.includes(forbidden)) throw new Error(`The request log records ${forbidden}, which can carry a credential.`);
  }
  // Recorded on finish, so the status and duration are the ones the client
  // actually received rather than the ones the first branch intended.
  if (!/response\.once\("finish"/.test(logSource)) throw new Error("The request log is written before the response completes, so its status can be wrong.");
  // A logging failure must never take a served request with it.
  if (!/logRequest[\s\S]{0,700}catch \{/.test(logSource)) throw new Error("A failure while logging would propagate into the served request.");
  // The error path carries the same id, which is the entire point.
  if (!/console\.error\(`request \$\{requestId\} failed`/.test(logSource)) throw new Error("An error and its request line cannot be put back together.");
  // On in production by default: a trail nobody switched on before the incident
  // is not a trail.
  if (!/NODE_ENV === "production"/.test(logSource.slice(logSource.indexOf("const requestLogEnabled"), logSource.indexOf("const requestLogEnabled") + 400))) {
    throw new Error("Request logging is not on by default in production.");
  }
  console.log("Request log tests passed: one structured line per request carrying id, method, path, status and duration, written on finish, never recording a query string or header, and tagged onto the error path so the two can be correlated.");
}
