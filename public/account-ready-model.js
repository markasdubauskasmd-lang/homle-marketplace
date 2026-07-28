export function accountReadyPresentation(account, workspaceReady = false) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  const role = account?.selectedRole === "cleaner" && roles.includes("cleaner")
    ? "cleaner"
    : account?.selectedRole === "landlord" && roles.includes("landlord")
      ? "landlord"
      : "";
  if (!role) return null;

  if (workspaceReady) {
    return role === "cleaner"
      ? {
          role,
          title: "Your Cleaner profile is created.",
          copy: "Your secure Cleaner account and role are saved. Your professional profile, availability and job tools are ready in the private Cleaner workspace.",
          actionHref: "/cleaner/dashboard",
          actionLabel: "Open Cleaner dashboard"
        }
      : {
          role,
          title: "Your Landlord profile is created.",
          copy: "Your secure Landlord account and role are saved. Your properties, room scans and booking tools are ready in the private Landlord workspace.",
          actionHref: "/landlord/dashboard",
          actionLabel: "Open Landlord dashboard"
        };
  }

  return role === "cleaner"
    ? {
        role,
        title: "Your Cleaner profile is created.",
        copy: "Your secure Cleaner account and role are saved for your next sign-in. Open the private Cleaner dashboard to continue setup and review service readiness.",
        actionHref: "/cleaner/dashboard",
        actionLabel: "Open Cleaner dashboard"
      }
    : {
        role,
        title: "Your Landlord profile is created.",
        copy: "Your secure Landlord account and role are saved for your next sign-in. Open the private Landlord dashboard to continue property setup and check booking readiness.",
        actionHref: "/landlord/dashboard",
        actionLabel: "Open Landlord dashboard"
      };
}

const accountProviderLabels = Object.freeze([
  ["google", "Google"],
  ["apple", "Apple"],
  ["facebook", "Facebook"],
  ["emailPassword", "verified email"]
]);

export function availableAccountMethodLabel(providers = {}) {
  const labels = accountProviderLabels
    .filter(([key]) => providers?.[key] === true)
    .map(([, label]) => label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}
