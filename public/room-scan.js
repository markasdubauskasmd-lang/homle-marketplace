import { openRoomScan } from "./room-scan-overlay.js";

// The scan lives inside the booking journey as an overlay. This route exists so
// a direct link or a bookmark still works: it opens the same overlay and hands
// the result to the journey, rather than being a second implementation that
// could drift away from the embedded one.
const result = await openRoomScan();

if (result) {
  try { sessionStorage.setItem("homle_scan_result", JSON.stringify(result)); } catch {}
}
location.replace("/landlord/book");
