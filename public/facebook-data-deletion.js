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
    if (!response.ok) throw new Error(body.error || "The request status is unavailable.");
    const messages = {
      requested: ["Your deletion request has been received.", "Homle will process the account data connected to this Facebook sign-in."],
      verifying: ["Your deletion request is being verified.", "No action is needed while Homle completes the security checks."],
      processing: ["Your deletion request is being processed.", "Homle is removing the account data covered by this request."],
      completed: ["Your deletion request is complete.", "Homle has no remaining account data covered by this Facebook request."],
      rejected: ["This request needs support review.", "Please use the contact details in the privacy notice and keep this confirmation link private."]
    };
    show(...(messages[body.status] || ["The request status is unavailable.", "Please try again later."]));
  } catch {
    show("We could not check the request yet.", "Check your connection and reopen the private confirmation link.");
  }
}

loadStatus();
