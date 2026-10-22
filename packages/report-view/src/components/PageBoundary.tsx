import { Component, type ReactNode } from 'react';

import { ErrorCard } from './ErrorCard';

/** Draws an error card in place of a page that threw while it was drawn. */
export class PageBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    return error ? <ErrorCard title="This page could not be drawn" error={error} /> : this.props.children;
  }
}
