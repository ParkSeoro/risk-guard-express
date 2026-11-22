/**
 * Custom zero-dependency-on-leaflet-draw interactive drawing & vertex editing layer.
 * Replaces legacy `leaflet-draw` for both CRS.Simple flat drone maps and WGS84 satellite maps:
 * - Polygon: click vertices (panning stays enabled via click-vs-drag threshold), magnetic snap
 *   on vertex #1, double-click / Enter / floating [완료] button all finish cleanly, right-click
 *   or Ctrl+Z / [이전 점 취소] undoes last vertex.
 * - Rectangle & Circle: smooth click-drag OR 2-click draw with real-time meter dimensions.
 * - Edit mode: drag vertices, click/drag edge '+' midpoints to insert, right-click vertex to
 *   delete (>3), drag center handle to move whole shape, drag circle edge handle to resize.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Marker, Polygon, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { Check, Undo2, X } from "lucide-react";
import type { DrawnShape, DrawTool } from "@/components/geofence/LeafletDrawControl";
import {
  buildRectangleRing,
  circleEastHandlePoint,
  computeCircleRadius,
  edgeMidpoints,
  formatMetersLabel,
  insertVertexAt,
  isWithinScreenRadius,
  measureRectangleMeters,
  measureSegmentMeters,
  polygonCentroid,
  removeVertexAt,
  translatePolygon,
  type CoordinateMode,
  type DrawPoint,
} from "@/lib/geofence/interactiveDrawGeometry";

type Props = {
  enabled?: boolean;
  activeTool?: DrawTool | null;
  drawColor?: string;
  coordinateMode: CoordinateMode;
  /** Meters per 1 CRS unit (only used when coordinateMode === "crs" for live meter readout). */
  metersPerUnit?: number;
  onShapeCreated?: (shape: DrawnShape) => void;
  onToolFinished?: () => void;
  editShape?: DrawnShape | null;
  editCommitToken?: number;
  onShapeEdited?: (shape: DrawnShape) => void;
};

const SNAP_RADIUS_PX = 16;
const CLICK_DRAG_THRESHOLD_PX = 6;
const DUPLICATE_CLICK_PX = 8;

function makeVertexIcon(label: string, color: string, opts?: { snap?: boolean }) {
  const size = opts?.snap ? 24 : 20;
  const ring = opts?.snap
    ? "box-shadow:0 0 0 4px rgba(16,185,129,0.45),0 2px 6px rgba(0,0,0,0.4);border-color:#10b981;"
    : `box-shadow:0 1px 4px rgba(0,0,0,0.45);border-color:${color};`;
  return L.divIcon({
    className: "interactive-draw-vertex",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:#ffffff;border:2.5px solid;${ring}display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0f172a;user-select:none;cursor:pointer;">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeMidpointIcon() {
  return L.divIcon({
    className: "interactive-draw-midpoint",
    html: `<div style="width:16px;height:16px;border-radius:9999px;background:rgba(255,255,255,0.88);border:1.5px solid #475569;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#334155;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;">+</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function makeMoveHandleIcon(color: string) {
  return L.divIcon({
    className: "interactive-draw-move",
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:${color};border:2px solid #ffffff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:move;">✥</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function InteractiveLeafletDraw({
  enabled = true,
  activeTool = null,
  drawColor = "#ef4444",
  coordinateMode,
  metersPerUnit = 1,
  onShapeCreated,
  onToolFinished,
  editShape = null,
  editCommitToken = 0,
  onShapeEdited,
}: Props) {
  const map = useMap();

  // Drawing states
  const [polyPts, setPolyPts] = useState<DrawPoint[]>([]);
  const [cursorPt, setCursorPt] = useState<DrawPoint | null>(null);
  const [snapToFirst, setSnapToFirst] = useState(false);
  const [dragOrigin, setDragOrigin] = useState<DrawPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<DrawPoint | null>(null);

  // Edit states
  const [editPoly, setEditPoly] = useState<DrawPoint[] | null>(null);
  const [editCircle, setEditCircle] = useState<{ center: DrawPoint; radius: number } | null>(null);

  const polyPtsRef = useRef<DrawPoint[]>([]);
  polyPtsRef.current = polyPts;
  const dragOriginRef = useRef<DrawPoint | null>(null);
  dragOriginRef.current = dragOrigin;
  const dragCurrentRef = useRef<DrawPoint | null>(null);
  dragCurrentRef.current = dragCurrent;
  const mouseDownPxRef = useRef<{ x: number; y: number } | null>(null);
  const draggingWasEnabledRef = useRef(true);
  const lastCommitTokenRef = useRef(0);
  const moveStartRef = useRef<DrawPoint | null>(null);
  const editPolyRef = useRef<DrawPoint[] | null>(null);
  editPolyRef.current = editPoly;
  const editCircleRef = useRef<{ center: DrawPoint; radius: number } | null>(null);
  editCircleRef.current = editCircle;

  const isDrawing = enabled && !editShape && !!activeTool;
  const isEditing = enabled && !!editShape;

  // Reset draft whenever activeTool changes or drawing ends
  useEffect(() => {
    setPolyPts([]);
    setCursorPt(null);
    setSnapToFirst(false);
    setDragOrigin(null);
    setDragCurrent(null);
  }, [activeTool, editShape, enabled]);

  // Seed edit state when editShape changes
  const editShapeKey = editShape
    ? editShape.kind === "circle"
      ? `c:${editShape.center.lat},${editShape.center.lng},${editShape.radius_m}`
      : `p:${editShape.latlngs.map((p) => `${p.lat},${p.lng}`).join(";")}`
    : "";

  useEffect(() => {
    if (!isEditing || !editShape) {
      setEditPoly(null);
      setEditCircle(null);
      return;
    }
    if (editShape.kind === "polygon") {
      setEditPoly(editShape.latlngs.map((p) => ({ lat: p.lat, lng: p.lng })));
      setEditCircle(null);
    } else {
      setEditCircle({
        center: { lat: editShape.center.lat, lng: editShape.center.lng },
        radius: editShape.radius_m,
      });
      setEditPoly(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, editShapeKey]);

  // Flush edit state when parent bumps editCommitToken
  useEffect(() => {
    if (!editCommitToken || editCommitToken === lastCommitTokenRef.current) return;
    lastCommitTokenRef.current = editCommitToken;
    if (!onShapeEdited) return;
    if (editPolyRef.current && editPolyRef.current.length >= 3) {
      onShapeEdited({ kind: "polygon", latlngs: editPolyRef.current });
    } else if (editCircleRef.current && editCircleRef.current.radius > 0) {
      onShapeEdited({
        kind: "circle",
        center: editCircleRef.current.center,
        radius_m: Math.round(editCircleRef.current.radius * 10) / 10,
      });
    }
  }, [editCommitToken, onShapeEdited]);

  const finishPolygon = useCallback(() => {
    const pts = polyPtsRef.current;
    if (pts.length < 3) return;
    onShapeCreated?.({ kind: "polygon", latlngs: pts });
    setPolyPts([]);
    setCursorPt(null);
    setSnapToFirst(false);
    onToolFinished?.();
  }, [onShapeCreated, onToolFinished]);

  const undoLastVertex = useCallback(() => {
    setPolyPts((prev) => prev.slice(0, -1));
    setSnapToFirst(false);
  }, []);

  const cancelDraw = useCallback(() => {
    setPolyPts([]);
    setCursorPt(null);
    setSnapToFirst(false);
    setDragOrigin(null);
    setDragCurrent(null);
    onToolFinished?.();
  }, [onToolFinished]);

  // Manage cursor & map gestures during drawing
  useEffect(() => {
    const container = map.getContainer();
    if (!isDrawing) {
      container.style.cursor = "";
      return;
    }

    container.style.cursor = "crosshair";
    map.doubleClickZoom?.disable?.();

    // Rectangle & circle use click-drag, so temporarily disable map panning only for those two.
    // Polygon keeps panning ENABLED (click < 6px adds vertex; drag >= 6px pans!).
    const disablePan = activeTool === "rectangle" || activeTool === "circle";
    if (disablePan) {
      draggingWasEnabledRef.current = map.dragging.enabled();
      map.dragging.disable();
    }

    return () => {
      container.style.cursor = "";
      map.doubleClickZoom?.enable?.();
      if (disablePan && draggingWasEnabledRef.current) {
        map.dragging.enable();
      }
    };
  }, [map, isDrawing, activeTool]);

  // Keyboard shortcuts (Esc, Enter, Ctrl+Z / Backspace)
  useEffect(() => {
    if (!isDrawing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDraw();
      } else if (e.key === "Enter" && activeTool === "polygon" && polyPtsRef.current.length >= 3) {
        e.preventDefault();
        finishPolygon();
      } else if (
        activeTool === "polygon" &&
        ((e.key === "z" && (e.ctrlKey || e.metaKey)) || e.key === "Backspace")
      ) {
        if (polyPtsRef.current.length > 0) {
          e.preventDefault();
          undoLastVertex();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDrawing, activeTool, cancelDraw, finishPolygon, undoLastVertex]);

  // Map mouse/pointer events for drawing
  useEffect(() => {
    if (!isDrawing || !activeTool) return;

    if (activeTool === "polygon") {
      const onMouseDown = (e: L.LeafletMouseEvent) => {
        if (e.originalEvent.button !== 0) return;
        mouseDownPxRef.current = { x: e.containerPoint.x, y: e.containerPoint.y };
      };

      const onMouseMove = (e: L.LeafletMouseEvent) => {
        const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
        setCursorPt(pt);
        const pts = polyPtsRef.current;
        if (pts.length >= 3) {
          const firstPx = map.latLngToContainerPoint([pts[0].lat, pts[0].lng]);
          setSnapToFirst(isWithinScreenRadius(e.containerPoint, firstPx, SNAP_RADIUS_PX));
        } else {
          setSnapToFirst(false);
        }
      };

      const onClick = (e: L.LeafletMouseEvent) => {
        // Ignore clicks that were actually pan drags
        const down = mouseDownPxRef.current;
        mouseDownPxRef.current = null;
        if (down && !isWithinScreenRadius(down, e.containerPoint, CLICK_DRAG_THRESHOLD_PX)) {
          return;
        }

        const pts = polyPtsRef.current;
        // Snap-close on first vertex
        if (pts.length >= 3) {
          const firstPx = map.latLngToContainerPoint([pts[0].lat, pts[0].lng]);
          if (isWithinScreenRadius(e.containerPoint, firstPx, SNAP_RADIUS_PX)) {
            finishPolygon();
            return;
          }
        }

        // Ignore near-duplicate click (e.g. 2nd click of a double-click)
        if (pts.length >= 1) {
          const lastPx = map.latLngToContainerPoint([
            pts[pts.length - 1].lat,
            pts[pts.length - 1].lng,
          ]);
          if (isWithinScreenRadius(e.containerPoint, lastPx, DUPLICATE_CLICK_PX)) {
            return;
          }
        }

        setPolyPts((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
      };

      const onDblClick = (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e.originalEvent);
        L.DomEvent.preventDefault(e.originalEvent);
        if (polyPtsRef.current.length >= 3) {
          finishPolygon();
        }
      };

      const onContextMenu = (e: L.LeafletMouseEvent) => {
        L.DomEvent.preventDefault(e.originalEvent);
        if (polyPtsRef.current.length > 0) {
          undoLastVertex();
        }
      };

      map.on("mousedown", onMouseDown);
      map.on("mousemove", onMouseMove);
      map.on("click", onClick);
      map.on("dblclick", onDblClick);
      map.on("contextmenu", onContextMenu);
      return () => {
        map.off("mousedown", onMouseDown);
        map.off("mousemove", onMouseMove);
        map.off("click", onClick);
        map.off("dblclick", onDblClick);
        map.off("contextmenu", onContextMenu);
      };
    }

    // Rectangle & Circle: supports both click-drag AND 2-click!
    const commitDragShape = (origin: DrawPoint, end: DrawPoint) => {
      if (activeTool === "rectangle") {
        const p1 = map.latLngToContainerPoint([origin.lat, origin.lng]);
        const p2 = map.latLngToContainerPoint([end.lat, end.lng]);
        if (isWithinScreenRadius(p1, p2, 8)) return false;
        onShapeCreated?.({ kind: "polygon", latlngs: buildRectangleRing(origin, end) });
        setDragOrigin(null);
        setDragCurrent(null);
        onToolFinished?.();
        return true;
      }
      if (activeTool === "circle") {
        const p1 = map.latLngToContainerPoint([origin.lat, origin.lng]);
        const p2 = map.latLngToContainerPoint([end.lat, end.lng]);
        if (isWithinScreenRadius(p1, p2, 6)) return false;
        const { mapRadius } = computeCircleRadius(origin, end, coordinateMode, metersPerUnit);
        if (!(mapRadius > 0)) return false;
        onShapeCreated?.({ kind: "circle", center: origin, radius_m: mapRadius });
        setDragOrigin(null);
        setDragCurrent(null);
        onToolFinished?.();
        return true;
      }
      return false;
    };

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (!dragOriginRef.current) {
        setDragOrigin(pt);
        setDragCurrent(pt);
      } else {
        // 2nd click completes 2-click draw
        commitDragShape(dragOriginRef.current, pt);
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!dragOriginRef.current) return;
      setDragCurrent({ lat: e.latlng.lat, lng: e.latlng.lng });
    };

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const end = { lat: e.latlng.lat, lng: e.latlng.lng };
      const p1 = map.latLngToContainerPoint([origin.lat, origin.lng]);
      const p2 = map.latLngToContainerPoint([end.lat, end.lng]);
      // If user dragged > 10px, finish immediately; otherwise wait for 2nd click
      if (!isWithinScreenRadius(p1, p2, 10)) {
        commitDragShape(origin, end);
      }
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
    };
  }, [
    map,
    isDrawing,
    activeTool,
    coordinateMode,
    metersPerUnit,
    finishPolygon,
    undoLastVertex,
    onShapeCreated,
    onToolFinished,
  ]);

  // Live dimension pill text
  const liveDimension = useMemo(() => {
    if (activeTool === "polygon" && polyPts.length >= 1 && cursorPt) {
      const last = polyPts[polyPts.length - 1];
      const segM = measureSegmentMeters(last, cursorPt, coordinateMode, metersPerUnit);
      return `현재 변 ${formatMetersLabel(segM)}`;
    }
    if (activeTool === "rectangle" && dragOrigin && dragCurrent) {
      const { widthM, heightM } = measureRectangleMeters(
        dragOrigin,
        dragCurrent,
        coordinateMode,
        metersPerUnit,
      );
      return `${formatMetersLabel(widthM)} × ${formatMetersLabel(heightM)}`;
    }
    if (activeTool === "circle" && dragOrigin && dragCurrent) {
      const { displayMeters } = computeCircleRadius(
        dragOrigin,
        dragCurrent,
        coordinateMode,
        metersPerUnit,
      );
      return `반경 ${formatMetersLabel(displayMeters)}`;
    }
    if (isEditing && editCircle) {
      const displayM =
        coordinateMode === "wgs84"
          ? editCircle.radius
          : editCircle.radius * Math.max(metersPerUnit, 0);
      return `반경 ${formatMetersLabel(displayM)}`;
    }
    return null;
  }, [
    activeTool,
    polyPts,
    cursorPt,
    dragOrigin,
    dragCurrent,
    coordinateMode,
    metersPerUnit,
    isEditing,
    editCircle,
  ]);

  const rectPreviewRing = useMemo(() => {
    if (activeTool !== "rectangle" || !dragOrigin || !dragCurrent) return null;
    return buildRectangleRing(dragOrigin, dragCurrent);
  }, [activeTool, dragOrigin, dragCurrent]);

  const circlePreview = useMemo(() => {
    if (activeTool !== "circle" || !dragOrigin || !dragCurrent) return null;
    const { mapRadius } = computeCircleRadius(dragOrigin, dragCurrent, coordinateMode, metersPerUnit);
    if (!(mapRadius > 0)) return null;
    return { center: dragOrigin, radius: mapRadius };
  }, [activeTool, dragOrigin, dragCurrent, coordinateMode, metersPerUnit]);

  const editMidpoints = useMemo(() => (editPoly ? edgeMidpoints(editPoly) : []), [editPoly]);
  const editCenter = useMemo(() => (editPoly ? polygonCentroid(editPoly) : null), [editPoly]);
  const editCircleEdge = useMemo(() => {
    if (!editCircle) return null;
    return circleEastHandlePoint(editCircle.center, editCircle.radius, coordinateMode);
  }, [editCircle, coordinateMode]);

  const stopEvent = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* Floating interactive control bar while drawing */}
      {isDrawing && (
        <div
          data-testid="interactive-draw-bar"
          onMouseDown={stopEvent}
          onClick={stopEvent}
          onDoubleClick={stopEvent}
          className="pointer-events-auto absolute top-3 left-1/2 z-[1200] flex max-w-[94%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
        >
          <span className="font-medium text-foreground">
            {activeTool === "polygon"
              ? polyPts.length === 0
                ? "다각형: 도면을 클릭해 첫 꼭짓점을 찍으세요 (드래그로 이동·휠 확대)"
                : polyPts.length < 3
                  ? `다각형: ${polyPts.length}점 찍힘 · 최소 3점 필요`
                  : snapToFirst
                    ? "첫 점에 스냅됨 — 클릭하면 닫힙니다!"
                    : `다각형: ${polyPts.length}점 · 더블클릭 / 첫 점 클릭 / 완료 버튼`
              : activeTool === "rectangle"
                ? dragOrigin
                  ? "사각형: 반대쪽 모서리를 놓거나 클릭하세요"
                  : "사각형: 드래그하거나 두 모서리를 클릭하세요"
                : dragOrigin
                  ? "원형: 바깥을 놓거나 클릭해 반경을 확정하세요"
                  : "원형: 중심에서 드래그하거나 중심→바깥을 클릭하세요"}
          </span>

          {liveDimension && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              {liveDimension}
            </span>
          )}

          {activeTool === "polygon" && polyPts.length > 0 && (
            <button
              type="button"
              onClick={undoLastVertex}
              className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-medium hover:bg-muted"
            >
              <Undo2 className="h-3.5 w-3.5" /> 이전 점 취소
            </button>
          )}

          {activeTool === "polygon" && polyPts.length >= 3 && (
            <button
              type="button"
              onClick={finishPolygon}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Check className="h-3.5 w-3.5" /> 그리기 완료 ({polyPts.length}점)
            </button>
          )}

          <button
            type="button"
            onClick={cancelDraw}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> 취소
          </button>
        </div>
      )}

      {/* Floating readout pill in edit mode */}
      {isEditing && (
        <div
          data-testid="interactive-edit-bar"
          onMouseDown={stopEvent}
          onClick={stopEvent}
          className="pointer-events-auto absolute top-3 left-1/2 z-[1200] flex max-w-[94%] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-50/95 px-3 py-1.5 text-[11px] font-medium text-amber-950 shadow-md dark:bg-amber-950/90 dark:text-amber-50"
        >
          <span>
            {editPoly
              ? "도형 수정: 숫자 점 드래그 · 변 중간(+)으로 점 추가 · 점 우클릭 삭제 · ✥ 전체 이동 → 「도형 저장」"
              : "원형 수정: ✥ 중심 이동 · 바깥 점 드래그로 반경 조절 → 「도형 저장」"}
          </span>
          {liveDimension && (
            <span className="rounded bg-amber-600/15 px-1.5 py-0.5 font-semibold">
              {liveDimension}
            </span>
          )}
        </div>
      )}

      {/* Polygon draw preview */}
      {isDrawing && activeTool === "polygon" && polyPts.length >= 3 && (
        <Polygon
          positions={[...polyPts, ...(cursorPt && !snapToFirst ? [cursorPt] : [])].map(
            (p) => [p.lat, p.lng] as [number, number],
          )}
          pathOptions={{ color: drawColor, weight: 2, fillOpacity: 0.22, dashArray: "6 4" }}
          interactive={false}
        />
      )}
      {isDrawing && activeTool === "polygon" && polyPts.length >= 1 && (
        <Polyline
          positions={[
            ...polyPts,
            ...(cursorPt ? [snapToFirst ? polyPts[0] : cursorPt] : []),
          ].map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: snapToFirst ? "#10b981" : drawColor, weight: 2.5, dashArray: "6 4" }}
          interactive={false}
        />
      )}
      {isDrawing &&
        activeTool === "polygon" &&
        polyPts.map((p, idx) => (
          <Marker
            key={`draw-v-${idx}`}
            position={[p.lat, p.lng]}
            icon={makeVertexIcon(String(idx + 1), drawColor, {
              snap: idx === 0 && snapToFirst,
            })}
            eventHandlers={
              idx === 0 && polyPts.length >= 3
                ? {
                    click: (ev) => {
                      L.DomEvent.stopPropagation(ev.originalEvent);
                      finishPolygon();
                    },
                  }
                : undefined
            }
          />
        ))}

      {/* Rectangle draw preview */}
      {isDrawing && rectPreviewRing && (
        <Polygon
          positions={rectPreviewRing.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: drawColor, weight: 2.5, fillOpacity: 0.22, dashArray: "6 4" }}
          interactive={false}
        />
      )}

      {/* Circle draw preview */}
      {isDrawing && circlePreview && (
        <Circle
          center={[circlePreview.center.lat, circlePreview.center.lng]}
          radius={circlePreview.radius}
          pathOptions={{ color: drawColor, weight: 2.5, fillOpacity: 0.22, dashArray: "6 4" }}
          interactive={false}
        />
      )}

      {/* Edit mode: Polygon */}
      {isEditing && editPoly && editPoly.length >= 3 && (
        <>
          <Polygon
            positions={editPoly.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: drawColor, weight: 3, fillOpacity: 0.28, dashArray: "6 3" }}
            interactive={false}
          />
          {editPoly.map((p, idx) => (
            <Marker
              key={`edit-v-${idx}`}
              position={[p.lat, p.lng]}
              draggable
              icon={makeVertexIcon(String(idx + 1), drawColor)}
              eventHandlers={{
                drag: (ev) => {
                  const ll = (ev.target as L.Marker).getLatLng();
                  setEditPoly((prev) =>
                    prev
                      ? prev.map((pt, i) => (i === idx ? { lat: ll.lat, lng: ll.lng } : pt))
                      : prev,
                  );
                },
                contextmenu: (ev) => {
                  L.DomEvent.preventDefault(ev.originalEvent);
                  setEditPoly((prev) => (prev ? removeVertexAt(prev, idx) : prev));
                },
              }}
            />
          ))}
          {editMidpoints.map((mid, idx) => (
            <Marker
              key={`edit-mid-${idx}`}
              position={[mid.lat, mid.lng]}
              icon={makeMidpointIcon()}
              eventHandlers={{
                click: (ev) => {
                  L.DomEvent.stopPropagation(ev.originalEvent);
                  setEditPoly((prev) => (prev ? insertVertexAt(prev, idx, mid) : prev));
                },
              }}
            />
          ))}
          {editCenter && (
            <Marker
              position={[editCenter.lat, editCenter.lng]}
              draggable
              icon={makeMoveHandleIcon(drawColor)}
              eventHandlers={{
                dragstart: (ev) => {
                  const ll = (ev.target as L.Marker).getLatLng();
                  moveStartRef.current = { lat: ll.lat, lng: ll.lng };
                },
                drag: (ev) => {
                  const start = moveStartRef.current;
                  if (!start) return;
                  const ll = (ev.target as L.Marker).getLatLng();
                  const dLat = ll.lat - start.lat;
                  const dLng = ll.lng - start.lng;
                  moveStartRef.current = { lat: ll.lat, lng: ll.lng };
                  setEditPoly((prev) => (prev ? translatePolygon(prev, dLat, dLng) : prev));
                },
                dragend: () => {
                  moveStartRef.current = null;
                },
              }}
            />
          )}
        </>
      )}

      {/* Edit mode: Circle */}
      {isEditing && editCircle && (
        <>
          <Circle
            center={[editCircle.center.lat, editCircle.center.lng]}
            radius={editCircle.radius}
            pathOptions={{ color: drawColor, weight: 3, fillOpacity: 0.28, dashArray: "6 3" }}
            interactive={false}
          />
          <Marker
            position={[editCircle.center.lat, editCircle.center.lng]}
            draggable
            icon={makeMoveHandleIcon(drawColor)}
            eventHandlers={{
              drag: (ev) => {
                const ll = (ev.target as L.Marker).getLatLng();
                setEditCircle((prev) =>
                  prev ? { ...prev, center: { lat: ll.lat, lng: ll.lng } } : prev,
                );
              },
            }}
          />
          {editCircleEdge && (
            <Marker
              position={[editCircleEdge.lat, editCircleEdge.lng]}
              draggable
              icon={makeVertexIcon("↔", drawColor)}
              eventHandlers={{
                drag: (ev) => {
                  const ll = (ev.target as L.Marker).getLatLng();
                  setEditCircle((prev) => {
                    if (!prev) return prev;
                    const { mapRadius } = computeCircleRadius(
                      prev.center,
                      { lat: ll.lat, lng: ll.lng },
                      coordinateMode,
                      metersPerUnit,
                    );
                    if (!(mapRadius > 0)) return prev;
                    return { ...prev, radius: mapRadius };
                  });
                },
              }}
            />
          )}
        </>
      )}
    </>
  );
}
