# Room scanner optimisation

## Outcome

The existing scanner remains the single scanner used by the Landlord booking journey. The work in this change improves speed, correction, feedback and failure recovery without replacing its backend, privacy boundary, room-reading API, media flow or speech-summary integration.

## What was already working

- A real rear-camera flow with a native phone-camera fallback.
- Local, on-device multi-object detection.
- Manual marking for objects the detector does not recognise.
- Multiple selected objects per room.
- Room switching, custom room names, re-scanning and room removal.
- Voice notes with an editable typed fallback.
- Local video-frame extraction without uploading raw video or its audio.
- Low-light, glare and camera-movement guidance.
- Reviewable room objects, notes and cleaner tasks.
- In-session room saving and short-lived note recovery.
- Consent before a home photograph is sent for automatic reading.

## Improvements made

### Faster and more responsive

- The camera now asks for a practical 720p/24fps stream, with bounded higher-resolution fallbacks, rather than requiring full HD immediately.
- Detection work is scheduled against newly presented video frames with `requestVideoFrameCallback()` where the browser supports it. Older browsers retain the animation-frame fallback.
- Existing adaptive detection throttling remains in place, so slower phones do less work rather than freezing the viewfinder.
- Automatic walking reads no longer depend on WebGL or the optional local object-glow model. If that model is loading or unavailable, a lightweight quality/signature pass still selects bounded settled views for assisted room reading.
- A slow assisted read from the room just left no longer blocks automatic reading in the next room. Walking reads are isolated per room and capped at two in flight overall, keeping room changes responsive without creating an unbounded network or provider workload.
- Hidden/backgrounded scans still release the camera, microphone and detector.

### More accurate and easier to correct

- Heavy, same-class overlapping detections are de-duplicated before tracking. The highest-confidence box is kept.
- Nearby objects and overlapping objects of different classes are not collapsed.
- Detection boxes are real accessible buttons. They can be selected or removed with one tap or keyboard action and expose their selected state to assistive technology.
- The existing manual mark, remove, re-scan and room-switch paths remain available.

### Clearer progress

- The scanner now shows a compact three-step state:
  1. Choose a room.
  2. Capture the room.
  3. Check the selected objects and confirm.
- The room hub reports how many rooms are ready and keeps “finish” and “add another” as the only next decisions.
- A room whose automatic reading timed out is labelled clearly and can be tapped to retry.
- A successful room save continues to show a short confirmation and suggests an unscanned common room.

### Better failure recovery

- Automatic room reading has a bounded timeout. A slow provider no longer leaves the scanner spinning indefinitely.
- A phone that is explicitly offline keeps object detection on-device and does not consume any of the room's four assisted-reading slots. A confirmed room remains in the open scan and its assisted reading resumes automatically after reconnection.
- A timed-out or temporarily failed read keeps the captured image, chosen objects and spoken instructions.
- Spoken notes are converted locally into room-labelled task bullets when assisted reading is unavailable.
- A captured room photo is always handed to the authenticated booking journey, even if automatic analysis produces no tasks. Previously, such a photo could be silently omitted.
- A service-level “automatic reading unavailable” response falls back cleanly instead of blocking the room.

## Research used

- MDN recommends `requestVideoFrameCallback()` for per-video-frame processing because it runs when a new video frame is presented: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback>
- Camera constraints use `ideal` and bounded `max` values so the browser can choose an efficient supported mode: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>
- Background processing follows the Page Visibility API lifecycle: <https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>
- Speech recognition remains progressive enhancement because Web Speech support varies by browser; the editable typed path remains mandatory: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API>

## Privacy and platform limitations

- Confirmed rooms are automatically saved in memory during the scan. Room notes have short-lived recovery.
- Home photographs intentionally are not written to `localStorage` or `sessionStorage`. Persisting them through a browser crash before the authenticated private draft exists would create a privacy risk. Once the booking journey creates its private draft, the existing secure upload flow takes over.
- Browser camera and microphone access requires HTTPS (or localhost) and user permission.
- Mobile browsers may suspend camera, speech and JavaScript when backgrounded. The scanner releases hardware and safely reacquires it when possible, but continuous background scanning is not a reliable web capability.
- Speech recognition availability varies by browser. Users always have a one-tap typed note fallback.

## Verification completed

- Full project syntax and policy check: passed.
- Full project test suite, including post-test deployment and security checks: passed.
- Scanner detection, UI, note recovery, media selection, room vision, speech summary and Landlord journey tests: passed.
- Desktop visual check: room hub, progress indicator and room selection.
- Mobile visual check at 390 × 844: no horizontal overflow; room hub, camera-permission fallback, room switching and note editing remained usable.
- Camera-denied check: phone photo, short video, retry-camera and typed-note routes remained visible and actionable.
