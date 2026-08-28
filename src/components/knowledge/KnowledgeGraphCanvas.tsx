/**
 * @file KnowledgeGraphCanvas.tsx
 * @brief Interactive 2D Force-Directed Knowledge Graph Visualizer (Obsidian / CodeGraph style).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { fmtUSD, fmtInt } from '../../lib/format';
import { withAlpha } from '../../lib/palette';
import type { FileHotspot, LayerSpend, ArchLayerKey } from '../../../shared/types';
import './knowledgegraph.css';

interface Node {
  id: string;
  label: string;
  fullPath: string;
  layer: ArchLayerKey;
  touches: number;
  cost: number;
  tokens: number;
  sessions: number;
  isHub?: boolean;
  isRoot?: boolean;
  radius: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface Edge {
  source: Node;
  target: Node;
  weight: number;
  length: number;
}

interface Particle {
  edgeIndex: number;
  progress: number;
  speed: number;
}

interface KnowledgeGraphProps {
  hotspots: FileHotspot[];
  layers: LayerSpend[];
  title?: string;
  height?: number | string;
}

const LAYER_COLORS: Record<string, string> = {
  core: '#f59e0b', // amber
  proto: '#14b8a6', // teal / cyan
  tui: '#a855f7', // purple
  embedded: '#06b6d4', // cyan / hardware
  backend: '#f59e0b', // amber / gold
  frontend: '#38bdf8', // blue / cyan
  ml: '#ec4899', // pink
  mobile: '#8b5cf6', // violet
  contracts: '#6366f1', // indigo
  testing: '#10b981', // sage / emerald
  docs: '#818cf8', // indigo / violet
  devops: '#f43f5e', // rose
  skills: '#fb923c', // orange
  config: '#64748b', // slate
  other: '#94a3b8', // faint
};

export function KnowledgeGraphCanvas({
  hotspots,
  layers,
  title = 'Workspace Architecture',
  height = 520,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [activeLayer, setActiveLayer] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showParticles, setShowParticles] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [hoveredNode, setHoveredNode] = useState<{
    node: Node;
    screenX: number;
    screenY: number;
  } | null>(null);

  // Pan & Zoom state
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const isDraggingRef = useRef(false);
  const dragNodeRef = useRef<Node | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number>(0);
  const alphaRef = useRef<number>(1);

  // Build graph model
  const { nodes, edges } = useMemo(() => {
    const nList: Node[] = [];
    const eList: Edge[] = [];
    const nodeMap = new Map<string, Node>();

    // 1. Root Node
    const rootNode: Node = {
      id: '__root__',
      label: title,
      fullPath: title,
      layer: 'other',
      touches: hotspots.reduce((s, h) => s + h.touches, 0),
      cost: hotspots.reduce((s, h) => s + h.cost, 0),
      tokens: hotspots.reduce((s, h) => s + h.tokens, 0),
      sessions: 0,
      isRoot: true,
      radius: 18,
      color: '#e2e8f0',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
    nList.push(rootNode);
    nodeMap.set(rootNode.id, rootNode);

    // 2. Layer Hubs
    layers.forEach((l, idx) => {
      const angle = (idx / layers.length) * Math.PI * 2;
      const dist = 120;
      const hubNode: Node = {
        id: `__layer_${l.key}__`,
        label: l.label.split('&')[0].trim(),
        fullPath: l.label,
        layer: l.key,
        touches: l.touches,
        cost: l.cost,
        tokens: l.tokens,
        sessions: 0,
        isHub: true,
        radius: Math.max(10, Math.min(22, 10 + Math.sqrt(l.touches || 1) * 0.4)),
        color: LAYER_COLORS[l.key] || '#94a3b8',
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
      };
      nList.push(hubNode);
      nodeMap.set(hubNode.id, hubNode);

      // Edge from Root to Layer Hub
      eList.push({
        source: rootNode,
        target: hubNode,
        weight: 1.5,
        length: 120,
      });
    });

    // 3. File Nodes
    const maxTouches = Math.max(...hotspots.map((h) => h.touches), 1);
    hotspots.forEach((h, idx) => {
      const parentHubId = `__layer_${h.layer}__`;
      const parentHub = nodeMap.get(parentHubId) || rootNode;
      const angle = (idx / hotspots.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;

      const normTouches = h.touches / maxTouches;
      const radius = Math.max(4.5, Math.min(14, 4.5 + normTouches * 9.5));

      const fileNode: Node = {
        id: h.file,
        label: h.shortPath.split('/').pop() || h.shortPath,
        fullPath: h.file,
        layer: h.layer,
        touches: h.touches,
        cost: h.cost,
        tokens: h.tokens,
        sessions: h.sessions,
        radius,
        color: LAYER_COLORS[h.layer] || '#94a3b8',
        x: parentHub.x + Math.cos(angle) * (60 + Math.random() * 60),
        y: parentHub.y + Math.sin(angle) * (60 + Math.random() * 60),
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
      };
      nList.push(fileNode);
      nodeMap.set(fileNode.id, fileNode);

      // Edge from Layer Hub to File Node
      eList.push({
        source: parentHub,
        target: fileNode,
        weight: 0.8,
        length: 60 + Math.random() * 30,
      });
    });

    return { nodes: nList, edges: eList };
  }, [hotspots, layers, title]);

  // Particles along edges
  const particlesRef = useRef<Particle[]>([]);
  useEffect(() => {
    const pts: Particle[] = [];
    const count = Math.min(edges.length * 2, 80);
    for (let i = 0; i < count; i++) {
      pts.push({
        edgeIndex: Math.floor(Math.random() * edges.length),
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.005,
      });
    }
    particlesRef.current = pts;
  }, [edges]);

  // Filtered visibility check
  const isNodeVisible = useCallback(
    (n: Node) => {
      if (n.isRoot) return true;
      if (activeLayer !== 'all' && n.layer !== activeLayer) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return n.label.toLowerCase().includes(q) || n.fullPath.toLowerCase().includes(q);
      }
      return true;
    },
    [activeLayer, search],
  );

  // Main Canvas & Simulation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
    let heightPx = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      heightPx = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      alphaRef.current = 0.6; // awaken
    };
    window.addEventListener('resize', handleResize);

    alphaRef.current = 1.0;

    const render = () => {
      // 1. Force Simulation Step (Verlet Physics)
      const alpha = alphaRef.current;
      if (alpha > 0.005) {
        // Center gravity
        for (const n of nodes) {
          if (n.fx !== undefined && n.fx !== null && n.fy !== undefined && n.fy !== null) {
            n.x = n.fx;
            n.y = n.fy;
            continue;
          }
          n.vx -= n.x * 0.0008 * alpha;
          n.vy -= n.y * 0.0008 * alpha;
        }

        // Repulsion (Many-body Coulomb force)
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          if (!isNodeVisible(a)) continue;
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            if (!isNodeVisible(b)) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distSq = dx * dx + dy * dy || 1;
            const dist = Math.sqrt(distSq);
            const minDist = a.radius + b.radius + 18;
            const repulse = ((minDist * minDist) / distSq) * 0.28 * alpha;
            const fx = (dx / dist) * repulse;
            const fy = (dy / dist) * repulse;

            if (a.fx === undefined || a.fx === null) {
              a.vx -= fx;
              a.vy -= fy;
            }
            if (b.fx === undefined || b.fx === null) {
              b.vx += fx;
              b.vy += fy;
            }
          }
        }

        // Edge Spring Force
        for (const e of edges) {
          if (!isNodeVisible(e.source) || !isNodeVisible(e.target)) continue;
          const dx = e.target.x - e.source.x;
          const dy = e.target.y - e.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const diff = dist - e.length;
          const spring = diff * 0.04 * e.weight * alpha;
          const fx = (dx / dist) * spring;
          const fy = (dy / dist) * spring;

          if (e.source.fx === undefined || e.source.fx === null) {
            e.source.vx += fx;
            e.source.vy += fy;
          }
          if (e.target.fx === undefined || e.target.fx === null) {
            e.target.vx -= fx;
            e.target.vy -= fy;
          }
        }

        // Apply velocities with damping
        const friction = 0.88;
        for (const n of nodes) {
          if (n.fx !== undefined && n.fx !== null) continue;
          n.vx *= friction;
          n.vy *= friction;
          n.x += n.vx;
          n.y += n.vy;
        }

        alphaRef.current *= 0.985; // cooling
      }

      // 2. Draw Frame
      ctx.save();
      ctx.clearRect(0, 0, width, heightPx);

      const dpr = window.devicePixelRatio;
      const { x: panX, y: panY, k: zoom } = transformRef.current;

      ctx.translate(width / 2 + panX * dpr, heightPx / 2 + panY * dpr);
      ctx.scale(zoom * dpr, zoom * dpr);

      // Draw Edges
      for (const e of edges) {
        if (!isNodeVisible(e.source) || !isNodeVisible(e.target)) continue;
        const isConnected =
          hoveredNode &&
          (hoveredNode.node.id === e.source.id || hoveredNode.node.id === e.target.id);

        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);

        if (isConnected) {
          ctx.strokeStyle = withAlpha(hoveredNode.node.color, 0.7);
          ctx.lineWidth = 1.8 / zoom;
        } else {
          ctx.strokeStyle = e.source.isRoot
            ? 'rgba(255, 255, 255, 0.12)'
            : 'rgba(255, 255, 255, 0.05)';
          ctx.lineWidth = (e.source.isRoot ? 1.2 : 0.8) / zoom;
        }
        ctx.stroke();
      }

      // Draw Particles along edges
      if (showParticles) {
        for (const p of particlesRef.current) {
          const e = edges[p.edgeIndex];
          if (!e || !isNodeVisible(e.source) || !isNodeVisible(e.target)) continue;
          p.progress = (p.progress + p.speed) % 1;
          const px = e.source.x + (e.target.x - e.source.x) * p.progress;
          const py = e.source.y + (e.target.y - e.source.y) * p.progress;

          ctx.beginPath();
          ctx.arc(px, py, 1.4 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(e.target.color, 0.7);
          ctx.fill();
        }
      }

      // Draw Nodes
      for (const n of nodes) {
        if (!isNodeVisible(n)) continue;
        const isHovered = hoveredNode && hoveredNode.node.id === n.id;
        const isDimmed = hoveredNode && !isHovered;

        ctx.save();
        ctx.translate(n.x, n.y);

        // Glow halo for hubs & high-touch nodes
        if (n.isRoot || n.isHub || isHovered || n.touches > 50) {
          const glowR = n.radius * (isHovered ? 2.4 : 1.8);
          const grad = ctx.createRadialGradient(0, 0, n.radius * 0.4, 0, 0, glowR);
          grad.addColorStop(0, withAlpha(n.color, isHovered ? 0.5 : 0.25));
          grad.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(0, 0, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Node disc
        ctx.beginPath();
        ctx.arc(0, 0, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = isDimmed ? withAlpha(n.color, 0.3) : n.color;
        ctx.fill();

        // Border ring
        ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = (isHovered ? 2 : 1) / zoom;
        ctx.stroke();

        // Node Label
        const shouldShowLabel =
          showLabels &&
          (n.isRoot ||
            n.isHub ||
            isHovered ||
            n.touches > 80 ||
            (zoom > 1.2 && n.touches > 20) ||
            zoom > 2.0);

        if (shouldShowLabel) {
          ctx.font = `${n.isRoot ? 'bold 11px' : n.isHub ? '600 10px' : '9px'} 'JetBrains Mono', monospace`;
          ctx.fillStyle = isHovered ? '#ffffff' : isDimmed ? 'rgba(255,255,255,0.4)' : '#cbd5e1';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(n.label, 0, n.radius + 3);
        }

        ctx.restore();
      }

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [nodes, edges, isNodeVisible, showLabels, showParticles, hoveredNode]);

  // Pointer event handlers (Pan, Zoom, Drag, Hover)
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, mouseX: 0, mouseY: 0 };
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { x: panX, y: panY, k: zoom } = transformRef.current;
    const cx = (mouseX - rect.width / 2 - panX) / zoom;
    const cy = (mouseY - rect.height / 2 - panY) / zoom;
    return { x: cx, y: cy, mouseX, mouseY };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    // Hit test nodes (top down)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!isNodeVisible(n)) continue;
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
        dragNodeRef.current = n;
        n.fx = n.x;
        n.fy = n.y;
        alphaRef.current = 0.5; // re-awaken simulation
        return;
      }
    }
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - transformRef.current.x,
      y: e.clientY - transformRef.current.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, mouseX, mouseY } = getCanvasCoords(e);

    if (dragNodeRef.current) {
      dragNodeRef.current.fx = x;
      dragNodeRef.current.fy = y;
      dragNodeRef.current.x = x;
      dragNodeRef.current.y = y;
      alphaRef.current = 0.4;
      return;
    }

    if (isDraggingRef.current) {
      transformRef.current.x = e.clientX - dragStartRef.current.x;
      transformRef.current.y = e.clientY - dragStartRef.current.y;
      return;
    }

    // Hover test
    let found: Node | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!isNodeVisible(n)) continue;
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
        found = n;
        break;
      }
    }

    if (found) {
      setHoveredNode({ node: found, screenX: mouseX, screenY: mouseY });
    } else if (hoveredNode) {
      setHoveredNode(null);
    }
  };

  const handleMouseUp = () => {
    if (dragNodeRef.current) {
      dragNodeRef.current.fx = null;
      dragNodeRef.current.fy = null;
      dragNodeRef.current = null;
    }
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newK = Math.max(0.2, Math.min(6.0, transformRef.current.k * zoomFactor));
    transformRef.current.k = newK;
    alphaRef.current = Math.max(alphaRef.current, 0.1);
  };

  const resetView = () => {
    transformRef.current = { x: 0, y: 0, k: 1 };
    alphaRef.current = 0.8;
  };

  return (
    <div
      ref={containerRef}
      className={`kg-container ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={{ height: isFullscreen ? 'auto' : height }}
    >
      {/* Top Toolbar */}
      <div className="kg-toolbar">
        <div className="kg-controls-left">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="kg-search-input"
            placeholder="Search nodes / files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="kg-controls-right">
          <button
            type="button"
            className={`kg-btn ${showLabels ? 'is-active' : ''}`}
            onClick={() => setShowLabels(!showLabels)}
            title="Toggle Labels"
          >
            labels
          </button>
          <button
            type="button"
            className={`kg-btn ${showParticles ? 'is-active' : ''}`}
            onClick={() => setShowParticles(!showParticles)}
            title="Toggle Particle Pulses"
          >
            pulses
          </button>
          <button type="button" className="kg-btn" onClick={resetView} title="Reset & Center View">
            center
          </button>
          <button
            type="button"
            className={`kg-btn ${isFullscreen ? 'is-active' : ''}`}
            onClick={() => setIsFullscreen(!isFullscreen)}
            title="Toggle Fullscreen"
          >
            {isFullscreen ? 'exit' : 'expand'}
          </button>
        </div>
      </div>

      {/* Layer Filter Pills (Dynamically derived from active layers in this project) */}
      <div className="kg-layer-pills">
        {['all', ...layers.filter((l) => l.touches > 0).map((l) => l.key)].map((k) => {
          const lObj = layers.find((l) => l.key === k);
          const label = lObj ? lObj.label.split('&')[0].trim() : k;
          return (
            <button
              key={k}
              type="button"
              className={`kg-pill ${activeLayer === k ? 'is-active' : ''}`}
              onClick={() => {
                setActiveLayer(k);
                alphaRef.current = 0.5;
              }}
            >
              {k !== 'all' && (
                <span
                  className="kg-pill-dot"
                  style={{ background: lObj?.color || LAYER_COLORS[k] || '#94a3b8' }}
                />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {/* HTML5 Canvas */}
      <canvas
        ref={canvasRef}
        className="kg-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Node Tooltip HUD */}
      {hoveredNode && (
        <div
          className="kg-hud"
          style={{
            left: `${hoveredNode.screenX}px`,
            top: `${hoveredNode.screenY}px`,
          }}
        >
          <div className="kg-hud-head">
            <span className="kg-hud-title">{hoveredNode.node.label}</span>
            <span
              className="kg-hud-tag"
              style={{
                background: withAlpha(hoveredNode.node.color, 0.2),
                color: hoveredNode.node.color,
              }}
            >
              {hoveredNode.node.layer}
            </span>
          </div>
          <div className="kg-hud-path" title={hoveredNode.node.fullPath}>
            {hoveredNode.node.fullPath}
          </div>
          <div className="kg-hud-stats">
            <span className="kg-hud-num">{fmtInt(hoveredNode.node.touches)} touches</span>
            {hoveredNode.node.sessions > 0 && (
              <span className="kg-hud-num">{fmtInt(hoveredNode.node.sessions)} ses</span>
            )}
            <span className="kg-hud-cost">{fmtUSD(hoveredNode.node.cost)}</span>
          </div>
        </div>
      )}

      {/* Stats Badge */}
      <div className="kg-stats-badge">
        {nodes.length} nodes · {edges.length} connections · physics active
      </div>
    </div>
  );
}
