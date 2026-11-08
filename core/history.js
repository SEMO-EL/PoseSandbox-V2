// core/history.js
// Undo/redo as whole-scene snapshots (JSON strings). Snapshots are small (a few KB), so 100 of them is cheap,
// and restoring a snapshot is the same code path as loading a pose file.

export function createHistory({ capture, restore, limit = 100, onChange = () => {} }) {
  let stack = [capture()];
  let i = 0;

  return {
    /** Record the current state if it differs from the last one. */
    commit() {
      const s = capture();
      if (s === stack[i]) return false;
      stack = stack.slice(0, i + 1);
      stack.push(s);
      if (stack.length > limit) stack.shift();
      i = stack.length - 1;
      onChange();
      return true;
    },
    undo() {
      if (i <= 0) return false;
      restore(stack[--i]);
      onChange();
      return true;
    },
    redo() {
      if (i >= stack.length - 1) return false;
      restore(stack[++i]);
      onChange();
      return true;
    },
    canUndo: () => i > 0,
    canRedo: () => i < stack.length - 1
  };
}
