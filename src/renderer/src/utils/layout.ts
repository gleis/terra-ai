import dagre from 'dagre'
import { Node, Edge } from 'reactflow'

const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({ rankdir: direction })

  nodes.forEach((node) => {
    // We estimate sizes since React Flow measures async. These defaults are good for standard Tailwind boxes.
    dagreGraph.setNode(node.id, { width: 250, height: 60 })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
      // We are shifting the dagre node position (anchor=center) to React Flow (anchor=top-left)
      position: {
        x: nodeWithPosition.x - 125,
        y: nodeWithPosition.y - 30,
      },
    }
  })

  return { nodes: newNodes as Node[], edges }
}
