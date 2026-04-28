import { Node, Edge } from 'reactflow'

export function parseDotToReactFlow(dotString: string): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  
  // Terraform DOT lines usually look like:
  // "[root] module.my_module (expand)" [label = "module.my_module", shape = "box"]
  // "[root] module.my_module (expand)" -> "[root] aws_vpc.main (expand)"
  
  const nodeRegex = /"([^"]+)"\s*\[label\s*=\s*"([^"]+)",\s*shape\s*=\s*"([^"]+)"\]/g
  const edgeRegex = /"([^"]+)"\s*->\s*"([^"]+)"/g
  
  let match
  const nodeIds = new Set<string>()

  // First pass: extract all edges
  while ((match = edgeRegex.exec(dotString)) !== null) {
    const source = match[1]
    const target = match[2]
    edges.push({
      id: `e-${source}-${target}`,
      source,
      target,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#475569', strokeWidth: 2 }
    })
    nodeIds.add(source)
    nodeIds.add(target)
  }

  // Second pass: extract node definitions
  while ((match = nodeRegex.exec(dotString)) !== null) {
    const id = match[1]
    const label = match[2]
    nodeIds.add(id)
    nodes.push({
      id,
      type: 'terraform',
      data: { label },
      position: { x: 0, y: 0 },
    })
  }

  // Add nodes that are only in edges but missing explicit labels (fallback fallback)
  nodeIds.forEach(id => {
    if (!nodes.find(n => n.id === id)) {
      // Remove generic prefixes for a cleaner label if missing
      const cleanLabel = id.replace(/\[root\]\s*/, '').replace(/\(expand\)/, '').trim()
      nodes.push({
        id,
        type: 'terraform',
        data: { label: cleanLabel || id },
        position: { x: 0, y: 0 },
      })
    }
  })

  return { nodes, edges }
}
