/** 메인 캔버스: client + getBoundingClientRect + zoom → 논리 좌표 (EditorPage와 동일 식). */
export function clientToUnscaledCanvasSpace(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
  zoom: number
): { x: number; y: number } {
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom
  };
}

/** 스크롤 영역 중심 → 캔버스 좌표 (기존 식과 동일). */
export function scrollViewportCenterToUnscaledCanvasPosition(
  scrollLeft: number,
  scrollTop: number,
  clientWidth: number,
  clientHeight: number,
  zoom: number,
  nodeWidth: number,
  collapsedNodeHeight: number
): { x: number; y: number } {
  return {
    x: (scrollLeft + clientWidth / 2) / zoom - nodeWidth / 2,
    y: (scrollTop + clientHeight / 2) / zoom - collapsedNodeHeight / 2
  };
}

/** 캔버스 점 → 노드 좌상단 (팔레트 드롭, 기존 식과 동일). */
export function canvasPointToNewNodeTopLeft(
  point: { x: number; y: number },
  nodeWidth: number,
  collapsedNodeHeight: number
): { x: number; y: number } {
  return {
    x: point.x - nodeWidth / 2,
    y: point.y - collapsedNodeHeight / 2
  };
}

/** Failure 캔버스 로컬 드롭 위치 (zoom 없음). topOffset은 기존 리터럴 24 사용. */
export function failureCanvasLocalDropPosition(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
  nodeWidth: number,
  topOffset: number
): { x: number; y: number } {
  return {
    x: clientX - rect.left - nodeWidth / 2,
    y: clientY - rect.top - topOffset
  };
}

/** Failure 캔버스: 포인터를 부모 로컬 좌표로 (기존 nx/ny 식과 동일). */
export function parentLocalPositionFromPointer(
  parentRect: { left: number; top: number },
  clientX: number,
  clientY: number,
  grabOffsetX: number,
  grabOffsetY: number
): { x: number; y: number } {
  return {
    x: clientX - parentRect.left - grabOffsetX,
    y: clientY - parentRect.top - grabOffsetY
  };
}
