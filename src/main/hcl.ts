// Pure HCL parsing helpers used by the main process.
// Kept free of Electron/Node-IO imports so they can be tested in isolation.

// Locate the character range of the HCL block for a graph node label like
// "aws_vpc.main", "data.aws_ami.ubuntu", or "module.network" by brace matching.
export function findHclBlockRange(content: string, label: string): { start: number; end: number } | null {
  let headerRegex: RegExp
  const dataMatch = label.match(/^data\.([\w-]+)\.([\w-]+)$/)
  const moduleMatch = label.match(/^module\.([\w-]+)/)
  const resourceMatch = label.match(/^([\w-]+)\.([\w-]+)$/)

  if (dataMatch) {
    headerRegex = new RegExp(`^\\s*data\\s+"${dataMatch[1]}"\\s+"${dataMatch[2]}"\\s*\\{`, 'm')
  } else if (moduleMatch) {
    headerRegex = new RegExp(`^\\s*module\\s+"${moduleMatch[1]}"\\s*\\{`, 'm')
  } else if (resourceMatch) {
    headerRegex = new RegExp(`^\\s*resource\\s+"${resourceMatch[1]}"\\s+"${resourceMatch[2]}"\\s*\\{`, 'm')
  } else {
    return null
  }

  const match = headerRegex.exec(content)
  if (!match) return null

  // The regex may match leading whitespace/newline; start at the first non-space
  let start = match.index
  while (start < content.length && /\s/.test(content[start])) start += 1

  let depth = 0
  let inString = false
  for (let i = content.indexOf('{', match.index); i < content.length; i += 1) {
    const char = content[i]
    if (char === '"' && content[i - 1] !== '\\') inString = !inString
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return { start, end: i + 1 }
    }
  }
  return null
}

export function extractHclBlock(content: string, label: string): string | null {
  const range = findHclBlockRange(content, label)
  return range ? content.slice(range.start, range.end).trim() : null
}

// Attributes that affect cost. Collected from anywhere inside a resource block
// (including nested blocks like root_block_device) so sizing changes are picked up.
const COST_ATTRIBUTE_KEYS = new Set([
  'instance_type',
  'instance_types',
  'instance_class',
  'node_type',
  'count',
  'desired_count',
  'desired_capacity',
  'desired_size',
  'min_size',
  'allocated_storage',
  'volume_size',
  'size',
  'multi_az',
  'number_of_nodes',
  'num_cache_nodes',
  'num_node_groups',
  'engine',
  'storage_type',
  'replica_count'
])

// Pull cost-relevant `key = value` pairs out of an HCL block. Values are kept as
// raw strings; interpolated/variable values are returned as-is so the cost layer
// can decide they are unknown.
export function parseBlockAttributes(block: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const attrRegex = /^\s*([a-z_][a-z0-9_]*)\s*=\s*(.+?)\s*$/gim
  let match: RegExpExecArray | null

  while ((match = attrRegex.exec(block)) !== null) {
    const key = match[1]
    if (!COST_ATTRIBUTE_KEYS.has(key)) continue
    // First occurrence wins (top-level attributes appear before nested ones
    // for the keys we care about in practice).
    if (attributes[key] !== undefined) continue
    const rawValue = match[2].replace(/,\s*$/, '').trim()
    attributes[key] = rawValue.replace(/^["']|["']$/g, '')
  }

  // EKS node groups declare `instance_types = ["m5.large"]`; use the first entry
  // as the effective instance type when a scalar one was not given.
  if (attributes.instance_type === undefined && attributes.instance_types) {
    const firstEntry = attributes.instance_types.match(/["']([^"']+)["']/)
    if (firstEntry) attributes.instance_type = firstEntry[1]
  }

  // for_each over a literal list/map gives us an instance count
  const forEach = block.match(/^\s*for_each\s*=\s*(\[[^\]]*\]|\{[^}]*\})/m)
  if (forEach && attributes.count === undefined) {
    const literal = forEach[1]
    const items = literal.startsWith('[')
      ? literal.slice(1, -1).split(',').filter((s) => s.trim().length > 0).length
      : literal.split('\n').filter((line) => /=/.test(line)).length
    if (items > 0) attributes.count = String(items)
  }

  return attributes
}

// Find every resource block in a file with its cost-relevant attributes.
export function parseResourcesInFile(
  content: string
): Array<{ address: string; type: string; attributes: Record<string, string> }> {
  const resources: Array<{ address: string; type: string; attributes: Record<string, string> }> = []
  const headerRegex = /^\s*resource\s+"([\w-]+)"\s+"([\w-]+)"\s*\{/gm
  let match: RegExpExecArray | null

  while ((match = headerRegex.exec(content)) !== null) {
    const type = match[1]
    const address = `${type}.${match[2]}`
    const range = findHclBlockRange(content, address)
    if (!range) continue
    resources.push({
      address,
      type,
      attributes: parseBlockAttributes(content.slice(range.start, range.end))
    })
  }

  return resources
}
