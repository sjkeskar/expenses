import type { CatalogItem, MachineType } from "../../types/api";

// Machine steps as text, the way the catalog grid (and an Excel sheet)
// holds them: steps in order separated by ">", machines that run in
// parallel within a step by "+" (pivot.md §4.6), e.g.
// "Centrifuge > Haematology analyser + Biochemistry analyser".
export function stepsText(steps: CatalogItem["machineSteps"]) {
  const bySequence = new Map<number, string[]>();
  for (const step of steps) bySequence.set(step.sequence, [...(bySequence.get(step.sequence) ?? []), step.machineType.name]);
  return [...bySequence.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, names]) => names.join(" + "))
    .join(" > ");
}

// Parses stepsText back, matching machine types by name (any case). Throws
// a message naming an unknown machine type.
export function parseSteps(text: string | undefined, types: MachineType[]) {
  const steps = (text ?? "")
    .split(">")
    .map((step) => step.split("+").map((name) => name.trim()).filter(Boolean))
    .filter((names) => names.length > 0);
  return steps.flatMap((names, i) =>
    names.map((name) => {
      const type = types.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!type) throw new Error(`Unknown machine type "${name}"`);
      return { sequence: i + 1, machineTypeId: type.id };
    })
  );
}
