// A room scan needs the selected service, authenticated Landlord workspace and
// in-memory booking draft that live on the guided booking page. Keeping this
// legacy entry as a redirect also guarantees that private room photographs are
// never serialized into browser storage merely to cross a page navigation.
location.replace("/landlord/book");
