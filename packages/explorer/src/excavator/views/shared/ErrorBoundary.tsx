import { Component, type ReactNode } from "react";
import { Notice } from "./Section";

/** Shows a product that could not be drawn as a visible error instead of a blank view. */
export class ViewErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Notice tone="error" title="This product could not be drawn" data-excavator-notice="error">
          {this.state.error.message}
        </Notice>
      );
    }
    return this.props.children;
  }
}
