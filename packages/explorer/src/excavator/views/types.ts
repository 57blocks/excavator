import type { ComponentType, ReactNode } from "react";
import type { ProductFileName } from "./productFiles";

/** What a view's body is given: the product file(s) it reads, and the row details to put above its table on a narrow screen. */
export interface ViewBodyProps {
  /** The content of the product's main file. */
  primary: unknown;
  /** The content of its second file (doc-map's checks), or null when the page holds none. */
  secondary: unknown | null;
  /** On a narrow screen the details of the chosen row go in the view, above the table (the sidebar is not on screen); null otherwise. */
  detail: ReactNode;
}

export interface ViewModule {
  /** The product files to read: the main one, and optionally a second that may be absent. */
  files: [ProductFileName] | [ProductFileName, ProductFileName];
  Body: ComponentType<ViewBodyProps>;
  /** The details of a chosen row. */
  Detail: ComponentType<{ row: unknown; onClose: () => void }>;
}
