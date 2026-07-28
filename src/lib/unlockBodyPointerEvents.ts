/** Clear leftover body scroll/pointer locks from Radix Dropdown+Dialog stacking. */
export function unlockBodyPointerEvents() {
  if (typeof document === 'undefined') return;
  const body = document.body;
  body.style.removeProperty('pointer-events');
  // Radix / react-remove-scroll leftovers
  body.removeAttribute('data-scroll-locked');
  if (body.style.overflow === 'hidden') {
    body.style.removeProperty('overflow');
  }
  // Some versions leave the lock on <html>
  document.documentElement.style.removeProperty('pointer-events');
}
