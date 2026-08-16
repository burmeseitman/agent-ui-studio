import { isDesktop } from './daemon';

/**
 * Marks the document with the running platform so CSS can adapt.
 *
 * The macOS desktop window uses an overlay title bar, which means the traffic
 * lights float over the app's own header. Without an inset the buttons would sit
 * on top of the brand mark.
 */
export function applyPlatformClasses(): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const desktop = isDesktop();

  root.classList.toggle('is-desktop', desktop);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  root.classList.toggle('is-macos-desktop', desktop && isMac);
}

/** True when the window chrome is drawn by the app rather than the OS. */
export function hasOverlayTitlebar(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('is-macos-desktop')
  );
}
