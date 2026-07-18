function initials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || "H").toUpperCase();
}

function securePhoto(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}

export function renderAccountAvatar(account, preferredPhotoUrl = "") {
  const name = String(account?.displayName || "Homle account").trim();
  const photo = securePhoto(preferredPhotoUrl) || securePhoto(account?.avatarUrl);
  for (const node of document.querySelectorAll("[data-account-name]")) node.textContent = name;
  for (const node of document.querySelectorAll("[data-account-email]")) node.textContent = String(account?.email || "");
  for (const menu of document.querySelectorAll("[data-account-menu]")) menu.hidden = false;
  for (const node of document.querySelectorAll("[data-account-avatar]")) {
    node.replaceChildren();
    if (photo) {
      const image = document.createElement("img");
      image.src = photo;
      image.alt = "";
      image.width = 40;
      image.height = 40;
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { node.replaceChildren(document.createTextNode(initials(name))); }, { once: true });
      node.append(image);
    } else node.textContent = initials(name);
  }
}
