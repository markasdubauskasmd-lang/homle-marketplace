// Same-origin worker using the same vendored model as the page detector.
let model;
self.onmessage = async ({ data: message }) => {
  try {
    if (message.type === "load") {
      if (!await self.navigator.gpu?.requestAdapter()) throw Error("worker-webgpu-unavailable");
      importScripts("/vendor/tfjs-4.22.0/tf-core.min.js");
      importScripts("/vendor/tfjs-4.22.0/tf-converter.min.js",
        "/vendor/tfjs-4.22.0/tf-backend-webgpu.min.js",
        "/vendor/tfjs-4.22.0/coco-ssd.min.js");
      if (!await self.tf.setBackend("webgpu")) throw Error("worker-webgpu-unavailable");
      await self.tf.ready();
      model = await self.cocoSsd.load({ base: "lite_mobilenet_v2",
        modelUrl: "/vendor/coco-ssd-lite-v1/model.json" });
      self.postMessage({ id: message.id, backend: self.tf.getBackend() });
    } else if (message.type === "detect") {
      if (!model) throw Error("worker-not-ready");
      const frame = new ImageData(new Uint8ClampedArray(message.buffer), message.width, message.height);
      const result = await model.detect(frame, message.maxBoxes, message.minimumScore);
      self.postMessage({ id: message.id, result });
    }
  } catch (error) {
    self.postMessage({ id: message.id, error: String(error?.message || error) });
  }
};
