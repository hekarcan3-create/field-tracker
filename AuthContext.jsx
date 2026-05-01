import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('ft_token'));
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem('ft_theme') || 'dark');

  useEffect(() => {
    const init = async () => {
      const storedToken = localStorage.getItem('ft_token');
      if (storedToken) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        try {
          // Always fetch fresh user data from server — fixes stale name in localStorage
          const res = await axios.get('/api/auth/me');
          const freshUser = res.data;
          console.log('[Auth] User loaded:', freshUser);
          localStorage.setItem('ft_user', JSON.stringify(freshUser));
          setUser(freshUser);
        } catch (err) {
          console.error('[Auth] Failed to load user:', err);
          // Token expired or invalid — clear everything
          localStorage.removeItem('ft_token');
          localStorage.removeItem('ft_user');
          delete axios.defaults.headers.common['Authorization'];
          setToken(null);
          setUser(null);
        }
      } else {
        console.log('[Auth] No token found');
      }
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ft_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const login = async (email, password) => {
    const res = await axios.post('/api/auth/login', { email, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem('ft_token', t);
    localStorage.setItem('ft_user', JSON.stringify(u));
    axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
    setToken(t);
    setUser(u);
    return u;
  };

  const logout = () => {
    localStorage.removeItem('ft_token');
    localStorage.removeItem('ft_user');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, theme, toggleTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);