'use client';

import { useAuth } from '@/context/AuthContext';
import { Sidebar } from '@/components/Sidebar';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) return <div style={{ padding: '2rem' }}>Chargement...</div>;
  if (!user) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
          Bonjour, {user.firstName} !
        </h2>
        <p style={{ color: '#666' }}>
          Bienvenue sur l'intranet BDE. Utilisez la navigation pour accéder aux différents modules.
        </p>
      </main>
    </div>
  );
}
