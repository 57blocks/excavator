import { Badge, type BadgeTone } from "../shared/Controls";

const CONFIDENCE_TONE: Record<string, BadgeTone> = { high: "bad", medium: "warn", low: "neutral" };

/** A confidence as a toned badge; none for a row without one. */
export const confidenceBadge = (confidence: string | null) => (confidence === null ? null : <Badge tone={CONFIDENCE_TONE[confidence] ?? "neutral"}>{confidence}</Badge>);
