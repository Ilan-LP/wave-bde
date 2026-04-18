'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Post {
  id: number;
  platform: string;
  title: string;
  caption: string | null;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  responsible: { id: number; firstName: string; lastName: string } | null;
  event: { id: number; title: string } | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: '#e1306c',
  LINKEDIN: '#0a66c2',
  TIKTOK: '#010101',
  AUTRE: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  IDEE: 'Idée',
  PLANIFIE: 'Planifié',
  PUBLIE: 'Publié',
  ANNULE: 'Annulé',
};

export default function CommunicationPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['communication'],
    queryFn: () => api.get<{ posts: Post[] }>('/communication'),
    enabled: !!user,
  });

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 800 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Communication</h2>
        {isLoading ? (
          <p style={{ color: '#666' }}>Chargement...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(data?.posts ?? []).map((post) => (
              <div
                key={post.id}
                style={{
                  background: '#fff',
                  borderRadius: 10,
                  padding: '1.25rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 6,
                      background: PLATFORM_COLORS[post.platform] ?? '#6b7280',
                      color: '#fff',
                      fontWeight: 700,
                    }}>
                      {post.platform}
                    </span>
                    <p style={{ fontWeight: 600 }}>{post.title}</p>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>{STATUS_LABELS[post.status] ?? post.status}</span>
                </div>
                {post.caption && <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.375rem' }}>{post.caption}</p>}
                <p style={{ fontSize: '0.8rem', color: '#888' }}>
                  {post.scheduledAt && `Prévu le ${new Date(post.scheduledAt).toLocaleDateString('fr-FR')}`}
                  {post.event && ` · Lié à "${post.event.title}"`}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
