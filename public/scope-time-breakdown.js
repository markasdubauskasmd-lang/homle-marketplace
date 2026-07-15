(function attachScopeTimeBreakdown(globalObject) {
  const version = 1;
  const wholeProperty = "Whole property";

  function text(value, max = 80) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
  }

  function isExclusion(value) {
    return /^(?:do\s+not|don't|dont|no\s+need|not\s+(?:necessary|required)|skip|exclude|avoid|leave)\b/i.test(text(value, 500));
  }

  function scopeTimeAreas(brief = {}) {
    const photos = Array.isArray(brief.photos) ? brief.photos : [];
    const checklist = Array.isArray(brief.checklist) ? brief.checklist : [];
    const order = [];
    const areas = new Map();
    const ensure = (area) => {
      const safeArea = text(area) || wholeProperty;
      const key = safeArea.toLowerCase();
      if (!areas.has(key)) {
        areas.set(key, { area: safeArea, visualCount: 0, taskCount: 0 });
        order.push(key);
      }
      return areas.get(key);
    };
    photos.forEach((photo) => { ensure(photo?.area).visualCount += 1; });
    checklist.forEach((value) => {
      const task = text(value, 500);
      if (!task) return;
      const separator = task.indexOf(":");
      const proposedArea = separator > 0 ? text(task.slice(0, separator)) : wholeProperty;
      const candidate = areas.has(proposedArea.toLowerCase()) ? areas.get(proposedArea.toLowerCase()).area : wholeProperty;
      const instruction = separator > 0 ? task.slice(separator + 1).trim() : task;
      if (!isExclusion(instruction)) ensure(candidate).taskCount += 1;
    });
    if (!order.length) ensure(wholeProperty);
    return order.map((key) => ({ ...areas.get(key) }));
  }

  function buildScopeTimeBreakdown({ expectedAreas = [], areaMinutes = [], overheadMinutes = "" } = {}) {
    const areas = expectedAreas.map((value) => text(value?.area || value)).filter(Boolean);
    const errors = [];
    if (!areas.length || new Set(areas.map((area) => area.toLowerCase())).size !== areas.length) errors.push("The review areas are incomplete or duplicated.");
    const supplied = Array.isArray(areaMinutes) ? areaMinutes : [];
    const rows = areas.map((area) => {
      const match = supplied.find((entry) => text(entry?.area).toLowerCase() === area.toLowerCase());
      const rawMinutes = match?.minutes;
      const minutes = Number(rawMinutes);
      if (rawMinutes === "" || rawMinutes == null || !Number.isInteger(minutes) || minutes < 5 || minutes > 720 || minutes % 5 !== 0) errors.push(`Enter ${area} time in five-minute steps between 5 and 720 minutes.`);
      return { area, minutes: Number.isInteger(minutes) ? minutes : 0 };
    });
    const suppliedAreaNames = supplied.map((entry) => text(entry?.area).toLowerCase()).filter(Boolean);
    if (suppliedAreaNames.length !== areas.length || new Set(suppliedAreaNames).size !== suppliedAreaNames.length || suppliedAreaNames.some((area) => !areas.some((expected) => expected.toLowerCase() === area))) errors.push("The time rows must match the exact submitted room scope.");
    const overhead = Number(overheadMinutes);
    if (overheadMinutes === "" || overheadMinutes == null || !Number.isInteger(overhead) || overhead < 0 || overhead > 240 || overhead % 5 !== 0) errors.push("Enter preparation and quality-check time in five-minute steps from 0 to 240 minutes.");
    const totalMinutes = rows.reduce((total, row) => total + row.minutes, 0) + (Number.isInteger(overhead) ? overhead : 0);
    if (totalMinutes < 30 || totalMinutes > 960) errors.push("The complete reviewed scope must total between 30 minutes and 16 hours; request a split scope when more time is needed.");
    const roundedHours = totalMinutes > 0 ? Math.ceil(totalMinutes / 15) / 4 : 0;
    return {
      valid: errors.length === 0,
      errors: [...new Set(errors)],
      breakdown: { version, areas: rows, overheadMinutes: Number.isInteger(overhead) ? overhead : 0, totalMinutes, roundedHours }
    };
  }

  function validateScopeTimeBreakdown({ brief = {}, breakdown, expectedHours } = {}) {
    const expectedAreas = scopeTimeAreas(brief);
    const result = buildScopeTimeBreakdown({ expectedAreas, areaMinutes: breakdown?.areas, overheadMinutes: breakdown?.overheadMinutes });
    const errors = [...result.errors];
    if (Number(breakdown?.version) !== version) errors.push("The room-time worksheet version is missing or unsupported.");
    if (Number(breakdown?.totalMinutes) !== result.breakdown.totalMinutes || Number(breakdown?.roundedHours) !== result.breakdown.roundedHours) errors.push("The room-time worksheet total does not match its entries.");
    if (expectedHours != null && Number(expectedHours) !== result.breakdown.roundedHours) errors.push("The reviewed hours do not match the room-time worksheet.");
    return { valid: errors.length === 0, errors: [...new Set(errors)], breakdown: result.breakdown, expectedAreas };
  }

  globalObject.TidewayScopeTimeBreakdown = Object.freeze({ version, scopeTimeAreas, buildScopeTimeBreakdown, validateScopeTimeBreakdown });
})(globalThis);
