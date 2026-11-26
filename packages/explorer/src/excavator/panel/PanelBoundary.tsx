import { Component, type ReactNode } from "react";

interface Props {
  /** Changes when the selection or the view changes; a failed panel is tried again then. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: string | null;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Keeps a failure of the side panel's content from taking the page down: one muted line says it could not be shown. */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: messageOf(error) };
  }

  componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) this.setState({ error: null });
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return <p className="px-5 py-4 text-xs text-text-muted" data-excavator-panel-error>This panel could not be shown: {this.state.error}</p>;
  }
}
