"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Fade/slide-in for page content. Used by app/(app)/template.tsx, which
 * remounts on every navigation so each page animates in.
 */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
