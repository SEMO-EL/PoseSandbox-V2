// gallery/gallery.js
// Saved poses in localStorage: a WebP thumbnail plus the full pose document. Exports/imports as one JSON file.

import { niceTime } from "../core/helpers.js";

export class Gallery {
  constructor({ key = "pose_sandbox_gallery_v1", max = 60, containerEl, onOpen, toast }) {
    this.key = key;
    this.max = max;
    this.el = containerEl;
    this.onOpen = onOpen;
    this.toast = toast || (() => {});
    this.items = [];
    this.selectedId = null;
  }

  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.key) || "[]");
      this.items = Array.isArray(parsed) ? parsed.filter((it) => it?.id && it.pose && it.thumb).slice(0, this.max) : [];
    } catch {
      this.items = [];
    }
    this.render();
  }

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.items));
      return true;
    } catch {
      this.toast("Gallery is full — export it, then delete some poses", 3200);
      return false;
    }
  }

  add({ pose, thumb, name, notes = "" }) {
    const item = { id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, name: (name || "").trim() || `Pose ${this.items.length + 1}`, createdAt: new Date().toISOString(), notes, pose, thumb };
    this.items.unshift(item);
    this.items.length = Math.min(this.items.length, this.max);
    this.selectedId = item.id;
    if (!this.save()) { this.items.shift(); return null; }
    this.render();
    return item;
  }

  selected() {
    return this.items.find((x) => x.id === this.selectedId) || null;
  }

  rename() {
    const it = this.selected();
    if (!it) return this.toast("Select a saved pose first");
    const next = prompt("Rename pose:", it.name);
    if (next === null) return;
    it.name = next.trim() || it.name;
    this.save();
    this.render();
  }

  remove() {
    const it = this.selected();
    if (!it) return this.toast("Select a saved pose first");
    if (!confirm(`Delete “${it.name}” from the gallery?`)) return;
    this.items = this.items.filter((x) => x !== it);
    this.selectedId = null;
    this.save();
    this.render();
  }

  clear() {
    if (!this.items.length) return this.toast("The gallery is already empty");
    if (!confirm(`Delete all ${this.items.length} saved poses? Export them first if you want a backup.`)) return;
    this.items = [];
    this.selectedId = null;
    this.save();
    this.render();
  }

  exportBlob() {
    const data = { app: "PoseSandbox", kind: "gallery", version: 2, items: this.items.map(({ name, createdAt, notes, pose, thumb }) => ({ name, createdAt, notes, pose, thumb })) };
    return new Blob([JSON.stringify(data)], { type: "application/json" });
  }

  render() {
    if (!this.el) return;
    this.el.replaceChildren();
    if (!this.items.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "No saved poses yet. Save one with Ctrl+S.";
      this.el.append(p);
      return;
    }
    for (const it of this.items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile" + (it.id === this.selectedId ? " is-active" : "");
      b.setAttribute("aria-pressed", String(it.id === this.selectedId));
      b.title = `Load “${it.name}”`;
      const img = document.createElement("img");
      img.src = it.thumb;
      img.alt = "";
      img.loading = "lazy";
      const name = document.createElement("span");
      name.className = "tile__name";
      name.textContent = it.name;
      const time = document.createElement("span");
      time.className = "tile__meta";
      time.textContent = niceTime(it.createdAt);
      b.append(img, name, time);
      b.addEventListener("click", () => {
        this.selectedId = it.id;
        this.render();
        this.onOpen?.(it);
      });
      this.el.append(b);
    }
  }
}
