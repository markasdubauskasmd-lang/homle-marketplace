/*
 * What the workspace shell should contain, decided without a DOM.
 *
 * The chrome used to be static markup copied into each page, which is how
 * /cleaner/payouts came to state "Cleaner" and offer Cleaner destinations to a
 * signed-in Landlord: nothing in that header was ever asked who was reading it.
 * Deciding it here, from the account, makes that class of bug impossible and
 * makes the decision testable without a browser.
 */

const destinations = Object.freeze({
  landlord: Object.freeze([
    Object.freeze({ key: "home", label: "Home", href: "/landlord/home", icon: "home" }),
    Object.freeze({ key: "bookings", label: "Bookings", href: "/landlord/bookings", icon: "calendar" }),
    Object.freeze({ key: "messages", label: "Messages", href: "/landlord/messages", icon: "message" }),
    Object.freeze({ key: "account", label: "Account", href: "/landlord/account", icon: "person" })
  ]),
  cleaner: Object.freeze([
    Object.freeze({ key: "home", label: "Jobs", href: "/cleaner/dashboard", icon: "home" }),
    Object.freeze({ key: "schedule", label: "Schedule", href: "/cleaner/schedule", icon: "calendar" }),
    Object.freeze({ key: "messages", label: "Messages", href: "/cleaner/messages", icon: "message" }),
    Object.freeze({ key: "account", label: "Account", href: "/cleaner/settings", icon: "person" })
  ])
});

/*
 * The phone tab bar is NOT the sidebar list.
 *
 * The approved composition gives a phone six controls — Places and a raised
 * scan action either side of the four the sidebar carries — because a phone has
 * no sidebar to reach them from. A shared shell that rendered only the four
 * would change the shape of the bar as a Landlord moved from the dashboard to
 * their own Updates, which is the drift this whole exercise is undoing.
 */
const phoneDestinations = Object.freeze({
  landlord: Object.freeze([
    Object.freeze({ key: "home", label: "Home", href: "/landlord/home", icon: "home" }),
    Object.freeze({ key: "places", label: "Places", href: "/landlord/bookings#your-places", icon: "place" }),
    Object.freeze({ key: "scan", label: "Start a room scan", href: "/landlord/book", icon: "scan", action: true }),
    Object.freeze({ key: "bookings", label: "Bookings", href: "/landlord/bookings", icon: "calendar" }),
    Object.freeze({ key: "messages", label: "Messages", href: "/landlord/messages", icon: "message" }),
    Object.freeze({ key: "account", label: "Account", href: "/landlord/account", icon: "person" })
  ]),
  cleaner: Object.freeze([])
});

const labels = Object.freeze({ landlord: "Landlord", cleaner: "Cleaner" });

/**
 * The role this account may actually open a workspace as.
 *
 * Both conditions matter. `selectedRole` alone is a preference the account may
 * no longer be entitled to; `roles` alone does not say which workspace the
 * account chose. The dashboards already require both, and the shell has to
 * agree with them or it will offer a destination that then refuses the visitor.
 */
export function workspaceRole(account) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  const selected = account?.selectedRole;
  return (selected === "landlord" || selected === "cleaner") && roles.includes(selected) ? selected : "";
}

/**
 * The whole shell, as data.
 *
 * `active` is the key of the destination the current page belongs to, or "" for
 * a page that is not one of them — Updates and Settings are both reached from
 * Account, so they mark Account as current rather than leaving the bar blank.
 */
export function workspaceShell(account, options = {}) {
  const role = workspaceRole(account);
  const active = String(options.active || "");
  const items = (destinations[role] || []).map((item) => Object.freeze({ ...item, current: item.key === active }));
  const phone = (phoneDestinations[role] || []).map((item) => Object.freeze({ ...item, current: item.key === active }));
  return Object.freeze({
    role,
    label: labels[role] || "Account",
    /* Falls back to the sidebar list, so a role with no phone composition of its
       own still gets navigation rather than none. */
    phoneNavigation: Object.freeze(phone.length ? phone : items),
    /* A visitor with no usable role has nowhere to be sent but back through
       onboarding, which is where the account menu already sends them. */
    home: role ? destinations[role][0].href : "/onboarding",
    signOutDestination: role === "cleaner" ? "/login?intent=work" : "/login?intent=book",
    navigation: Object.freeze(items),
    /* Cleaners have their own inbox at /cleaner/notifications; only the
       Landlord shell links the shared one. */
    notificationsHref: role === "cleaner" ? "/cleaner/notifications" : "/notifications",
    showNavigation: items.length > 0
  });
}

/**
 * Unread counts are shown, not announced as numbers without bound: a three-digit
 * badge breaks the pill and tells the reader nothing "99+" would not.
 */
export function unreadBadge(count) {
  const value = Number.isSafeInteger(count) && count > 0 ? count : 0;
  if (!value) return Object.freeze({ visible: false, text: "", label: "" });
  return Object.freeze({
    visible: true,
    text: value > 99 ? "99+" : String(value),
    label: value === 1 ? "1 unread update" : `${value > 99 ? "More than 99" : value} unread updates`
  });
}
