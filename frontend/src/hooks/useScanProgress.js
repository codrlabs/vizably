import { useEffect, useState } from 'react'
import {
  SCAN_PROGRESS_INTERVAL_MS,
  SCAN_PROGRESS_STAGES,
} from '../data/scanProgress'

/**
 * Cycles through scan progress stage messages while `active` is true.
 * Holds on the last stage until deactivated (no backend progress stream).
 *
 * @param {boolean} active
 * @returns {string}
 */
export function useScanProgress(active) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      return undefined
    }

    setIndex(0)
    const id = setInterval(() => {
      setIndex((current) => Math.min(current + 1, SCAN_PROGRESS_STAGES.length - 1))
    }, SCAN_PROGRESS_INTERVAL_MS)

    return () => clearInterval(id)
  }, [active])

  return SCAN_PROGRESS_STAGES[index] ?? SCAN_PROGRESS_STAGES[0]
}
