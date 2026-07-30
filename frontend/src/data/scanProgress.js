/** Staged copy shown while a scan request is in flight (issue #75). */
export const SCAN_PROGRESS_STAGES = [
  'Connecting to the target website…',
  'Retrieving page content…',
  'Analyzing accessibility…',
  'Detecting issues…',
  'Calculating accessibility score…',
  'Preparing results…',
  'Finalizing the report…',
]

/** How long each stage stays visible before advancing (ms). */
export const SCAN_PROGRESS_INTERVAL_MS = 1800
