// Only the customer room scanner imports this lifecycle helper.
export function containScannerFocus(overlay, currentLayer) {
  const doc = overlay.ownerDocument;
  const outside = new Map();
  const fallbackTabs = new Map();
  const lockOutside = () => {
    for (const child of doc.body.children) {
      if (child === overlay || outside.has(child)) continue;
      outside.set(child, child.getAttribute("inert"));
      child.inert = true;
    }
  };
  const layer = () => currentLayer() || overlay;
  const visible = element => !element.closest("[hidden], [inert]")
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility === "visible";
  const controls = root => [...root.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.disabled
      && element.getAttribute("aria-disabled") !== "true" && visible(element));
  const focusFirst = root => {
    const first = controls(root)[0];
    if (first) first.focus({ preventScroll: true });
    else {
      if (!fallbackTabs.has(root)) fallbackTabs.set(root, root.getAttribute("tabindex"));
      root.tabIndex = -1;
      root.focus({ preventScroll: true });
    }
  };
  const keepFocus = () => {
    const root = layer();
    if (!overlay.isConnected || !visible(root)) return;
    const active = doc.activeElement;
    if (!root.contains(active) || active?.disabled || !visible(active)) focusFirst(root);
  };
  const onFocus = () => keepFocus();
  const onKey = event => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const root = layer(), options = controls(root), active = doc.activeElement;
    if (!options.length) { event.preventDefault(); focusFirst(root); return; }
    const index = options.indexOf(active);
    if (index < 0 || (event.shiftKey ? index === 0 : index === options.length - 1)) {
      event.preventDefault();
      options[event.shiftKey ? options.length - 1 : 0].focus({ preventScroll: true });
    }
  };
  lockOutside();
  const bodyObserver = new MutationObserver(lockOutside);
  bodyObserver.observe(doc.body, { childList: true });
  const layerObserver = new MutationObserver(keepFocus);
  layerObserver.observe(overlay, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "inert", "disabled"] });
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("focusin", onFocus, true);
  return () => {
    bodyObserver.disconnect();
    layerObserver.disconnect();
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("focusin", onFocus, true);
    for (const [element, value] of [...outside, ...fallbackTabs]) {
      const attribute = outside.has(element) ? "inert" : "tabindex";
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    }
  };
}
