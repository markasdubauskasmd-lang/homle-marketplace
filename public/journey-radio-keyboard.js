const boundGroups = new WeakSet();

export function bindJourneyRadioGroups(root = document) {
  for (const group of root.querySelectorAll('[role="radiogroup"]')) {
    if (boundGroups.has(group)) continue;
    boundGroups.add(group);
    const radios = () => [...group.querySelectorAll('[role="radio"]')]
      .filter(radio => radio.closest('[role="radiogroup"]') === group);
    const enabled = radio => !radio.disabled && radio.getAttribute("aria-disabled") !== "true";
    function synchronize() {
      const options = radios();
      const selected = options.find(radio => enabled(radio) && radio.getAttribute("aria-checked") === "true")
        || options.find(enabled);
      for (const radio of options) radio.tabIndex = radio === selected ? 0 : -1;
      return selected;
    }
    group.addEventListener("click", event => {
      const path = event.composedPath();
      if (path.find(node => node?.getAttribute?.("role") === "radiogroup") !== group) return;
      const source = path.find(node => node?.getAttribute?.("role") === "radio");
      if (!source || !enabled(source)) return;
      // Existing selection handlers may replace every option before this
      // delegated handler runs. Focus the current selected option, not a stale node.
      synchronize()?.focus();
    });
    group.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      const options = radios().filter(enabled);
      const source = event.target.closest('[role="radio"]');
      const index = options.indexOf(source);
      if (index < 0 || !options.length) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (index + direction + options.length) % options.length;
      options[nextIndex].click();
      synchronize()?.focus();
    });
    const document = group.ownerDocument;
    let focusedWithin = false;
    document.addEventListener("focusin", event => {
      focusedWithin = group.contains(event.target);
    });
    const observer = new MutationObserver(() => {
      const lostFocus = focusedWithin && document.activeElement === document.body;
      const selected = synchronize();
      // A later coverage response may redraw the property options after the
      // click has finished. Restore only focus lost from this group; never
      // take focus back after the user has moved to another control.
      if (lostFocus) selected?.focus({ preventScroll: true });
    });
    observer.observe(group, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["aria-checked", "aria-disabled", "disabled"] });
    synchronize();
  }
}
