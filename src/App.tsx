import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ENTITY_H,
  ENTITY_W,
  GRAPH_H,
  GRAPH_W,
  entities,
  groups,
  links,
  scenarios,
  valueAt,
  type Scenario,
  type View,
} from "./data";

type IconName =
  | "back"
  | "check"
  | "chevron"
  | "expand"
  | "shrink"
  | "focus"
  | "forward"
  | "home"
  | "inspect"
  | "minus"
  | "narrate"
  | "options"
  | "pause"
  | "play"
  | "plus"
  | "restart"
  | "sound"
  | "soundOff"
  | "collapse"
  | "uncollapse"
  | "fit";

const SPEEDS = [0.5, 1, 2] as const;
const BASE_STEP_MS = 1500;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;

const ICONS: Record<IconName, React.ReactNode> = {
  back: (
    <>
      <path d="M5 4v16" />
      <path d="m18 5-9 7 9 7Z" />
    </>
  ),
  forward: (
    <>
      <path d="M19 4v16" />
      <path d="m6 5 9 7-9 7Z" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: (
    <>
      <path d="M9 5v14" />
      <path d="M15 5v14" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4Z" />
      <path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
    </>
  ),
  soundOff: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4Z" />
      <path d="m17 9 5 6m0-6-5 6" />
    </>
  ),
  narrate: (
    <>
      <path d="M4 7h8M4 12h6M4 17h7" />
      <path d="M16 8a4 4 0 0 1 0 8M18.5 5a8 8 0 0 1 0 14" />
    </>
  ),
  expand: <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />,
  shrink: <path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6" />,
  inspect: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 5 5" />
      <path d="M11 8v6m-3-3h6" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
  options: <path d="M4 7h9m4 0h3M4 12h3m4 0h9M4 17h11m4 0h1M15 4v6M9 9v6M17 14v6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />,
  focus: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
    </>
  ),
  restart: <path d="M4 12a8 8 0 1 1 2.4 5.7M4 6v6h6" />,
  home: <path d="M3 10 12 3l9 7v11H3V10zm6 11v-8h6v8" />,
  collapse: <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />,
  uncollapse: <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </g>
    </svg>
  );
}

/* ---------- Camera ---------- */

type Camera = { cx: number; cy: number; zoom: number };
type Box = { x: number; y: number; w: number; h: number };
const FIT: Camera = { cx: GRAPH_W / 2, cy: GRAPH_H / 2, zoom: 1 };

function constrain(cam: Camera): Camera {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom));
  const w = GRAPH_W / zoom;
  const h = GRAPH_H / zoom;
  const clamp = (v: number, size: number, total: number) =>
    size >= total ? total / 2 : Math.max(size / 2, Math.min(total - size / 2, v));
  return { zoom, cx: clamp(cam.cx, w, GRAPH_W), cy: clamp(cam.cy, h, GRAPH_H) };
}

function focusBox(box: Box): Camera {
  const zoom = Math.max(1, Math.min(2.4, 0.8 * Math.min(GRAPH_W / box.w, GRAPH_H / box.h)));
  return constrain({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, zoom });
}

function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/* ---------- Graph ---------- */

type GraphProps = {
  scenario: Scenario;
  step: number;
  selected: string;
  onSelect: (id: string) => void;
  camera: Camera;
  onCamera: (next: Camera) => void;
  collapsed: string[];
  onExpandGroup: (id: string) => void;
};

function GraphView({
  scenario,
  step,
  selected,
  onSelect,
  camera,
  onCamera,
  collapsed,
  onExpandGroup,
}: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const drag = useRef<{
    id: number;
    sx: number;
    sy: number;
    cam: Camera;
    scale: number;
    moved: boolean;
  } | null>(null);
  const swallowClick = useRef(false);
  const active = scenario.steps[step].active;

  const groupOf = (entityId: string) => entities.find((e) => e.id === entityId)!.group;
  const chipBox = (groupId: string): Box => {
    const g = groups.find((item) => item.id === groupId)!;
    return { x: g.x + (g.w - 150) / 2, y: g.y + (g.h - ENTITY_H) / 2 + 8, w: 150, h: ENTITY_H };
  };
  const boxOf = (entityId: string): Box => {
    const gid = groupOf(entityId);
    if (collapsed.includes(gid)) return chipBox(gid);
    const e = entities.find((item) => item.id === entityId)!;
    return { x: e.x, y: e.y, w: ENTITY_W, h: ENTITY_H };
  };

  // Wheel must be non-passive so zooming the diagram does not scroll the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      const cam = cameraRef.current;
      const factor = Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
      if (zoom === cam.zoom) return;
      event.preventDefault();
      const k = cam.zoom / zoom;
      onCamera(
        constrain({
          zoom,
          cx: anchor.x - (anchor.x - cam.cx) * k,
          cy: anchor.y - (anchor.y - cam.cy) * k,
        }),
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [onCamera]);

  const w = GRAPH_W / camera.zoom;
  const h = GRAPH_H / camera.zoom;
  const viewBox = `${camera.cx - w / 2} ${camera.cy - h / 2} ${w} ${h}`;

  const visibleLinks = links
    .map(([from, to, at]) => ({ from, to, at, a: groupOf(from), b: groupOf(to) }))
    .filter((l) => !(l.a === l.b && collapsed.includes(l.a)));

  const route = (a: Box, b: Box) => {
    let x1: number, y1: number, x2: number, y2: number;
    if (b.x >= a.x + a.w) {
      [x1, y1, x2, y2] = [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2];
    } else if (b.y >= a.y + a.h) {
      [x1, y1, x2, y2] = [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y];
    } else if (b.x + b.w <= a.x) {
      [x1, y1, x2, y2] = [a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2];
    } else {
      [x1, y1, x2, y2] = [a.x + a.w / 2, a.y, b.x + b.w / 2, b.y + b.h];
    }
    const vertical = Math.abs(x2 - x1) < 2;
    return vertical
      ? `M${x1} ${y1} L ${x2} ${y2}`
      : `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="graph-wrap">
      <svg
        ref={svgRef}
        className="graph"
        viewBox={viewBox}
        role="img"
        aria-label={`System graph at ${scenario.steps[step].title}`}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - 0"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey)
            return;
          const dx = w / 10;
          const dy = h / 10;
          let next: Camera | null = null;
          if (event.key === "ArrowLeft") next = { ...camera, cx: camera.cx - dx };
          if (event.key === "ArrowRight") next = { ...camera, cx: camera.cx + dx };
          if (event.key === "ArrowUp") next = { ...camera, cy: camera.cy - dy };
          if (event.key === "ArrowDown") next = { ...camera, cy: camera.cy + dy };
          if (event.key === "+" || event.key === "=") next = { ...camera, zoom: camera.zoom * 1.25 };
          if (event.key === "-") next = { ...camera, zoom: camera.zoom * 0.8 };
          if (event.key === "0") next = FIT;
          if (!next) return;
          event.preventDefault();
          event.stopPropagation();
          onCamera(constrain(next));
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          const ctm = event.currentTarget.getScreenCTM();
          if (!ctm) return;
          drag.current = {
            id: event.pointerId,
            sx: event.clientX,
            sy: event.clientY,
            cam: cameraRef.current,
            scale: ctm.a,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d || d.id !== event.pointerId) return;
          const dx = event.clientX - d.sx;
          const dy = event.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) {
            d.moved = true;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* pointer already ended */
            }
          }
          onCamera(constrain({ ...d.cam, cx: d.cam.cx - dx / d.scale, cy: d.cam.cy - dy / d.scale }));
        }}
        onPointerUp={(event) => {
          if (drag.current?.moved) swallowClick.current = true;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClickCapture={(event) => {
          if (swallowClick.current) {
            event.stopPropagation();
            swallowClick.current = false;
          }
        }}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0 0 8 4 0 8Z" fill="currentColor" />
          </marker>
        </defs>
        <g className="group-frame">
          {groups.map((g) => (
            <g key={g.id} className={collapsed.includes(g.id) ? "collapsed" : ""}>
              <rect x={g.x} y={g.y} width={g.w} height={g.h} />
              <text x={g.x + 12} y={g.y + 21}>
                {g.name}
              </text>
            </g>
          ))}
        </g>
        <g className="links">
          {visibleLinks.map((l) => {
            const hot = active.includes(l.from) && active.includes(l.to);
            return (
              <path
                key={`${l.from}-${l.to}`}
                d={route(boxOf(l.from), boxOf(l.to))}
                className={`${step >= l.at ? "visited" : ""} ${hot ? "hot" : ""}`}
                markerEnd="url(#arrow)"
              />
            );
          })}
        </g>
        {groups
          .filter((g) => collapsed.includes(g.id))
          .map((g) => {
            const box = chipBox(g.id);
            const members = entities.filter((e) => e.group === g.id);
            const live = members.some((e) => active.includes(e.id));
            return (
              <g
                key={g.id}
                className={`entity summary ${live ? "active" : ""}`}
                transform={`translate(${box.x} ${box.y})`}
                role="button"
                tabIndex={0}
                aria-label={`Expand group ${g.name}`}
                onClick={() => onExpandGroup(g.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onExpandGroup(g.id);
                }}
              >
                <rect width={box.w} height={box.h} />
                <circle cx="12" cy="14" r="3" />
                <text className="entity-label" x="22" y="18">
                  {g.name}
                </text>
                <text className="entity-value" x="12" y="39">
                  {members.length} entities{live ? " · active" : ""} · expand
                </text>
              </g>
            );
          })}
        {entities
          .filter((e) => !collapsed.includes(e.group))
          .map((entity) => {
            const isActive = active.includes(entity.id);
            const row = scenario.stateRows.find((r) => r.entity === entity.id);
            const change = valueAt(row, step);
            const value = change ? (change[2] ?? change[1]) : "idle";
            return (
              <g
                key={entity.id}
                className={`entity ${isActive ? "active" : ""} ${selected === entity.id ? "selected" : ""}`}
                transform={`translate(${entity.x} ${entity.y})`}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${entity.label}`}
                onClick={() => onSelect(entity.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(entity.id);
                }}
              >
                <rect width={ENTITY_W} height={ENTITY_H} />
                <circle cx="12" cy="14" r="3" />
                <text className="entity-label" x="22" y="18">
                  {entity.label}
                </text>
                <text className="entity-value" x="12" y="39">
                  {value}
                </text>
              </g>
            );
          })}
      </svg>
      <div className="canvas-hint">
        <span>Drag to pan · scroll to zoom · click a node to inspect</span>
        <div className="zoom-tools" role="toolbar" aria-label="Diagram navigation">
          <button
            aria-label="Zoom out"
            title="Zoom out"
            disabled={camera.zoom <= MIN_ZOOM}
            onClick={() => onCamera(constrain({ ...camera, zoom: camera.zoom * 0.8 }))}
          >
            <Icon name="minus" size={12} />
          </button>
          <span className="zoom-readout">{Math.round(camera.zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            title="Zoom in"
            disabled={camera.zoom >= MAX_ZOOM}
            onClick={() => onCamera(constrain({ ...camera, zoom: camera.zoom * 1.25 }))}
          >
            <Icon name="plus" size={12} />
          </button>
          <button aria-label="Fit to view" title="Fit to view" onClick={() => onCamera(FIT)}>
            <Icon name="fit" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

const LANES = ["API", "QUEUE", "WORKER", "PROVIDER"];
const LANE_OF: Record<string, number> = {
  "Checkout API": 0,
  "Payment queue": 1,
  "Payment worker": 2,
  "Known outcome": 2,
  Provider: 3,
  "Provider state": 3,
};

function SequenceView({ scenario, step }: { scenario: Scenario; step: number }) {
  const rows = scenario.sequenceRows;
  const latest = [...rows].reverse().find((row) => row[3] <= step);
  return (
    <div className="sequence-view">
      <div className="seq-scroll">
        <div className="sequence-head">
          {LANES.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="seq-body">
          <div className="lifelines" aria-hidden="true">
            {LANES.map((item) => (
              <i key={item} />
            ))}
          </div>
          <ol className="sequence-list">
            {rows.map(([from, to, event, at], index) => {
              const a = LANE_OF[from] ?? 0;
              const b = LANE_OF[to] ?? a;
              const self = a === b;
              const lo = Math.min(a, b);
              const hi = Math.max(a, b);
              const state = step === at ? "current" : step < at ? "future" : "past";
              // A self event occupies its lane and extends toward open space.
              const start = self ? (lo === 3 ? lo : lo + 1) : lo + 1;
              const end = self ? (lo === 3 ? lo + 2 : lo + 3) : hi + 2;
              return (
                <li
                  className={`seq-row ${state} ${self ? "self" : b > a ? "right" : "left"} ${self && lo === 3 ? "flip" : ""}`}
                  key={event}
                  title={`${from} → ${to}: ${event}`}
                >
                  <span
                    className="seq-line"
                    style={{
                      gridColumn: `${start} / ${end}`,
                      marginInline: self
                        ? lo === 3
                          ? "0 25%"
                          : "25% 0"
                        : `calc(50% / ${hi - lo + 1})`,
                    }}
                  >
                    <span className="seq-label">
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <code>{event}</code>
                    </span>
                    <i className="seq-arrow" />
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="seq-detail" aria-live="polite">
        <span>{latest ? (step === latest[3] ? "NOW" : "LATEST") : "NO EVENTS YET"}</span>
        {latest && (
          <p>
            {latest[0]} <b>→</b> {latest[1]} <code>{latest[2]}</code>
          </p>
        )}
      </div>
    </div>
  );
}

function StateView({
  scenario,
  step,
  onSelect,
}: {
  scenario: Scenario;
  step: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="state-view">
      <div className="state-row state-header">
        <span>ENTITY</span>
        <span>PATH</span>
        <span>COMMITTED VALUE</span>
        <span>ORIGIN</span>
      </div>
      {scenario.stateRows.map((row) => {
        const change = valueAt(row, step);
        const changedNow = row.changes.some((c) => c[0] === step);
        return (
          <button
            className={`state-row ${changedNow ? "changed" : ""} ${!change ? "future" : ""}`}
            key={row.entity}
            onClick={() => onSelect(row.entity)}
          >
            <strong>{row.entity}</strong>
            <code>.{row.path}</code>
            <code>{change ? change[1] : "—"}</code>
            <span>{change ? "authored" : "unmodeled"}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Options menu helpers ---------- */

function Toggle({
  icon,
  label,
  on,
  onClick,
  disabled,
  title,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`opt-toggle ${on ? "on" : ""}`}
      aria-pressed={on}
      disabled={disabled}
      title={title ?? label}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div className="opt-field">
      <label htmlFor={id}>{label}</label>
      <span className="opt-select">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <Icon name="chevron" size={12} />
      </span>
    </div>
  );
}

/* ---------- Player ---------- */

function Player({
  scenario,
  onScenario,
}: {
  scenario: Scenario;
  onScenario: (id: string) => void;
}) {
  const { steps } = scenario;
  const last = steps.length - 1;
  const [step, setStep] = useState(Math.min(5, last));
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>("Graph");
  const [selected, setSelected] = useState("provider");
  const [inspecting, setInspecting] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [soundOn, setSoundOn] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [camera, setCameraState] = useState<Camera>(FIT);
  // On narrow screens the whole diagram is too small to read, so follow the action.
  const [follow, setFollow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [drilled, setDrilled] = useState<string | null>(null);

  const playerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const stepInputRef = useRef<HTMLInputElement>(null);
  const seekRevision = useRef(0);
  const ids = { entity: useId(), chapter: useId(), scenario: useId(), group: useId(), step: useId() };

  const speechAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  const chapter = scenario.chapters.find((c) => step >= c.start && step <= c.end);
  const causal = scenario.causalLinks.filter((l) => l.step === step);
  const current = steps[step];

  const setCamera = useCallback((next: Camera) => {
    setCameraState(next);
    setFollow(false);
  }, []);

  const seek = (next: number) => {
    seekRevision.current += 1;
    setStep(Math.max(0, Math.min(last, next)));
    setPlaying(false);
  };

  // Interval clock; when narrating, the speech end event is the clock instead.
  useEffect(() => {
    if (!playing || (narrating && speechAvailable)) return;
    const timer = window.setInterval(() => {
      setStep((s) => {
        if (s >= last) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, BASE_STEP_MS / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, narrating, speechAvailable, last]);

  // Sonification: one short tone per frame, pitch rises with progress.
  useEffect(() => {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      audioRef.current ??= new Ctx();
      const audio = audioRef.current;
      void audio.resume().catch(() => {});
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      osc.frequency.value = 220 * Math.pow(2, (step / Math.max(1, last)) * 1.5);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(now + 0.32);
    } catch {
      /* audio is optional */
    }
  }, [soundOn, step, last, scenario]);
  useEffect(
    () => () => {
      void audioRef.current?.close().catch(() => {});
    },
    [],
  );

  // Narration: speak authored text for the current frame.
  const spoken = useMemo(() => {
    const parts: string[] = [current.title, current.note];
    if (chapter) parts.push(chapter.title, chapter.summary ?? "");
    for (const link of causal)
      parts.push(
        link.title,
        "Trigger: " + link.trigger,
        "Observed event: " + link.observedEvent,
        "State change: " + link.stateChange,
        "Consequence: " + link.consequence,
      );
    for (const t of current.transfers ?? [])
      parts.push(`${t.from} to ${t.to}${t.value ? ": " + t.value : ""}`);
    return parts.filter(Boolean).join(". ");
  }, [current, chapter, causal]);

  const latest = useRef({ playing, step, last });
  latest.current = { playing, step, last };
  useEffect(() => {
    if (!narrating || !speechAvailable) return;
    const engine = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.rate = speed;
    const revision = seekRevision.current;
    utterance.onend = () => {
      const state = latest.current;
      if (!state.playing || revision !== seekRevision.current) return;
      if (state.step >= state.last) setPlaying(false);
      else setStep(state.step + 1);
    };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      setNarrationError(`Speech stopped (${event.error}).`);
      setPlaying(false);
    };
    engine.cancel();
    engine.speak(utterance);
    return () => {
      utterance.onend = null;
      utterance.onerror = null;
      engine.cancel();
    };
  }, [narrating, speechAvailable, spoken, speed]);

  useEffect(() => {
    if (!speechAvailable) return;
    if (narrating) {
      if (playing) window.speechSynthesis.resume();
      else window.speechSynthesis.pause();
    }
  }, [playing, narrating, speechAvailable]);

  // Fullscreen sync.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const fullscreenAvailable =
    typeof document !== "undefined" && document.fullscreenEnabled !== false;
  const toggleFullscreen = async () => {
    setMenuOpen(false);
    try {
      if (!document.fullscreenElement) await playerRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* unavailable in embedded views */
    }
  };

  // Menu dismissal.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (menuOpen && stepInputRef.current) stepInputRef.current.value = String(step + 1);
  }, [menuOpen, step]);

  const selectedEntity = entities.find((e) => e.id === selected) ?? entities[0];
  const selectedRow = scenario.stateRows.find((r) => r.entity === selected);
  const selectedValue = valueAt(selectedRow, step);
  const history = (selectedRow?.changes ?? []).filter((c) => c[0] <= step);

  const effectiveCamera = useMemo(() => {
    if (!follow) return camera;
    const boxes = current.active
      .map((id) => entities.find((e) => e.id === id))
      .filter((e): e is (typeof entities)[number] => !!e && !collapsed.includes(e.group))
      .map((e) => ({ x: e.x, y: e.y, w: ENTITY_W, h: ENTITY_H }));
    const union = unionBox(boxes);
    return union ? focusBox(union) : camera;
  }, [follow, camera, current, collapsed]);

  const selectEntity = (id: string, open = true) => {
    setSelected(id);
    if (open) setInspecting(true);
  };
  const focusEntity = (id: string) => {
    selectEntity(id);
    const e = entities.find((item) => item.id === id);
    if (e && view === "Graph") {
      setCollapsed((list) => list.filter((g) => g !== e.group));
      setCamera(focusBox({ x: e.x, y: e.y, w: ENTITY_W, h: ENTITY_H }));
    }
  };
  const focusGroup = (id: string | null) => {
    setDrilled(id);
    if (!id) {
      setCamera(FIT);
      return;
    }
    const g = groups.find((item) => item.id === id);
    if (g) setCamera(focusBox(g));
  };
  const toggleCollapse = (id: string) => {
    setCollapsed((list) => (list.includes(id) ? list.filter((g) => g !== id) : [...list, id]));
    setFollow(false);
  };
  const expandGroup = (id: string) => {
    setCollapsed((list) => list.filter((g) => g !== id));
    focusGroup(id);
  };

  const showGraphOptions = view === "Graph";

  return (
    <div
      className="player-shell"
      ref={playerRef}
      role="group"
      aria-label="Visualization player"
      aria-keyshortcuts="ArrowLeft ArrowRight Home End Space"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowRight") seek(step + 1);
        if (event.key === "ArrowLeft") seek(step - 1);
        if (event.key === "Home") seek(0);
        if (event.key === "End") seek(last);
        if (event.key === " ") {
          event.preventDefault();
          setPlaying((value) => !value);
        }
      }}
    >
      <p role="status" aria-atomic="true" className="sr-only">
        Step {step + 1} of {steps.length}: {current.title}. {current.note}
        {chapter ? ` Chapter: ${chapter.title}.` : ""}
      </p>
      {narrationError && (
        <p role="alert" className="narration-error">
          {narrationError}
        </p>
      )}

      <header className="player-header">
        <div className="title-block">
          <h1>{scenario.title}</h1>
        </div>
        <div className="header-actions">
          <button
            className={inspecting ? "active" : ""}
            aria-pressed={inspecting}
            onClick={() => setInspecting((value) => !value)}
          >
            <Icon name="inspect" /> <span>Inspect</span>
          </button>
          <div className="menu-anchor" ref={menuRef}>
            <button
              className={`menu-trigger ${menuOpen ? "active" : ""}`}
              aria-label="Player options"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              title="Player options"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Icon name="options" />
              <span>Options</span>
              <Icon name="chevron" size={12} />
            </button>
            {menuOpen && (
              <div className="options-menu" role="group" aria-label="Player options">
                <section aria-label="Navigation">
                  <p className="opt-label">Navigation</p>
                  <Select
                    id={ids.scenario}
                    label="Scenario"
                    value={scenario.id}
                    onChange={(id) => {
                      setMenuOpen(false);
                      onScenario(id);
                    }}
                  >
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </Select>
                  <div className="opt-row">
                    <Select
                      id={ids.chapter}
                      label="Chapter"
                      value={chapter?.id ?? ""}
                      onChange={(id) => {
                        const c = scenario.chapters.find((item) => item.id === id);
                        if (c) seek(c.start);
                      }}
                    >
                      <option value="" disabled>
                        Choose a chapter
                      </option>
                      {scenario.chapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      className="opt-icon"
                      aria-label="Restart chapter"
                      title="Restart chapter"
                      disabled={!chapter}
                      onClick={() => chapter && seek(chapter.start)}
                    >
                      <Icon name="restart" size={14} />
                    </button>
                  </div>
                  <form
                    className="opt-row go-to"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const n = Number(new FormData(event.currentTarget).get("step"));
                      if (Number.isInteger(n) && n >= 1 && n <= steps.length) {
                        seek(n - 1);
                        setMenuOpen(false);
                      }
                    }}
                  >
                    <div className="opt-field">
                      <label htmlFor={ids.step}>Go to step</label>
                      <input
                        id={ids.step}
                        ref={stepInputRef}
                        type="number"
                        name="step"
                        min={1}
                        max={steps.length}
                        defaultValue={step + 1}
                        required
                      />
                    </div>
                    <button type="submit" className="opt-go">
                      Go
                    </button>
                  </form>
                </section>

                <section aria-label="Diagram">
                  <p className="opt-label">
                    Diagram
                    {!showGraphOptions && <em>graph view only</em>}
                  </p>
                  <fieldset disabled={!showGraphOptions} className="opt-fieldset">
                    <Select
                      id={ids.entity}
                      label="Select entity"
                      value={selected}
                      onChange={focusEntity}
                    >
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.label} ({e.id})
                        </option>
                      ))}
                    </Select>
                    <div className="opt-grid">
                      <Toggle
                        icon="focus"
                        label="Follow active"
                        on={follow}
                        title="Follow active entity"
                        onClick={() => {
                          if (follow) {
                            setCameraState(effectiveCamera);
                            setFollow(false);
                          } else setFollow(true);
                        }}
                      />
                      <Toggle icon="fit" label="Fit to view" on={false} onClick={() => setCamera(FIT)} />
                    </div>
                    <nav className="group-nav" aria-label="Group hierarchy">
                      <button
                        type="button"
                        className="opt-icon"
                        aria-label="Return to group overview"
                        title="Group overview"
                        onClick={() => focusGroup(null)}
                      >
                        <Icon name="home" size={14} />
                      </button>
                      {drilled && (
                        <span className="crumb">
                          / {groups.find((g) => g.id === drilled)?.name}
                        </span>
                      )}
                      <span className="opt-select grow">
                        <select
                          id={ids.group}
                          aria-label="Drill into group"
                          value={drilled ?? ""}
                          onChange={(event) => focusGroup(event.target.value || null)}
                        >
                          <option value="">Choose group</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <Icon name="chevron" size={12} />
                      </span>
                      <button
                        type="button"
                        className="opt-icon"
                        disabled={!drilled}
                        aria-expanded={drilled ? !collapsed.includes(drilled) : undefined}
                        aria-label={
                          drilled && collapsed.includes(drilled) ? "Expand group" : "Collapse group"
                        }
                        title={drilled && collapsed.includes(drilled) ? "Expand group" : "Collapse group"}
                        onClick={() => drilled && toggleCollapse(drilled)}
                      >
                        <Icon
                          name={drilled && collapsed.includes(drilled) ? "uncollapse" : "collapse"}
                          size={14}
                        />
                      </button>
                    </nav>
                  </fieldset>
                </section>

                <section aria-label="Playback and display">
                  <p className="opt-label">Playback and display</p>
                  <div className="speed-seg" role="radiogroup" aria-label="Playback speed">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={speed === s}
                        className={speed === s ? "on" : ""}
                        onClick={() => setSpeed(s)}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                  <div className="opt-grid">
                    <Toggle
                      icon={soundOn ? "sound" : "soundOff"}
                      label="Sonify trace"
                      on={soundOn}
                      title={soundOn ? "Mute trace" : "Unmute trace"}
                      onClick={() => setSoundOn((v) => !v)}
                    />
                    <Toggle
                      icon="narrate"
                      label="Narrate captions"
                      on={narrating}
                      disabled={!speechAvailable}
                      title={
                        speechAvailable
                          ? narrating
                            ? "Stop narration"
                            : "Read captions aloud"
                          : "Narration unavailable"
                      }
                      onClick={() => {
                        setNarrationError(null);
                        setNarrating((v) => !v);
                      }}
                    />
                    <Toggle
                      icon="inspect"
                      label="Inspector"
                      on={inspecting}
                      onClick={() => setInspecting((v) => !v)}
                    />
                    <Toggle
                      icon={fullscreen ? "shrink" : "expand"}
                      label={fullscreen ? "Minimize" : "Maximize"}
                      on={fullscreen}
                      disabled={!fullscreenAvailable}
                      title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      onClick={toggleFullscreen}
                    />
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="context-bar">
        <div className="view-tabs" role="tablist" aria-label="Visualization view">
          {(["Graph", "Sequence", "State"] as View[]).map((item) => (
            <button
              role="tab"
              aria-selected={view === item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="truth-note">
          <span>SOURCE</span> authored + simulated <i /> frame #{step}
        </div>
      </div>

      <div className={`player-content ${inspecting ? "with-inspector" : ""}`}>
        <div className="canvas">
          <div className="canvas-meta">
            <span>FRAME {String(step).padStart(2, "0")}</span>
            <strong>{current.event}</strong>
            <code>{current.type}</code>
          </div>
          {view === "Graph" && (
            <GraphView
              scenario={scenario}
              step={step}
              selected={selected}
              onSelect={(id) => selectEntity(id)}
              camera={effectiveCamera}
              onCamera={setCamera}
              collapsed={collapsed}
              onExpandGroup={expandGroup}
            />
          )}
          {view === "Sequence" && <SequenceView scenario={scenario} step={step} />}
          {view === "State" && (
            <StateView scenario={scenario} step={step} onSelect={(id) => selectEntity(id)} />
          )}
        </div>

        {inspecting && (
          <aside className="inspector">
            <div className="inspector-top">
              <span>INSPECT ENTITY</span>
              <button aria-label="Close inspector" onClick={() => setInspecting(false)}>
                ×
              </button>
            </div>
            <div className="entity-heading">
              <i />
              <div>
                <strong>{selectedEntity.label}</strong>
                <code>entity:{selectedEntity.id}</code>
              </div>
            </div>
            <dl>
              <div>
                <dt>Presence</dt>
                <dd>
                  <span className="known">{selectedValue ? "present" : "unmodeled"}</span>
                </dd>
              </div>
              <div>
                <dt>Current value</dt>
                <dd>
                  <code>{selectedValue ? selectedValue[1] : "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Frame</dt>
                <dd>#{step} · committed</dd>
              </div>
            </dl>
            <div className="history-title">
              <span>RECORDED HISTORY</span>
              <b>{history.length}</b>
            </div>
            {history.length === 0 && <p className="history-empty">No writes recorded yet.</p>}
            {[...history].reverse().map(([at, value]) => (
              <div className="history-item" key={at}>
                <i />
                <div>
                  <strong>{steps[at].event}</strong>
                  <span>Explicit write · authored · frame #{at}</span>
                  <code>{`{ "${selectedRow?.path}": "${value}" }`}</code>
                </div>
              </div>
            ))}
            <div className="evidence-note">
              <span>CAUSAL EVIDENCE</span>
              <p>No implied events. Only explicitly modeled dependencies are shown.</p>
            </div>
          </aside>
        )}
      </div>

      <footer className="transport">
        <div className="transport-buttons">
          <button aria-label="Previous step" disabled={step === 0} onClick={() => seek(step - 1)}>
            <Icon name="back" />
          </button>
          <button
            className="play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (!playing && step === last) {
                seekRevision.current += 1;
                setStep(0);
              }
              setPlaying((value) => !value);
            }}
          >
            <Icon name={playing ? "pause" : "play"} size={18} />
          </button>
          <button aria-label="Next step" disabled={step === last} onClick={() => seek(step + 1)}>
            <Icon name="forward" />
          </button>
        </div>
        <div className="transport-meta">
          <span>
            <strong>{step + 1}</strong> / {steps.length}
          </span>
          <button
            className="speed"
            aria-label={`Playback speed ${speed}x`}
            onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])}
          >
            {speed}× <Icon name="chevron" size={12} />
          </button>
        </div>
      </footer>

      <details
        className="step-caption"
        open={captionOpen}
        onToggle={(event) => setCaptionOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="step-number">{String(step + 1).padStart(2, "0")}</span>
          <span className="caption-text">
            <strong>{current.title}</strong>
            <span className="teaser">{current.note}</span>
          </span>
          <span className={`event-chip ${current.type.includes("write") ? "write" : ""}`}>
            {current.type}
          </span>
          <span className="caption-expand">
            <span>{captionOpen ? "Less" : "Details"}</span>
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="caption-body">
          <p className="caption-note">{current.note}</p>
          {current.transfers && (
            <ul className="transfers" aria-label="Transfers">
              {current.transfers.map((t) => (
                <li key={t.from + t.to}>
                  {t.from} <b>→</b> {t.to}
                  {t.value && <code>{t.value}</code>}
                </li>
              ))}
            </ul>
          )}
          {(chapter || causal.length > 0) && (
            <section className="guidance" aria-label="Guided explanation">
              {chapter && (
                <div className="chapter-card">
                  <span>CHAPTER</span>
                  <strong>{chapter.title}</strong>
                  {chapter.summary && <p>{chapter.summary}</p>}
                </div>
              )}
              {causal.map((link) => (
                <div className="causal-card" key={link.id}>
                  <span>AUTHORED CAUSE</span>
                  <strong>{link.title}</strong>
                  <dl>
                    <div>
                      <dt>Trigger</dt>
                      <dd>{link.trigger}</dd>
                    </div>
                    <div>
                      <dt>Observed event</dt>
                      <dd>{link.observedEvent}</dd>
                    </div>
                    <div>
                      <dt>State change</dt>
                      <dd>{link.stateChange}</dd>
                    </div>
                    <div>
                      <dt>Consequence</dt>
                      <dd>{link.consequence}</dd>
                    </div>
                  </dl>
                  <p className="evidence">
                    Evidence:{" "}
                    {link.evidence
                      .map((e) => `step ${e.step + 1} (${steps[e.step].title}), event ${e.event + 1}`)
                      .join("; ")}
                  </p>
                </div>
              ))}
            </section>
          )}
          <details className="state-snapshot">
            <summary>Inspect state</summary>
            <dl>
              {scenario.stateRows.map((row) => {
                const change = valueAt(row, step);
                return (
                  <div key={row.entity}>
                    <dt>
                      {entities.find((e) => e.id === row.entity)?.label} <span>({row.entity})</span>
                    </dt>
                    <dd>
                      <code>{change ? change[1] : "—"}</code>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </details>
        </div>
      </details>
    </div>
  );
}

export default function App() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  return (
    <main>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="showcase">
        <div className="eyebrow">
          <span>THROUGHLINE</span>
          <i />
          SCHEMA 2 · REACT PLAYER
        </div>
        {/* A distinct key resets timeline, camera, sound and chapter context per scenario. */}
        <Player key={scenario.id} scenario={scenario} onScenario={setScenarioId} />
        <div className="footnote">
          <span>Arrow keys</span> step <i /> <span>Home / End</span> seek <i /> <span>Space</span>{" "}
          play / pause <i /> Deterministic frames, no inferred state
        </div>
      </section>
    </main>
  );
}
