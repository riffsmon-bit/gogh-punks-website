/**
 * Strict canonical JSON for local security artifacts. Rejects values ordinary
 * JSON would silently drop, coerce, invoke, or represent imprecisely.
 */
export function canonicalJson(value) {
  const active = new WeakSet();

  function encode(current, path) {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))) {
        throw new TypeError(`${path} contains an unsupported number`);
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError(`${path} contains a non-JSON value`);
    }
    if (active.has(current)) throw new TypeError(`${path} contains a cycle`);
    active.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) {
          throw new TypeError(`${path} must contain only ordinary arrays`);
        }
        const ownKeys = Reflect.ownKeys(current);
        const expected = new Set(["length", ...Array.from({ length: current.length }, (_, index) => String(index))]);
        if (
          ownKeys.some((key) => typeof key !== "string" || !expected.has(key))
          || Array.from({ length: current.length }, (_, index) => index)
            .some((index) => !Object.hasOwn(current, index))
        ) throw new TypeError(`${path} must be a dense array without extra properties`);
        const descriptors = Object.getOwnPropertyDescriptors(current);
        if (
          !Object.hasOwn(descriptors.length, "value")
          || Array.from({ length: current.length }, (_, index) => String(index))
            .some((key) => !Object.hasOwn(descriptors[key], "value"))
        ) throw new TypeError(`${path} cannot contain accessors`);
        return `[${Array.from({ length: current.length }, (_, index) => (
          encode(descriptors[String(index)].value, `${path}[${index}]`)
        )).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only plain objects`);
      }
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) {
        throw new TypeError(`${path} cannot contain symbol keys`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, "value")) {
          throw new TypeError(`${path}.${key} cannot be an accessor`);
        }
      }
      return `{${keys.sort().map((key) => (
        `${JSON.stringify(key)}:${encode(descriptors[key].value, `${path}.${key}`)}`
      )).join(",")}}`;
    } finally {
      active.delete(current);
    }
  }

  return encode(value, "value");
}

/** Parse canonical JSON into null-prototype records so global Object.prototype
 * pollution cannot become inherited decision evidence. */
export function parseCanonicalJson(text) {
  if (typeof text !== "string") throw new TypeError("canonical JSON text is required");
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.setPrototypeOf(value, null);
    }
    return value;
  });
}
