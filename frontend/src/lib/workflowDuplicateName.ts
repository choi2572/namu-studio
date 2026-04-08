/** `name_copy`, `name_copy_2`, `name_copy_3`, … — skips names already in `existingNames`. */
export function pickDuplicateWorkflowName(name: string, existingNames: Iterable<string>): string {
  const set = new Set(existingNames);
  const base = `${name}_copy`;
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}_${n}`)) {
    n += 1;
  }
  return `${base}_${n}`;
}
