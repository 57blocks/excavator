// Shared layer color palette: used by LayerClusterNode, ContainerNode and PortalNode.
export const LAYER_PALETTE = [
  { bg: "rgba(74, 124, 155, 0.12)", border: "rgba(74, 124, 155, 0.4)", label: "#4a7c9b" },
  { bg: "rgba(90, 158, 111, 0.12)", border: "rgba(90, 158, 111, 0.4)", label: "#5a9e6f" },
  { bg: "rgba(139, 111, 176, 0.12)", border: "rgba(139, 111, 176, 0.4)", label: "#8b6fb0" },
  { bg: "rgba(201, 160, 108, 0.12)", border: "rgba(201, 160, 108, 0.4)", label: "#c9a06c" },
  { bg: "rgba(176, 122, 138, 0.12)", border: "rgba(176, 122, 138, 0.4)", label: "#b07a8a" },
  { bg: "rgba(74, 155, 140, 0.12)", border: "rgba(74, 155, 140, 0.4)", label: "#4a9b8c" },
  { bg: "rgba(120, 130, 145, 0.12)", border: "rgba(120, 130, 145, 0.4)", label: "#788291" },
];

export function getLayerColor(index: number) {
  return LAYER_PALETTE[index % LAYER_PALETTE.length];
}
