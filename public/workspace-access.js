const workspaceDestinations = Object.freeze({
  cleaner: "/cleaner/dashboard",
  landlord: "/landlord/dashboard"
});

const workspaceLabels = Object.freeze({
  cleaner: "Cleaner",
  landlord: "Landlord"
});

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
