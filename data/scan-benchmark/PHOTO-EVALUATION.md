# Room photo evaluation

This diagnostic runs local, labelled JPEG/PNG/WebP photos through the production whole-room reader. It records the model, image SHA-256, source SHA-256 values, per-call time and readings, and scores object precision, recall, duplicates and condition agreement with the existing benchmark.

It does not run the phone camera, local detector, keyframe chooser, selected-item confirmation, tracking, walkthrough UI or payment flow. It cannot establish complete scanner accuracy or phone latency. No production code or configuration changes are needed.

## Private input folder

Keep photos, consent records, human labels and output outside the repository. Create:
- images/
- labels/manifest.json
- runs/

A manifest starts as `{"version":1,"mediaRoot":"../images","cases":[]}`. An empty manifest intentionally fails preflight. Add one case for each photo:

```json
{
  "caseId": "unique-case-id",
  "synthetic": false,
  "image": "kitchen-01.jpg",
  "roomName": "Kitchen",
  "purpose": "walking",
  "deviceClass": "actual-phone-model",
  "lighting": "daylight",
  "propertyType": "flat",
  "consent": {
    "recordedAt": "actual ISO date of permission",
    "reference": "reference to the actual permission record"
  },
  "truth": {
    "labelledBy": "actual human labeller",
    "rooms": [{
      "roomName": "Kitchen",
      "objects": [
        {"inventoryKey": "chair", "quantity": 2, "condition": "light"}
      ]
    }]
  }
}
```

This is a format example, not a labelled room or consent record. Never copy invented labels into a real case. Label only visible objects in that photo. Include clean items as well as dirty items. Use the scanner inventory keys; spelling matters to the scorer. Use quantity for multiple physical objects of one identity. Leave condition blank or unknown when the relevant surface cannot be judged. Do not infer dirt from object identity. Optional transcript must contain only the scan's actual user speech, never the answer labels.

Use purpose walking or confirmation to test the production model tiers separately. Each case makes one whole-room read; confirmation here does not simulate selected-item confirmation. Use an empty objects array for a genuinely empty frame. Images must be below 4 MiB and resolve inside mediaRoot. Real cases require actual consent and human labels. Synthetic cases must be marked true and cannot establish real accuracy.

## Run

From the repository:
```sh
node tools/evaluate-room-photos.mjs /private/labels/manifest.json /private/runs/run-001
```

This only validates inputs and prints the number of planned calls. It does not use a provider key or make network requests.

Configure ANTHROPIC_API_KEY in the environment, then add `--run` to execute. Runtime ROOM_VISION_MODEL and ROOM_VISION_CONFIRMATION_MODEL overrides are honoured and the actual selected model is recorded. Each photo may incur a provider charge; SDK retries are included in measured time. OUTPUT_DIRECTORY must be new and its parent must exist.

Each completed attempt is checkpointed to a numbered JSON file. report.json includes scorer-compatible cases, readings, failures and timing; run.json records start and source fingerprints. A failed reader call is recorded without its potentially sensitive error text and scored as an empty observed room. It cannot disappear from the denominator. Disk-write failures stop the run. Do not blindly rerun after a partial failure: checkpointed calls may already have incurred charges.

Results can contain private room descriptions and consent references. Keep the entire runs folder private. Images, image paths, transcripts and credentials are not copied into the report. Withdraw a case by its consent reference and remove its private inputs and derived run records.

Timing measures successful server-reader calls, not browser/device performance. Test-stub timings have no performance meaning. validationComplete remains false because this single-photo diagnostic cannot establish end-to-end validation.

## Offline regression

```sh
node tests/photo-evaluation.mjs
```

Uses the actual production adapter with a fake provider transport and a one-pixel synthetic fixture. Tests validation, tier selection, confidence separation, duplicate scoring, failed reads and checkpoint errors. No provider calls or real accuracy claims.

Successful reads also copy elapsedMs into the scorer-compatible case processingTimeMs before checkpointing. Benchmark timing therefore measures this server-reader diagnostic, not the phone model named by deviceClass. Failed reads retain their attempt duration in reads but use null for successful-result timing; they remain in accuracy denominators and missing timing counts. Do not compare these results with browser end-to-end latency without accounting for the different scope.
