import React, { useRef, useEffect, useState, useCallback } from 'react';
import './DashboardBg.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';

/* ════════════════════════════════════════════
   PHYSICS & PARTICLE TYPES
   ════════════════════════════════════════════ */

interface PhysicsItem {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

/* ════════════════════════════════════════════
   SVG DRAWINGS (line art only)
   ════════════════════════════════════════════ */

const Svgs: Record<string, React.ReactNode> = {
  shelf: (
    <svg viewBox="0 0 100 90" fill="none">
      <rect x="8" y="8" width="84" height="74" stroke="currentColor" strokeWidth="1.5" rx="2" />
      <line x1="8" y1="38" x2="92" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="13" width="10" height="22" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="28" y="16" width="8" height="19" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="40" y="12" width="12" height="23" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="56" y="15" width="9" height="20" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="70" y="11" width="11" height="24" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="16" y="43" width="12" height="32" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="32" y="46" width="10" height="29" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="46" y="42" width="14" height="33" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="64" y="45" width="8" height="30" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="76" y="43" width="11" height="32" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  bulb: (
    <svg viewBox="0 0 60 90" fill="none">
      <path d="M30 4C16.5 4 10 15 10 26C10 36 16 42 20 48C24 54 24 60 24 64H36C36 60 36 54 40 48C44 42 50 36 50 26C50 15 43.5 4 30 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="24" y="66" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="25" y="72" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="26" y="77" width="8" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path className="dbg-filament" d="M26 40L30 46L34 40" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="30" y1="46" x2="30" y2="54" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle className="dbg-glow" cx="30" cy="36" r="22" stroke="none" fill="currentColor" />
    </svg>
  ),
  magnifier: (
    <svg viewBox="0 0 60 60" fill="none">
      <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="1.8" />
      <line x1="36" y1="36" x2="52" y2="52" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="15" y1="24" x2="33" y2="24" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M18 30 Q24 35 30 30" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 30 100" fill="none">
      <polygon points="15,4 10,16 20,16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="15" y1="4" x2="15" y2="10" stroke="currentColor" strokeWidth="0.8" />
      <rect x="9" y="16" width="12" height="58" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8" y="74" width="14" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="78" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="22" x2="12" y2="40" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
      <line x1="18" y1="22" x2="18" y2="40" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
    </svg>
  ),
  document: (
    <svg viewBox="0 0 50 60" fill="none">
      <path d="M12 8L12 56L38 56L38 20L28 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points="28,8 28,20 38,20" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="18" y1="28" x2="32" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="18" y1="34" x2="32" y2="34" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="18" y1="40" x2="28" y2="40" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 50 50" fill="none">
      <circle cx="25" cy="25" r="20" stroke="currentColor" strokeWidth="1.5" />
      <line x1="25" y1="12" x2="25" y2="16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="25" y1="25" x2="25" y2="34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="25" y1="25" x2="32" y2="25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="25" cy="25" r="2" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  sparkle1: (
    <svg viewBox="0 0 30 30" fill="none">
      <path d="M15 2L18 12L28 15L18 18L15 28L12 18L2 15L12 12Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  sparkle2: (
    <svg viewBox="0 0 30 30" fill="none">
      <path d="M15 2L18 12L28 15L18 18L15 28L12 18L2 15L12 12Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 60 60" fill="none">
      <g className="dbg-gear-spin">
        <circle cx="30" cy="30" r="12" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="30" cy="30" r="6" stroke="currentColor" strokeWidth="1.2" />
        <rect x="28" y="6" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="28" y="46" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="6" y="28" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="46" y="28" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="11.5" y="11.5" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" transform="rotate(45 13.5 15)" />
        <rect x="44.5" y="11.5" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" transform="rotate(-45 46.5 15)" />
        <rect x="11.5" y="41.5" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" transform="rotate(-45 13.5 45)" />
        <rect x="44.5" y="41.5" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" transform="rotate(45 46.5 45)" />
      </g>
    </svg>
  ),
};

/* ════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════ */

interface DragState {
  id: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  lastX: number;
  lastY: number;
  velocityX: number;
  velocityY: number;
}

const RESTITUTION = 0.85;
const FRICTION = 0.998;
const MAX_SPEED = 5;
const PARTICLE_COUNT = 18;

const ITEM_CONFIGS = [
  { id: 'shelf',     css: 'dbg-shelf',     r: 36, m: 2.2 },
  { id: 'bulb',      css: 'dbg-bulb',      r: 28, m: 1.2 },
  { id: 'magnifier', css: 'dbg-magnifier', r: 26, m: 1.0 },
  { id: 'pencil',    css: 'dbg-pencil',    r: 18, m: 0.8 },
  { id: 'document',  css: 'dbg-document',  r: 22, m: 0.9 },
  { id: 'clock',     css: 'dbg-clock',     r: 26, m: 1.3 },
  { id: 'sparkle1',  css: 'dbg-sparkle dbg-sparkle-1', r: 12, m: 0.3 },
  { id: 'sparkle2',  css: 'dbg-sparkle dbg-sparkle-2', r: 12, m: 0.3 },
  { id: 'gear',      css: 'dbg-gear',      r: 26, m: 1.8 },
];

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export const DashboardBg: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<PhysicsItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number>(0);
  const mousePosRef = useRef({ x: 0, y: 0 });

  const [renderItems, setRenderItems] = useState<Record<string, { x: number; y: number }>>({});
  const [renderParticles, setRenderParticles] = useState<Particle[]>([]);

  // ── Init physics items ──────────────────────────────
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pad = 60;

    itemsRef.current = ITEM_CONFIGS.map((cfg, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      return {
        id: cfg.id,
        x: rand(pad, w - pad),
        y: rand(pad, h - pad),
        vx: rand(-0.8, 0.8),
        vy: rand(-0.8, 0.8),
        radius: cfg.r,
        mass: cfg.m,
      };
    });

    const init: Record<string, { x: number; y: number }> = {};
    itemsRef.current.forEach(it => { init[it.id] = { x: it.x, y: it.y }; });
    setRenderItems(init);
  }, []);

  // ── Spawn particles ─────────────────────────────────
  const spawnExplosion = useCallback((cx: number, cy: number) => {
    const newP: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1, 5);
      newP.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: rand(0.4, 0.9),
        size: rand(3, 7),
      });
    }
    particlesRef.current.push(...newP);
  }, []);

  // ── Physics + drag handler ──────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const items = itemsRef.current;

      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const dx = mx - it.x;
        const dy = my - it.y;
        if (dx * dx + dy * dy < (it.radius + 10) * (it.radius + 10)) {
          it.vx = 0;
          it.vy = 0;
          dragRef.current = {
            id: it.id,
            startX: it.x,
            startY: it.y,
            offsetX: dx,
            offsetY: dy,
            lastX: it.x,
            lastY: it.y,
            velocityX: 0,
            velocityY: 0,
          };
          return;
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (!dragRef.current) return;
      const drag = dragRef.current;
      const it = itemsRef.current.find(i => i.id === drag.id);
      if (!it) return;

      const newX = mousePosRef.current.x - drag.offsetX;
      const newY = mousePosRef.current.y - drag.offsetY;

      drag.velocityX = newX - drag.lastX;
      drag.velocityY = newY - drag.lastY;
      drag.lastX = newX;
      drag.lastY = newY;

      it.x = newX;
      it.y = newY;
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag) {
        const it = itemsRef.current.find(i => i.id === drag.id);
        if (it) {
          it.vx = drag.velocityX * 0.6;
          it.vy = drag.velocityY * 0.6;
          const spd = Math.sqrt(it.vx * it.vx + it.vy * it.vy);
          if (spd > MAX_SPEED) {
            it.vx = (it.vx / spd) * MAX_SPEED;
            it.vy = (it.vy / spd) * MAX_SPEED;
          }
        }
      }
      dragRef.current = null;
    };

    // Touch support
    const getTouchPos = (t: Touch) => {
      const rect = container.getBoundingClientRect();
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const pos = getTouchPos(e.touches[0]);
      const items = itemsRef.current;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const dx = pos.x - it.x;
        const dy = pos.y - it.y;
        if (dx * dx + dy * dy < (it.radius + 15) * (it.radius + 15)) {
          it.vx = 0;
          it.vy = 0;
          dragRef.current = {
            id: it.id,
            startX: it.x,
            startY: it.y,
            offsetX: dx,
            offsetY: dy,
            lastX: it.x,
            lastY: it.y,
            velocityX: 0,
            velocityY: 0,
          };
          return;
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const pos = getTouchPos(e.touches[0]);
      if (!dragRef.current) return;
      const drag = dragRef.current;
      const it = itemsRef.current.find(i => i.id === drag.id);
      if (!it) return;
      const newX = pos.x - drag.offsetX;
      const newY = pos.y - drag.offsetY;
      drag.velocityX = newX - drag.lastX;
      drag.velocityY = newY - drag.lastY;
      drag.lastX = newX;
      drag.lastY = newY;
      it.x = newX;
      it.y = newY;
    };

    const handleTouchEnd = () => handleMouseUp();

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // ── Animation loop ──────────────────────────────────
  useEffect(() => {
    const loop = () => {
      const items = itemsRef.current;
      const particles = particlesRef.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const pad = 30;
      const dragId = dragRef.current?.id;

      // Update physics items
      for (const it of items) {
        if (it.id === dragId) continue;

        // Friction
        it.vx *= FRICTION;
        it.vy *= FRICTION;

        // Clamp speed
        const spd = Math.sqrt(it.vx * it.vx + it.vy * it.vy);
        if (spd > MAX_SPEED) {
          it.vx = (it.vx / spd) * MAX_SPEED;
          it.vy = (it.vy / spd) * MAX_SPEED;
        }

          // Apply velocity
        it.x += it.vx;
        it.y += it.vy;

        // Random gentle push to keep moving
        if (Math.random() < 0.005) {
          it.vx += rand(-0.3, 0.3);
          it.vy += rand(-0.3, 0.3);
        }

        // Wall bounce
        if (it.x - it.radius < 0) { it.x = it.radius; it.vx = -it.vx * RESTITUTION; spawnExplosion(it.x, it.y); }
        if (it.x + it.radius > w) { it.x = w - it.radius; it.vx = -it.vx * RESTITUTION; spawnExplosion(it.x, it.y); }
        if (it.y - it.radius < 0) { it.y = it.radius; it.vy = -it.vy * RESTITUTION; spawnExplosion(it.x, it.y); }
        if (it.y + it.radius > h) { it.y = h - it.radius; it.vy = -it.vy * RESTITUTION; spawnExplosion(it.x, it.y); }
      }

      // Item-item collision
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a.id === dragId || b.id === dragId) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = a.radius + b.radius;

          if (dist < minDist && dist > 0.01) {
            // Separate
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            // Elastic collision
            const dvx = a.vx - b.vx;
            const dvy = a.vy - b.vy;
            const dot = dvx * nx + dvy * ny;
            if (dot > 0) {
              const ma = a.mass, mb = b.mass;
              const impulse = (2 * dot) / (ma + mb);
              a.vx -= impulse * mb * nx * RESTITUTION;
              a.vy -= impulse * mb * ny * RESTITUTION;
              b.vx += impulse * ma * nx * RESTITUTION;
              b.vy += impulse * ma * ny * RESTITUTION;
            }

            // Explosion at midpoint
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            spawnExplosion(cx, cy);
          }
        }
      }

      // Update particles
      const alive: Particle[] = [];
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= 0.025;
        if (p.life > 0) alive.push(p);
      }
      particlesRef.current = alive;

      // Sync to React state (throttled via RAF)
      const pos: Record<string, { x: number; y: number }> = {};
      for (const it of items) pos[it.id] = { x: it.x, y: it.y };
      setRenderItems(pos);
      setRenderParticles([...alive]);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spawnExplosion]);

  return (
    <div className="dashboard-bg" ref={containerRef} aria-hidden="true">
      <FloatingParticles />
      {/* Connecting lines (static) */}
      <svg className="dbg-lines" viewBox="0 0 1000 700" preserveAspectRatio="none">
        <path d="M200 120 Q300 80 420 150 Q500 200 580 140 Q680 90 780 160" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.2" strokeDasharray="4 6" />
        <path d="M200 120 Q180 250 220 350 Q250 420 300 500" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.2" strokeDasharray="4 6" />
        <path d="M780 160 Q800 300 770 400 Q750 480 720 560" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.2" strokeDasharray="4 6" />
        <path d="M420 150 Q400 250 380 350 Q360 420 340 500" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.15" strokeDasharray="4 6" />
        <path d="M580 140 Q600 250 620 350 Q640 420 660 500" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.15" strokeDasharray="4 6" />
        <path d="M300 500 Q400 530 500 520 Q600 510 700 500" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.15" strokeDasharray="4 6" />
      </svg>

      {/* Physics drawings */}
      {ITEM_CONFIGS.map(cfg => {
        const pos = renderItems[cfg.id];
        if (!pos) return null;
        return (
          <div
            key={cfg.id}
            className={cfg.css}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              cursor: 'grab',
              zIndex: 2,
            }}
          >
            {Svgs[cfg.id]}
          </div>
        );
      })}

      {/* Particles */}
      {renderParticles.map((p, i) => (
        <div
          key={i}
          className="dbg-particle"
          style={{
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            opacity: p.life,
            transform: `translate(-50%, -50%) scale(${p.life})`,
          }}
        />
      ))}
    </div>
  );
};
