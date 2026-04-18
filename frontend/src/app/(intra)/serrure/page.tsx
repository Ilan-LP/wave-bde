'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const DISPLAY_SECONDS = 30;

interface AccessLog {
  id: number;
  accessedAt: string;
  ipAddress: string | null;
  user: { id: number; firstName: string; lastName: string };
}

export default function SerrurePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [code, setCode] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data: historyData } = useQuery({
    queryKey: ['lock-history'],
    queryFn: () => api.get<{ logs: AccessLog[] }>('/lock/history'),
    enabled: user?.role === 'ADMIN',
  });

  async function handleShowCode() {
    setFetchError(null);
    setFetching(true);

    try {
      const data = await api.get<{ code: string }>('/lock/code');
      setCode(data.code);
      setCountdown(DISPLAY_SECONDS);

      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setCode(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Erreur lors de la récupération du code');
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 700 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Serrure</h2>

        <div style={{
          background: '#fff',
          borderRadius: 12,
          padding: '2rem',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          marginBottom: '2rem',
          textAlign: 'center',
        }}>
          {code ? (
            <div>
              <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>Code d'accès</p>
              <p style={{
                fontSize: '3rem',
                fontWeight: 800,
                letterSpacing: '0.2em',
                color: '#1a1a2e',
                fontFamily: 'monospace',
                marginBottom: '1rem',
              }}>
                {code}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: countdown > 10 ? '#16a34a' : '#dc2626',
                  animation: 'pulse 1s infinite',
                }} />
                <p style={{ color: countdown > 10 ? '#16a34a' : '#dc2626', fontSize: '0.875rem', fontWeight: 500 }}>
                  Masquage dans {countdown}s
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                Le code est chiffré et n'est visible que sur demande. Chaque consultation est enregistrée.
              </p>
              <button
                onClick={handleShowCode}
                disabled={fetching}
                style={{
                  padding: '0.875rem 2rem',
                  background: '#e94560',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: fetching ? 'not-allowed' : 'pointer',
                  opacity: fetching ? 0.7 : 1,
                }}
              >
                {fetching ? 'Chargement...' : 'Voir le code'}
              </button>

              {fetchError && (
                <p style={{ color: '#dc2626', marginTop: '1rem', fontSize: '0.875rem' }}>{fetchError}</p>
              )}
            </div>
          )}
        </div>

        {user?.role === 'ADMIN' && (
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
              Historique des consultations
            </h3>
            {!historyData?.logs?.length ? (
              <p style={{ color: '#666', fontSize: '0.9rem' }}>Aucune consultation enregistrée.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {historyData.logs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: '0.875rem 1.25rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <p style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                        {log.user.firstName} {log.user.lastName}
                      </p>
                      {log.ipAddress && (
                        <p style={{ fontSize: '0.8rem', color: '#888' }}>IP : {log.ipAddress}</p>
                      )}
                    </div>
                    <p style={{ fontSize: '0.8rem', color: '#888' }}>
                      {new Date(log.accessedAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
