let counter = 0;

export function createId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(3, "0")}`;
}
