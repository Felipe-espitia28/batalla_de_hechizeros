import { useEffect, useState } from "react";

/**
 * Re-renderiza cada `intervalMs` para que cuenten los cooldowns y el reloj entre dos
 * match:state. 100 ms basta para el ojo y no castiga el render mientras MediaPipe trabaja.
 */
export function useNow(getNow: () => number, active: boolean, intervalMs = 100): number {
  const [now, setNow] = useState(getNow);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(getNow()), intervalMs);
    return () => clearInterval(id);
  }, [getNow, active, intervalMs]);
  return active ? now : getNow();
}
