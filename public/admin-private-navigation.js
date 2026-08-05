const privateNavigation = document.querySelector("[data-admin-private-navigation]");
const privateWorkspace = document.querySelector("[data-admin-private-workspace]");

if (privateNavigation && privateWorkspace) {
  const syncPrivateNavigation = () => {
    // Each page controller owns the server-backed Administrator gate. The
    // header only mirrors that already-authoritative workspace state.
    privateNavigation.hidden = privateWorkspace.hidden;
  };

  syncPrivateNavigation();
  new MutationObserver(syncPrivateNavigation).observe(privateWorkspace, {
    attributes: true,
    attributeFilter: ["hidden"]
  });
}
