import { useEffect, useRef } from "react";
import { useDashboardStore } from "../../store";
import { Section } from "./shared/Section";
import ProductRowDetail from "./ProductRowDetail";

/**
 * On a narrow screen the details of the chosen row sit in the view, directly above the
 * table (the sidebar is not on screen there). Brought into view when a row is chosen.
 */
export default function InlineRowDetail() {
  const row = useDashboardStore((s) => s.productRow);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (row !== null) ref.current?.scrollIntoView({ block: "nearest" });
  }, [row]);
  if (row === null) return null;
  return (
    <div ref={ref} data-excavator-row-inline="">
      <Section>
        <ProductRowDetail />
      </Section>
    </div>
  );
}
