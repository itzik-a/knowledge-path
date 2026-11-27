/* Catches an error while rendering what's inside, so one broken part (a sheet, a view) shows a short message
   with Reload instead of blanking the whole app. `quiet`: show nothing (a sheet that failed to open). */
import { Component, type ReactNode } from "react";

export class Boundary extends Component<{ children: ReactNode; quiet?: boolean; onClose?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.quiet ? "boundary quiet" : "card boundary"} role="alert">
        <p><b>Something didn't load.</b> <span className="muted">This happens when the app was open while a new version came out.</span></p>
        <div className="btn-row">
          <button type="button" className="btn primary sm" onClick={() => location.reload()}>Reload</button>
          {this.props.onClose && <button type="button" className="btn ghost sm" onClick={this.props.onClose}>Close</button>}
        </div>
      </div>
    );
  }
}
