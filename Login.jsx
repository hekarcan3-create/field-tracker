import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, theme, toggleTheme } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'manager' ? '/manager' : '/employee');
    } catch {
      setError('Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (e, p) => { setEmail(e); setPassword(p); };

  return (
    <div style={styles.page}>
      <div style={styles.background}>
        <div style={styles.gridOverlay} />
      </div>

      <div style={styles.container} className="animate-fade-in">
        {/* Theme Toggle */}
        <button 
          onClick={toggleTheme} 
          style={styles.themeToggle}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>

        {/* Logo */}
        <div style={styles.logo}>
          <div style={styles.logoIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
          </div>
          <div>
            <div style={styles.logoTitle}>Avail Co.</div>
            <div style={styles.logoSub}>Employee Tracking System</div>
          </div>
        </div>

        <div style={styles.card} className="card">
          <h2 style={styles.title}>Welcome Back</h2>
          <p style={styles.subtitle}>Sign in to your account to continue</p>

          {error && (
            <div style={styles.errorBox} className="animate-slide-in">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={styles.form}>
            <div>
              <label>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required />
            </div>
            <div>
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? (
                <>
                  <span className="animate-spin" style={{ width:16,height:16,border:'2px solid #000',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block' }}/>
                  Signing in...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                  </svg>
                  Sign In
                </>
              )}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', position: 'relative', boxSizing: 'border-box' },
  background: { position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 30% 20%, rgba(0,136,255,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(0,212,170,0.06) 0%, transparent 60%)', zIndex: 0 },
  gridOverlay: { position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: '40px 40px' },
  container: { position: 'relative', zIndex: 1, width: '100%', maxWidth: '420px', minWidth: '280px' },
  themeToggle: { position: 'absolute', top: '-50px', right: '0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)', transition: 'all 0.2s', zIndex: 10 },
  logo: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px', justifyContent: 'center', flexWrap: 'wrap' },
  logoIcon: { width: '48px', height: '48px', background: 'var(--accent)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', flexShrink: 0 },
  logoTitle: { fontSize: 'clamp(18px, 5vw, 22px)', fontWeight: 700, letterSpacing: '-0.5px', textAlign: 'center' },
  logoSub: { fontSize: '11px', color: 'var(--text2)', fontFamily: 'var(--mono)', textAlign: 'center' },
  card: { padding: '24px', width: '100%' },
  title: { fontSize: 'clamp(18px, 4vw, 22px)', fontWeight: 700, marginBottom: '8px', textAlign: 'center' },
  subtitle: { color: 'var(--text2)', fontSize: '13px', marginBottom: '20px', textAlign: 'center' },
  errorBox: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: '8px', color: '#ff4757', fontSize: '12px', marginBottom: '16px', wordBreak: 'break-word' },
  form: { display: 'flex', flexDirection: 'column', gap: '14px' },
  hints: { marginTop: '16px', textAlign: 'center' },
  hintsTitle: { fontSize: '10px', color: 'var(--text2)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' },
  hintsList: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' },
  hintBtn: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '2px', transition: 'border-color 0.2s', minWidth: '120px', flex: '1', maxWidth: '160px', minHeight: '44px' },
  hintRole: { fontSize: '10px', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  hintEmail: { fontSize: '11px', color: 'var(--text2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' },
};
