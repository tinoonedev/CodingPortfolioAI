export function createPasswordVerificationGate(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('The password verification limit must be a positive integer.');

  let active = 0;
  return {
    tryAcquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}
