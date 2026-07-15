(function attachDispatchOrder(globalObject) {
  const severityWeight = Object.freeze({ urgent: 3, high: 2, monitor: 1 });

  function validCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "";
    const [year, month, day] = String(value).split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? String(value) : "";
  }

  function compareDispatchEntries(left, right) {
    const severityDifference = (severityWeight[right?.action?.severity] || 0) - (severityWeight[left?.action?.severity] || 0);
    if (severityDifference) return severityDifference;

    const leftDueDate = validCalendarDate(left?.action?.dueDate);
    const rightDueDate = validCalendarDate(right?.action?.dueDate);
    if (leftDueDate && rightDueDate && leftDueDate !== rightDueDate) return leftDueDate.localeCompare(rightDueDate);
    if (leftDueDate !== rightDueDate) return leftDueDate ? -1 : 1;

    const createdDifference = String(right?.record?.createdAt || "").localeCompare(String(left?.record?.createdAt || ""));
    if (createdDifference) return createdDifference;
    return String(left?.action?.code || "").localeCompare(String(right?.action?.code || ""));
  }

  globalObject.TidewayDispatchOrder = Object.freeze({ compareDispatchEntries, validCalendarDate });
})(globalThis);
