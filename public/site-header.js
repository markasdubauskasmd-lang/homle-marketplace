// Opens and closes the shared site header's menu on narrow screens. The menu
// is a plain list of links that is always present for screen readers and
// wide screens; this only toggles it on small ones.
const header = document.querySelector("[data-site-header]");
const toggle = header?.querySelector("[data-site-nav-toggle]");

function setOpen(open) {
  header.dataset.open = String(open);
  toggle.setAttribute("aria-expanded", String(open));
}

if (header && toggle) {
  toggle.addEventListener("click", () => setOpen(header.dataset.open !== "true"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header.dataset.open === "true") { setOpen(false); toggle.focus(); }
  });
}
