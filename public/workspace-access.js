const workspaceDestinations = Object.freeze({
  cleaner: "/cleaner/dashboard",
  landlord: "/landlord/dashboard"
});

const workspaceLabels = Object.freeze({
  cleaner: "Cleaner",
  landlord: "Landlord"
});

export function accountIntentWorkspaceRole(intent = "") {
  if (intent === "work") return "cleaner";
  if (intent === "book") return "landlord";
  return "";
}

export function accountIntentWorkspaceActivation(account, intent = "") {
  const intendedRole = accountIntentWorkspaceRole(intent);
  if (!intendedRole) return "";
  const roles = Array.isArray(account?.roles) ? account.roles.filter((role) => workspaceDestinations[role]) : [];
  return roles.includes(intendedRole) && account?.selectedRole !== intendedRole ? intendedRole : "";
}

export function accountWorkspaceDestination(account, intent = "", workspaceReady = true) {
  const roles = Array.isArray(account?.roles) ? account.roles.filter((role) => workspaceDestinations[role]) : [];
  let destination = "";
  if (intent === "book") destination = roles.includes("landlord") ? "/landlord/book" : "";
  else if (intent === "work") destination = roles.includes("cleaner") ? workspaceDestinations.cleaner : "";
  else if (roles.includes(account?.selectedRole)) destination = workspaceDestinations[account.selectedRole] || "";
  return destination && !workspaceReady ? "/account-ready" : destination;
}

export function dashboardWorkspaceAccess(account, expectedRole) {
  if (!workspaceDestinations[expectedRole]) throw new TypeError("A supported dashboard role is required.");
  const roles = Array.isArray(account?.roles) ? account.roles.filter((role) => workspaceDestinations[role]) : [];
  const selectedRole = workspaceDestinations[account?.selectedRole] ? account.selectedRole : "";
  if (!roles.includes(expectedRole)) {
    return Object.freeze({ ready: false, reason: "role-missing", selectedRole, destination: selectedRole ? workspaceDestinations[selectedRole] : "", label: selectedRole ? workspaceLabels[selectedRole] : "" });
  }
  if (selectedRole !== expectedRole) {
    return Object.freeze({ ready: false, reason: "different-workspace", selectedRole, destination: workspaceDestinations[selectedRole] || "", label: workspaceLabels[selectedRole] || "" });
  }
  return Object.freeze({ ready: true, reason: "ready", selectedRole, destination: workspaceDestinations[expectedRole], label: workspaceLabels[expectedRole] });
}
