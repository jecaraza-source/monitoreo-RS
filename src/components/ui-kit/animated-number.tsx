"use client";

import { useEffect, useMemo } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

/**
 * Counts up to `value`. Formatting is passed as Intl options (not a function)
 * so Server Components can render it. Screen readers get the final value.
 */
export function AnimatedNumber({
  value,
  formatOptions,
  duration = 0.9,
  className,
}: {
  value: number;
  formatOptions?: Intl.NumberFormatOptions;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const formatter = useMemo(() => new Intl.NumberFormat("es-MX", formatOptions), [formatOptions]);
  const motionValue = useMotionValue(reduce ? value : 0);
  const text = useTransform(motionValue, (v) => formatter.format(v));

  useEffect(() => {
    if (reduce) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [value, duration, reduce, motionValue]);

  return (
    <span className={className}>
      <motion.span aria-hidden className="tabular-nums">
        {text}
      </motion.span>
      <span className="sr-only">{formatter.format(value)}</span>
    </span>
  );
}
