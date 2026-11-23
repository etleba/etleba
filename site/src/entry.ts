import "@fontsource-variable/inter/wght.css";
import "./styles.css";

/**
 * The entry (the polish pass): the catalogue is built for desktop browsers. Below 1024 px wide,
 * or on a device with no hover and a coarse pointer (phones and tablets), the page shows a notice
 * asking for the desktop site instead, with no way past it, and never loads the 3D app. A window
 * that crosses the line later reloads into the other mode.
 */
const PHONE = "(max-width: 1023px), (hover: none) and (pointer: coarse)";
const phone = matchMedia(PHONE);

function showNotice(): void {
  document.querySelector("[data-boot-screen]")?.remove();
  delete document.body.dataset.boot;
  document.body.dataset.desktopOnly = "on";
  const notice = document.querySelector<HTMLElement>("section[data-notice]");
  if (notice) notice.hidden = false;
  document.title = "Ethan Lee Barrett — please use the desktop site";
}

const startedAsPhone = phone.matches;
if (startedAsPhone) showNotice();
else void import("./main");

phone.addEventListener("change", (e) => {
  if (e.matches !== startedAsPhone) location.reload();
});
