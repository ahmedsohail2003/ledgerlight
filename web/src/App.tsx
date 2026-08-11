import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { session } from './api';
import Investigate from './pages/Investigate';
import Briefs from './pages/Briefs';
import BriefDetail from './pages/BriefDetail';
import ReviewBoard from './pages/ReviewBoard';
import Metrics from './pages/Metrics';
import Login from './pages/Login';

export default function App() {
  const navigate = useNavigate();
  const signedIn = Boolean(session.token);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Ledger<span>light</span></div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>Investigate</NavLink>
          <NavLink to="/briefs" className={({ isActive }) => (isActive ? 'active' : '')}>Briefs</NavLink>
          <NavLink to="/reviews" className={({ isActive }) => (isActive ? 'active' : '')}>Review board</NavLink>
          <NavLink to="/metrics" className={({ isActive }) => (isActive ? 'active' : '')}>Metrics</NavLink>
        </nav>
        <div className="whoami">
          {signedIn ? (
            <>
              <span>{session.email} · {session.role}</span>
              <button onClick={() => { session.clear(); navigate('/'); window.location.reload(); }}>Sign out</button>
            </>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Investigate />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/briefs/:id" element={<BriefDetail />} />
        <Route path="/reviews" element={<ReviewBoard />} />
        <Route path="/metrics" element={<Metrics />} />
        <Route path="/login" element={<Login />} />
      </Routes>

      <footer className="footnote">
        Every flag shown is an indicator warranting review, not a finding of wrongdoing. Data: Government of
        Canada Proactive Disclosure of Contracts over $10,000. Briefs are grounding-validated: numbers trace to
        source rows, flags to fired rules, regulation citations to retrieved clauses, and model inferences are
        labeled as such.
      </footer>
    </div>
  );
}
