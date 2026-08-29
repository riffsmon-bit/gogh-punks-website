export function snapshotRecord(value, label = "input") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} must not contain symbol fields`);
  }
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label} must contain enumerable data fields only`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function snapshotExactRecord(value, expectedKeys, label = "input") {
  const snapshot = snapshotRecord(value, label);
  const actual = Object.keys(snapshot);
  if (actual.length !== expectedKeys.length
    || actual.some((key) => !expectedKeys.includes(key))
    || expectedKeys.some((key) => !Object.hasOwn(snapshot, key))) {
    throw new TypeError(`${label} has unsupported or missing fields`);
  }
  return snapshot;
}

export function snapshotDenseArray(value, label = "array") {
  if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an array`);
  }
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw new TypeError(`${label} has an invalid length`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} must not contain symbol fields`);
  }
  const output = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label} must be dense and contain data fields only`);
    }
    output.push(descriptor.value);
  }
  if (keys.length !== lengthDescriptor.value + 1
    || keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
  return Object.freeze(output);
}
