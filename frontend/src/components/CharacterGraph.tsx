import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { getWikiGraph } from '../lib/api'
import type { GraphNode, GraphEdge, WikiPageList } from '../lib/api'
import { Loader2 } from 'lucide-react'

// D3 simulation node extends GraphNode with mutable position fields
interface SimNode extends GraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface SimEdge {
  source: SimNode | string
  target: SimNode | string
}

interface Props {
  bookId: number
  effectiveChapter: number
  pages: WikiPageList | null
  onNavigate: (slug: string) => void
}

const TYPE_COLORS: Record<string, string> = {
  character: '#9333ea',
  place: '#10b981',
  event: '#f97316',
  summary: '#3b82f6',
}

const TYPE_LABEL: Record<string, string> = {
  character: 'Character',
  place: 'Place',
  event: 'Event',
  summary: 'Summary',
}

function nodeRadius(type: string) {
  return type === 'character' ? 22 : 18
}

export default function CharacterGraph({ bookId, effectiveChapter, pages, onNavigate }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<SimEdge[]>([])
  // Use refs for props that don't need to trigger simulation rebuilds
  const onNavigateRef = useRef(onNavigate)
  const pagesRef = useRef(pages)

  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => { pagesRef.current = pages }, [pages])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Track slugs that were already visible so we know which ones are new
  const prevSlugsRef = useRef<Set<string>>(new Set())

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; type: string } | null>(null)

  const buildGraph = useCallback(async () => {
    try {
      const data = await getWikiGraph(bookId, effectiveChapter)

      // Only show nodes that have a confirmed wiki page (present in the pages list)
      // and are not chapter summaries. This excludes stub WikiPage rows that were
      // created but never had content generated (e.g. due to a failed AI call).
      const currentPages = pagesRef.current
      const knownSlugs = currentPages
        ? new Set([
            ...currentPages.characters.map(p => p.slug),
            ...currentPages.places.map(p => p.slug),
            ...currentPages.events.map(p => p.slug),
          ])
        : null
      if (knownSlugs) {
        data.nodes = data.nodes.filter(n => knownSlugs.has(n.id))
      }
      const svg = svgRef.current
      const container = containerRef.current
      if (!svg || !container) return

      const width = container.clientWidth
      const height = container.clientHeight

      // Determine truly new nodes
      const newSlugs = new Set(data.nodes.map(n => n.id))
      const enterSlugs = new Set([...newSlugs].filter(s => !prevSlugsRef.current.has(s)))
      prevSlugsRef.current = newSlugs

      // ---- Merge node positions from previous tick ----
      const oldPositions = new Map<string, { x: number; y: number }>()
      for (const n of nodesRef.current) {
        if (n.x !== undefined && n.y !== undefined) {
          oldPositions.set(n.id, { x: n.x, y: n.y })
        }
      }

      const simNodes: SimNode[] = data.nodes.map(n => {
        const old = oldPositions.get(n.id)
        return {
          ...n,
          x: old?.x ?? width / 2 + (Math.random() - 0.5) * 60,
          y: old?.y ?? height / 2 + (Math.random() - 0.5) * 60,
        }
      })

      const slugToNode = new Map(simNodes.map(n => [n.id, n]))
      const simEdges: SimEdge[] = data.edges
        .filter(e => slugToNode.has(e.source) && slugToNode.has(e.target))
        .map(e => ({ source: e.source, target: e.target }))

      nodesRef.current = simNodes
      edgesRef.current = simEdges

      // ---- Set up SVG layers once ----
      let root = d3.select(svg)
      let zoomLayer = root.select<SVGGElement>('g.zoom-layer')
      if (zoomLayer.empty()) {
        root.attr('width', width).attr('height', height)
        const z = root.append('g').attr('class', 'zoom-layer')
        z.append('g').attr('class', 'edges-layer')
        z.append('g').attr('class', 'nodes-layer')

        // Zoom behaviour
        const zoom = d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.2, 4])
          .on('zoom', event => {
            z.attr('transform', event.transform)
          })
        root.call(zoom)
        root.on('click.zoom', null) // don't zoom on node click

        zoomLayer = z
      } else {
        root.attr('width', width).attr('height', height)
      }

      const edgeLayer = zoomLayer.select<SVGGElement>('g.edges-layer')
      const nodeLayer = zoomLayer.select<SVGGElement>('g.nodes-layer')

      // ---- Edges ----
      const edgeSel = edgeLayer.selectAll<SVGLineElement, SimEdge>('line')
        .data(simEdges, d => {
          const s = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
          const t = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
          return `${s}--${t}`
        })

      edgeSel.exit()
        .transition().duration(300)
        .attr('stroke-opacity', 0)
        .remove()

      edgeSel.enter()
        .append('line')
        .attr('stroke', '#c4a96a')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0)
        .transition().duration(600).delay(300)
        .attr('stroke-opacity', 0.5)

      // ---- Nodes ----
      const nodeSel = nodeLayer.selectAll<SVGGElement, SimNode>('g.node')
        .data(simNodes, d => d.id)

      nodeSel.exit<SimNode>()
        .transition().duration(300)
        .attr('opacity', 0)
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0}) scale(0)`)
        .remove()

      const nodeEnter = nodeSel.enter()
        .append('g')
        .attr('class', 'node')
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
        .attr('opacity', 0)
        .attr('cursor', 'pointer')
        .call(
          d3.drag<SVGGElement, SimNode>()
            .on('start', (event, d) => {
              if (!event.active) simulationRef.current?.alphaTarget(0.3).restart()
              d.fx = d.x; d.fy = d.y
            })
            .on('drag', (event, d) => {
              d.fx = event.x; d.fy = event.y
            })
            .on('end', (event, d) => {
              if (!event.active) simulationRef.current?.alphaTarget(0)
              d.fx = null; d.fy = null
            })
        )
        .on('click', (_event, d) => {
          onNavigateRef.current(d.slug)
        })
        .on('mouseenter', (event, d) => {
          const rect = containerRef.current?.getBoundingClientRect()
          setTooltip({
            x: event.clientX - (rect?.left ?? 0),
            y: event.clientY - (rect?.top ?? 0),
            title: d.title,
            type: d.page_type,
          })
        })
        .on('mouseleave', () => setTooltip(null))

      // Shadow / glow circle
      nodeEnter.append('circle')
        .attr('r', d => nodeRadius(d.page_type) + 5)
        .attr('fill', d => TYPE_COLORS[d.page_type] ?? '#888')
        .attr('opacity', 0.18)

      // Main circle
      nodeEnter.append('circle')
        .attr('r', d => nodeRadius(d.page_type))
        .attr('fill', d => TYPE_COLORS[d.page_type] ?? '#888')
        .attr('stroke', '#faf5eb')
        .attr('stroke-width', 2)

      // Label
      nodeEnter.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#faf5eb')
        .attr('font-size', d => d.title.length > 12 ? '9px' : '10px')
        .attr('font-weight', '600')
        .attr('pointer-events', 'none')
        .attr('dy', d => nodeRadius(d.page_type) > 20 ? '0' : '0')
        .each(function (d) {
          const words = d.title.split(' ')
          const maxLen = 10
          const el = d3.select(this)
          if (words.length === 1 || d.title.length <= maxLen) {
            el.text(d.title.length > maxLen ? d.title.slice(0, maxLen - 1) + '…' : d.title)
          } else {
            // Two-line label
            const line1 = words.slice(0, Math.ceil(words.length / 2)).join(' ')
            const line2 = words.slice(Math.ceil(words.length / 2)).join(' ')
            el.append('tspan').attr('x', 0).attr('dy', '-0.55em').text(
              line1.length > maxLen ? line1.slice(0, maxLen - 1) + '…' : line1
            )
            el.append('tspan').attr('x', 0).attr('dy', '1.1em').text(
              line2.length > maxLen ? line2.slice(0, maxLen - 1) + '…' : line2
            )
          }
        })

      // Pop-in animation: new nodes scale+fade in with stagger
      const allNodeGroups = nodeLayer.selectAll<SVGGElement, SimNode>('g.node')

      allNodeGroups
        .filter(d => enterSlugs.has(d.id))
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0}) scale(0)`)
        .attr('opacity', 0)
        .transition()
        .duration(600)
        .delay((_, i) => i * 40)
        .ease(d3.easeBackOut.overshoot(1.4))
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0}) scale(1)`)
        .attr('opacity', 1)

      // Nodes already visible just ensure they're shown
      allNodeGroups
        .filter(d => !enterSlugs.has(d.id))
        .attr('opacity', 1)

      // ---- Rebuild simulation ----
      if (simulationRef.current) {
        simulationRef.current.stop()
      }

      const sim = d3.forceSimulation<SimNode>(simNodes)
        .force('link', d3.forceLink<SimNode, SimEdge>(simEdges)
          .id(d => d.id)
          .distance(90)
          .strength(0.5)
        )
        .force('charge', d3.forceManyBody().strength(-220))
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.12))
        .force('x', d3.forceX(width / 2).strength(0.04))
        .force('y', d3.forceY(height / 2).strength(0.04))
        .force('collision', d3.forceCollide<SimNode>(d => nodeRadius(d.page_type) + 8))
        .alphaDecay(0.028)

      simulationRef.current = sim

      sim.on('tick', () => {
        // Update edge positions
        edgeLayer.selectAll<SVGLineElement, SimEdge>('line')
          .attr('x1', d => (d.source as SimNode).x ?? 0)
          .attr('y1', d => (d.source as SimNode).y ?? 0)
          .attr('x2', d => (d.target as SimNode).x ?? 0)
          .attr('y2', d => (d.target as SimNode).y ?? 0)

        // Update node positions (preserve scale for animated nodes)
        nodeLayer.selectAll<SVGGElement, SimNode>('g.node')
          .filter(d => !enterSlugs.has(d.id))
          .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      })

      // After pop-in animation completes, tick all nodes normally
      setTimeout(() => {
        sim.on('tick', () => {
          edgeLayer.selectAll<SVGLineElement, SimEdge>('line')
            .attr('x1', d => (d.source as SimNode).x ?? 0)
            .attr('y1', d => (d.source as SimNode).y ?? 0)
            .attr('x2', d => (d.target as SimNode).x ?? 0)
            .attr('y2', d => (d.target as SimNode).y ?? 0)

          nodeLayer.selectAll<SVGGElement, SimNode>('g.node')
            .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
        })
      }, 700)

      setLoading(false)
    } catch {
      setError('Failed to load graph')
      setLoading(false)
    }
  }, [bookId, effectiveChapter])

  useEffect(() => {
    setLoading(true)
    setError('')
    buildGraph()
    return () => {
      simulationRef.current?.stop()
    }
  }, [buildGraph])

  // Handle container resize
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const svg = svgRef.current
      const c = containerRef.current
      if (svg && c) {
        const w = c.clientWidth
        const h = c.clientHeight
        d3.select(svg).attr('width', w).attr('height', h)
        simulationRef.current
          ?.force('center', d3.forceCenter(w / 2, h / 2).strength(0.12))
          .force('x', d3.forceX(w / 2).strength(0.04))
          .force('y', d3.forceY(h / 2).strength(0.04))
          .alpha(0.2)
          .restart()
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Deduplicate types for legend
  const legendTypes = Object.entries(TYPE_COLORS).filter(([type]) =>
    nodesRef.current.some(n => n.page_type === type)
  )

  return (
    <div ref={containerRef} className="relative w-full h-full bg-parchment-50 overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader2 size={24} className="animate-spin text-ink-muted" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      <svg ref={svgRef} className="w-full h-full" />

      {/* Legend */}
      {!loading && !error && legendTypes.length > 0 && (
        <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 bg-parchment-50/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-parchment-200">
          {legendTypes.map(([type, color]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-ink-muted">{TYPE_LABEL[type] ?? type}</span>
            </div>
          ))}
          <p className="text-xs text-ink-muted/50 mt-1 italic">Scroll to zoom · drag to pan</p>
        </div>
      )}

      {/* Node count badge */}
      {!loading && !error && nodesRef.current.length > 0 && (
        <div className="absolute top-3 right-3 text-xs text-ink-muted/60 bg-parchment-50/80 backdrop-blur-sm rounded-full px-2.5 py-0.5 border border-parchment-200">
          {nodesRef.current.length} {nodesRef.current.length === 1 ? 'entry' : 'entries'}
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded-lg bg-ink text-parchment-100 text-xs shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 28 }}
        >
          <span className="font-semibold">{tooltip.title}</span>
          <span className="ml-1.5 opacity-60">{TYPE_LABEL[tooltip.type] ?? tooltip.type}</span>
        </div>
      )}
    </div>
  )
}
