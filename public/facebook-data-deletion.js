const summary = document.querySelector("#deletion-summary");
const status = document.querySelector("#deletion-status");

function show(message, detail) {
  summary.textContent = message;
  status.textContent = detail;
}

async function loadStatus() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const code = parameters.get("code") || "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) {
    show("This confirmation link is incomplete.", "Use the full status link supplied after removing Homle from Facebook.");
    return;
  }
  try {
    const response = await fetch("/api/marketplace/auth/facebook/data-deletion/status", {
      headers: { Accept: "application/json", "X-Homle-Deletion-Code": code },
      cache: "no-store"
    });
    const body = await response.json();
    // Tagged so the catch can tell this apart from a transport or JSON-parse failure.
    // Only a message the server actually wrote is safe to put in front of a person.
    if (!response.ok) throw Object.assign(new Error(body.error || "The request status is unavailable."), { fromServer: true });
    const messages = {
      requested: ["Your deletion request has been received.", "Homle will process the account data connected to this Facebook sign-in."],
      verifying: ["Your deletion request is being verified.", "No action is needed while Homle completes the security checks."],
      processing: ["Your deletion request is being processed.", "Homle is removing the account data covered by this request."],
      completed: ["Your deletion request is complete.", "Homle has no remaining account data covered by this Facebook request."],
      rejected: ["This request needs support review.", "Please use the contact details in the privacy notice and keep this confirmation link private."]
    };
    show(...(messages[body.status] || ["The request status is unavailable.", "Please try again later."]));
  } catch (error) {
    // The bare catch this replaces reported every failure as a connection problem,
    // including a request the server had deliberately rejected — so someone told their
    // deletion needed support review was instead told to check their internet.
    //
    // Only `fromServer` messages are shown. `response.json()` and `fetch` both throw here
    // too, and their messages are browser text ("Unexpected token '<'", "Failed to
    // fetch") — accurate, useless to a person, and not ours to put on the page.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) show("You are offline.", "Reconnect and reopen the private confirmation link.");
    else if (error?.fromServer) show(error.message, "Reopen the private confirmation link, or try again shortly.");
    else show("We could not check the request yet.", "Check your connection and reopen the private confirmation link.");
  }
}

loadStatus();
