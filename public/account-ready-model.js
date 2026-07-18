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
        copy: "Your secure Cleaner account and role are saved for your next sign-in. Professional profile tools will open after Homle's private booking services pass staging. Today, you can submit or update a separate Cleaner pilot application.",
        actionHref: "/join",
        actionLabel: "Apply for the Cleaner pilot"
      }
    : {
        role,
        title: "Your Landlord profile is created.",
        copy: "Your secure Landlord account and role are saved for your next sign-in. Property and booking tools will open after Homle's private booking services pass staging. Today, you can prepare a separate private-pilot cleaning request and room scan.",
        actionHref: "/request",
        actionLabel: "Prepare a cleaning request"
      };
}
