// core/helpers.js
// Small shared helpers (no three.js).

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function niceTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** True while the user is typing in a field — keyboard shortcuts must not fire then. */
export function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  return !["checkbox", "radio", "range", "button", "submit", "color", "file"].includes(el.type);
}

/** "posesandbox-20261108-1742" */
export function stamp(prefix = "posesandbox") {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function makeToast(toastEl) {
  let t = 0;
  return function toast(msg, ms = 1600) {
    if (!toastEl) return;
    toastEl.textContent = String(msg ?? "");
    toastEl.classList.add("show");
    clearTimeout(t);
    t = setTimeout(() => toastEl.classList.remove("show"), ms);
  };
}
