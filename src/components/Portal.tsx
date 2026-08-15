import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Render children at the end of <body>, outside whatever is above them.
 *
 * `position: fixed` is normally relative to the viewport — except inside an
 * ancestor with a `transform`, `filter` or `perspective`, which becomes the
 * containing block instead. The bottom sheet is translated on every snap, so a
 * "full screen" dialog opened from inside it was being sized and positioned
 * against the sheet: clipped at the sheet's edges on a phone, while the same
 * markup on desktop — where nothing is transformed — covered the window
 * correctly.
 *
 * Portalling to <body> puts the dialog back in the viewport's coordinate space,
 * which is the only reliable way to keep `fixed` meaning fixed.
 */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mounted, setMounted] = React.useState(false);

  // Portals need a DOM target, which does not exist during the first render.
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};
