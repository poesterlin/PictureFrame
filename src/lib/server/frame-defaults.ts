// Default image-rotation cadence applied at frame creation/claim time.
// Users can still adjust their frame's interval via the settings UI; these
// constants only describe the *initial* value.
export const UNCLAIMED_FRAME_REFRESH_SECONDS = 5 * 60; // 5 minutes
export const CLAIMED_FRAME_REFRESH_SECONDS = 30 * 60; // 30 minutes
