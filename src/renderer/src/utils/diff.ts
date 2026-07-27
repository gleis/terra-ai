export type DiffLine = {
  type: 'same' | 'add' | 'del'
  text: string
}

// LCS-based line diff. Fine for Terraform-sized files; not meant for huge inputs.
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split('\n')
  const b = newText === '' ? [] : newText.split('\n')

  const m = a.length
  const n = b.length

  // Guard against pathological sizes: fall back to whole-file replace.
  if (m * n > 4_000_000) {
    return [
      ...a.map((text): DiffLine => ({ type: 'del', text })),
      ...b.map((text): DiffLine => ({ type: 'add', text }))
    ]
  }

  // DP table of LCS lengths
  const table: Uint32Array = new Uint32Array((m + 1) * (n + 1))
  const idx = (i: number, j: number): number => i * (n + 1) + j

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      table[idx(i, j)] =
        a[i] === b[j]
          ? table[idx(i + 1, j + 1)] + 1
          : Math.max(table[idx(i + 1, j)], table[idx(i, j + 1)])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (table[idx(i + 1, j)] >= table[idx(i, j + 1)]) {
      result.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      result.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < m) {
    result.push({ type: 'del', text: a[i] })
    i += 1
  }
  while (j < n) {
    result.push({ type: 'add', text: b[j] })
    j += 1
  }
  return result
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'add') added += 1
    if (line.type === 'del') removed += 1
  }
  return { added, removed }
}
