import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';

export default function Login() {
  const [email, setEmail] = useState('analyst@ledgerlight.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.login(email, password);
      navigate('/');
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'login failed');
    }
  }

  return (
    <div className="login-wrap card">
      <h1>Sign in</h1>
      <p className="sub">Viewers can read everything; analysts can run investigations and work the review board.</p>
      <form onSubmit={onSubmit}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" aria-label="email" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="password" aria-label="password" />
        {error && <div className="banner error">{error}</div>}
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
