"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Route transition.
 *
 * A short fade with a small upward drift and a subtle blur lift. The blur is
 * what makes it read as a deliberate page change rather than a flicker; it is
 * expensive enough that it is dropped entirely for reduced motion.
 *
 * `mode="wait"` is deliberately not used — it delays the incoming page until
 * the outgoing one finishes, which feels slower than overlapping them.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className="flex-1 flex flex-col">{children}</div>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 flex flex-col"
    >
      {children}
    </motion.div>
  );
}