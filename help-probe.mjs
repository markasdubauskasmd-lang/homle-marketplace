import { readFile } from "node:fs/promises";
import { launchBrowser, serveStatic } from "./tools/browser-harness.mjs";
const help = await readFile(new URL("./public/landlord-help.html", import.meta.url), "utf8");
const J=(o)=>JSON.stringify(o);
const posted=[]; let sessionCalls=0;
const server = await serveStatic({ extraFiles: {
  "/landlord/help": help,
  "/api/marketplace/account": J({ok:true,account:{roles:["landlord"],selectedRole:"landlord",displayName:"T"}}),
  "/api/marketplace/auth/session": () => { sessionCalls++; return { status:201, body:{ ok:true, csrfToken:"minted-token" } }; },
  "/api/marketplace/bookings": J({ok:true,bookings:[]}),
  "/api/marketplace/landlord/support-requests": ({method, body, headers}) => {
    if (method === "POST") { posted.push({ body: JSON.parse(body), csrf: headers["x-csrf-token"] }); return { status:201, body:{ ok:true } }; }
    return { body: { ok:true, supportRequests: posted.map((p,i)=>({ supportRequestId:"aaaaaaaa-aaaa-4aaa-8aaa-00000000000"+i, category:p.body.category, status:"open", subject:p.body.subject, description:p.body.description, createdAt:"2026-08-13T12:00:00.000Z", resolutionSummary:null, bookingChangeKind:null, proposedStartAt:null })) } };
  }
}});
const b = await launchBrowser();
await b.setViewport({ width:1440, height:900, mobile:false });
await b.goto(`${server.origin}/landlord/help`);
await b.evaluate(`const d=Date.now()+15000;for(;;){const w=document.querySelector("[data-support-workspace]");if(w&&!w.hidden)return 1;if(Date.now()>d)return 0;await new Promise(r=>setTimeout(r,100));}`);
console.log("sessionStorage empty at start:", await b.evaluate(`sessionStorage.getItem("tideway_csrf") === null`));
console.log(await b.evaluate(`
  const form=document.querySelector("[data-support-form]");
  const set=(n,v)=>{const c=form.elements[n];c.value=v;c.dispatchEvent(new Event("change",{bubbles:true}));};
  set("category","room-scan");
  set("subject","Room scan did not save last night");
  set("description","I walked through three rooms and pressed save, but the request never appeared in my dashboard afterwards.");
  form.elements.confirmNoSensitiveData.checked=true;
  document.querySelector("[data-support-submit]").click();
  const d=Date.now()+15000;
  for(;;){
    const fb=document.querySelector("[data-support-form-feedback]");
    if(fb && !fb.hidden && fb.textContent.trim()) return { feedback: fb.textContent.trim(), kind: fb.dataset.kind };
    if(Date.now()>d) return { feedback:"TIMED OUT", kind:"" };
    await new Promise(r=>setTimeout(r,150));
  }
`));
console.log("auth/session calls:", sessionCalls, "| support POSTs:", posted.length, "| csrf sent:", posted[0]?.csrf);
console.log("payload subject:", posted[0]?.body?.subject);
await b.close(); await server.close();
