import { Component } from 'react';
// A render error in one component should show a recoverable message, not a blank white page.
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error('UI crashed:', error, info?.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}><div><h2>Something went wrong</h2><p>The page hit an unexpected error.</p><button className="primary-button" onClick={() => window.location.reload()}>Reload</button></div></div>;
  }
}
