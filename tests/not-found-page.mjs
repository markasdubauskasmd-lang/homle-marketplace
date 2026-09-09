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
