import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Cloud, Smartphone, WifiOff } from "lucide-react";
import { config } from "../config";
import AccountForm from "../components/AccountForm";
import type { AppState } from "../useAppState";

/** Landing page for first visits. Replace the copy for your product. */
export default function Welcome({ app }: { app: AppState }) {
  const [account, setAccount] = useState(false);
  return (
    <main id="main" className="welcome">
      <div className="welcome-card">
        <p className="eyebrow">{config.name}</p>
        <h1>{config.tagline}</h1>
        <p className="lead">{config.description}</p>
        <ul className="features">
          <li>
            <WifiOff aria-hidden size={20} /> Works offline once loaded
          </li>
          <li>
            <Cloud aria-hidden size={20} /> Optional account to use your data on
            every device
          </li>
          <li>
            <Smartphone aria-hidden size={20} /> On the web, iPhone and Android
          </li>
        </ul>
        {account ? (
          <AccountForm connect={app.connect} offline={app.offline} />
        ) : (
          <button className="primary wide" onClick={() => setAccount(true)}>
            Create account or sign in
          </button>
        )}
        <div className="secondary-choices">
          <button className="text" onClick={() => void app.useDevice()}>
            Use on this device <ArrowRight size={16} aria-hidden />
          </button>
          <button className="text" onClick={() => void app.startDemo()}>
            Explore with sample data
          </button>
        </div>
        <p className="muted small">
          <Link to="/privacy">Privacy</Link> ·{" "}
          <Link to="/support">Support</Link>
        </p>
      </div>
    </main>
  );
}
