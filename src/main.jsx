import { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

/* Any render crash shows a readable message instead of a white page. */
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#f8fafc", color: "#1e293b", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
          <div style={{ maxWidth: 520 }}>
            <h2 style={{ marginBottom: 10 }}>Something went wrong loading the app</h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "#64748b", marginBottom: 12 }}>
              If this is a fresh deployment, check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the environment settings.
            </p>
            <pre style={{ fontSize: 12, color: "#dc2626", whiteSpace: "pre-wrap", background: "#fef2f2", padding: 12, borderRadius: 8 }}>{String(this.state.error?.message || this.state.error)}</pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
