'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/membres', label: 'Membres' },
  { href: '/buvette', label: 'Buvette' },
  { href: '/avoirs', label: 'Avoirs' },
  { href: '/tresorerie', label: 'Trésorerie' },
  { href: '/stock', label: 'Stock' },
  { href: '/events', label: 'Événements' },
  { href: '/local', label: 'Local' },
  { href: '/partenariats', label: 'Partenariats' },
  { href: '/communication', label: 'Communication' },
  { href: '/serrure', label: 'Serrure' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside style={{
      width: 220,
      minHeight: '100vh',
      background: '#1a1a2e',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      padding: '1.5rem 1rem',
    }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e94560' }}>BDE Intra</h1>
        {user && (
          <p style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '0.25rem' }}>
            {user.firstName} {user.lastName}
            <br />
            <span style={{ color: '#e94560' }}>{user.role}</span>
            {user.pole && <span> · {user.pole}</span>}
          </p>
        )}
      </div>

      <nav style={{ flex: 1 }}>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: 'block',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 6,
                  background: pathname === item.href ? '#e94560' : 'transparent',
                  color: pathname === item.href ? '#fff' : '#ccc',
                  fontSize: '0.9rem',
                  transition: 'background 0.15s',
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <button
        onClick={logout}
        style={{
          marginTop: '1rem',
          padding: '0.5rem 0.75rem',
          background: 'transparent',
          border: '1px solid #444',
          borderRadius: 6,
          color: '#aaa',
          cursor: 'pointer',
          fontSize: '0.85rem',
          textAlign: 'left',
        }}
      >
        Déconnexion
      </button>
    </aside>
  );
}
