// controls/practice.js
// Gesture practice: a new pose every N seconds with a countdown, the way life-drawing warm-ups run.
// This file is the clock and its controls. What a "next pose" is, and putting the scene back afterwards, is the
// app's business: it passes begin(options), show(n) for the n-th pose (going back shows the same pose again) and finish().

const fmt = (s) => { const t = Math.ceil(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

export function createPractice({ $, dialog, overlay, begin, show, finish, toast }) {
  let run = null; // { seconds, total, i, left, paused, sound, timer, started }
  let audio = null;

  function chime() {
    if (!run?.sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      for (const [f, at] of [[660, 0], [880, 0.11]]) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.06, t + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
        o.connect(g).connect(audio.destination);
        o.start(t + at);
        o.stop(t + at + 0.25);
      }
    } catch { /* no sound is fine */ }
  }

  function paint() {
    const frac = Math.max(0, run.left / run.seconds);
    $("prTime").textContent = fmt(Math.max(0, run.left));
    $("prRing").style.strokeDashoffset = String(100 * (1 - frac));
    $("prCount").textContent = run.total ? `${run.i} / ${run.total}` : `Pose ${run.i}`;
    $("prPause").setAttribute("aria-pressed", String(run.paused));
    $("prPause").title = run.paused ? "Resume (Space)" : "Pause (Space)";
    overlay.classList.toggle("is-paused", run.paused);
    overlay.classList.toggle("is-ending", !run.paused && run.left <= 5);
  }

  function step(dir) {
    if (dir > 0 && run.total && run.i >= run.total) return stop(true);
    run.i = Math.max(1, run.i + dir);
    run.left = run.seconds;
    show(run.i);
    chime();
    paint();
  }

  function tick() {
    const now = performance.now();
    if (!run.paused) run.left -= (now - run.last) / 1000;
    run.last = now;
    if (run.left <= 0) step(1);
    else paint();
  }

  function start(o) {
    begin(o);
    run = { ...o, i: 0, left: 0, paused: false, last: performance.now(), started: Date.now() };
    document.body.classList.add("is-practice");
    overlay.hidden = false;
    step(1);
    run.timer = setInterval(tick, 200);
  }

  function stop(done = false) {
    if (!run) return;
    clearInterval(run.timer);
    const n = run.i, mins = Math.max(1, Math.round((Date.now() - run.started) / 60000));
    run = null;
    document.body.classList.remove("is-practice");
    overlay.hidden = true;
    finish();
    toast(done ? `Practice done — ${n} poses in about ${mins} min` : "Practice ended — your scene is back", 2600);
  }

  $("btnPractice").addEventListener("click", () => dialog.showModal());
  $("btnPracticeStart").addEventListener("click", () => {
    const f = dialog.querySelector("form");
    dialog.close();
    start({ seconds: Number(f.seconds.value), total: Number(f.count.value), source: f.source.value, angles: f.angles.checked, sound: f.sound.checked });
  });
  $("prPause").addEventListener("click", () => { run.paused = !run.paused; paint(); });
  $("prNext").addEventListener("click", () => step(1));
  $("prPrev").addEventListener("click", () => step(-1));
  $("prExit").addEventListener("click", () => stop(false));

  return {
    active: () => !!run,
    /** Keys while practising. Returns true when the key was used. */
    key(k) {
      if (!run) return false;
      if (k === " ") { run.paused = !run.paused; paint(); }
      else if (k === "arrowright") step(1);
      else if (k === "arrowleft") step(-1);
      else if (k === "escape") stop(false);
      else return false;
      return true;
    }
  };
}
