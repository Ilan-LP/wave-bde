'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Partner {
  id: number;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  status: string;
  category: string | null;
  responsible: { id: number; firstName: string; lastName: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PROSPECT: '#8b5cf6',
  NEGOCIATION: '#d97706',
  ACTIF: '#16a34a',
  ARCHIVE: '#9ca3af',
};

const STATUS_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  NEGOCIATION: 'Négociation',
  ACTIF: 'Actif',
  ARCHIVE: 'Archivé',
};

export default function PartenariatsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['partners'],
    queryFn: () => api.get<{ partners: Partner[] }>('/partners'),
    enabled: !!user,
  });

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 800 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Partenariats</h2>
        {isLoading ? (
          <p style={{ color: '#666' }}>Chargement...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(data?.partners ?? []).map((partner) => (
              <div
                key={partner.id}
                style={{
                  background: '#fff',
                  borderRadius: 10,
                  padding: '1.25rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: '1rem',
                }}
              >
                <div>
                  <p style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{partner.name}</p>
                  <p style={{ fontSize: '0.85rem', color: '#666' }}>
                    {partner.contactName ?? 'Sans contact'}
                    {partner.contactEmail && ` · ${partner.contactEmail}`}
                    {partner.category && ` · ${partner.category}`}
                  </p>
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.625rem',
                  borderRadius: 20,
                  background: `${STATUS_COLORS[partner.status] ?? '#9ca3af'}22`,
                  color: STATUS_COLORS[partner.status] ?? '#9ca3af',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {STATUS_LABELS[partner.status] ?? partner.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
