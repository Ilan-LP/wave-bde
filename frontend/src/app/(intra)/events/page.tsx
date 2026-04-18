'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Member {
  id: number;
  firstName: string;
  lastName: string;
}

interface EventTask {
  id: number;
  title: string;
  status: string;
  assignedTo: { id: number; firstName: string; lastName: string } | null;
}

interface Event {
  id: number;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  status: string;
  budgetCents: number;
  spentCents: number;
  responsible: { id: number; firstName: string; lastName: string } | null;
  tasks?: EventTask[];
}

const STATUS_COLORS: Record<string, string> = {
  IDEE: '#8b5cf6',
  PLANIFIE: '#2563eb',
  EN_COURS: '#d97706',
  TERMINE: '#16a34a',
  ANNULE: '#9ca3af',
};

const STATUS_LABELS: Record<string, string> = {
  IDEE: 'Idée',
  PLANIFIE: 'Planifié',
  EN_COURS: 'En cours',
  TERMINE: 'Terminé',
  ANNULE: 'Annulé',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  A_FAIRE: 'À faire',
  EN_COURS: 'En cours',
  FAIT: 'Fait',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '0.25rem',
};

interface CreateEventForm {
  title: string;
  description: string;
  date: string;
  location: string;
  budgetCents: string;
  responsibleId: string;
}

interface UpdateEventForm {
  title: string;
  description: string;
  date: string;
  location: string;
  status: string;
  budgetCents: string;
  spentCents: string;
  responsibleId: string;
}

export default function EventsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [createForm, setCreateForm] = useState<CreateEventForm>({
    title: '', description: '', date: '', location: '', budgetCents: '0', responsibleId: '',
  });
  const [editForm, setEditForm] = useState<UpdateEventForm>({
    title: '', description: '', date: '', location: '', status: '', budgetCents: '0', spentCents: '0', responsibleId: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get<{ events: Event[] }>('/events'),
    enabled: !!user,
  });

  const { data: membersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: Member[] }>('/users'),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ event: Event }>('/events', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowCreate(false);
      setCreateForm({ title: '', description: '', date: '', location: '', budgetCents: '0', responsibleId: '' });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      api.patch<{ event: Event }>(`/events/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setEditEvent(null);
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const canManage = user?.role === 'ADMIN' || user?.role === 'POLE_LEAD';

  function openEdit(ev: Event) {
    setEditEvent(ev);
    setEditForm({
      title: ev.title,
      description: ev.description ?? '',
      date: ev.date.slice(0, 10),
      location: ev.location ?? '',
      status: ev.status,
      budgetCents: String(ev.budgetCents / 100),
      spentCents: String(ev.spentCents / 100),
      responsibleId: ev.responsible ? String(ev.responsible.id) : '',
    });
    setError('');
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.title || !createForm.date) { setError('Titre et date requis'); return; }
    createMutation.mutate({
      title: createForm.title,
      description: createForm.description || undefined,
      date: createForm.date,
      location: createForm.location || undefined,
      budgetCents: Math.round(parseFloat(createForm.budgetCents) * 100) || 0,
      responsibleId: createForm.responsibleId ? Number(createForm.responsibleId) : undefined,
    });
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editEvent) return;
    updateMutation.mutate({
      id: editEvent.id,
      body: {
        title: editForm.title,
        description: editForm.description || undefined,
        date: editForm.date,
        location: editForm.location || undefined,
        status: editForm.status,
        budgetCents: Math.round(parseFloat(editForm.budgetCents) * 100) || 0,
        spentCents: Math.round(parseFloat(editForm.spentCents) * 100) || 0,
        responsibleId: editForm.responsibleId ? Number(editForm.responsibleId) : undefined,
      },
    });
  }

  if (authLoading) return null;

  const members = membersData?.users ?? [];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 860 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Événements</h2>
          {canManage && (
            <button
              onClick={() => { setShowCreate(true); setError(''); }}
              style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}
            >
              + Ajouter
            </button>
          )}
        </div>

        {isLoading ? (
          <p style={{ color: '#666' }}>Chargement...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(data?.events ?? []).map((event) => (
              <div
                key={event.id}
                style={{
                  background: '#fff',
                  borderRadius: 10,
                  padding: '1.25rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  cursor: canManage ? 'pointer' : 'default',
                }}
                onClick={() => canManage && openEdit(event)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <h3 style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{event.title}</h3>
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>
                      {new Date(event.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {event.location && ` · ${event.location}`}
                    </p>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.625rem',
                    borderRadius: 20,
                    background: `${STATUS_COLORS[event.status] ?? '#9ca3af'}22`,
                    color: STATUS_COLORS[event.status] ?? '#9ca3af',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>
                    {STATUS_LABELS[event.status] ?? event.status}
                  </span>
                </div>
                {event.description && (
                  <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>{event.description}</p>
                )}
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem', color: '#666' }}>
                  <span>Budget : <strong style={{ color: '#1a1a2e' }}>{(event.budgetCents / 100).toFixed(2)} €</strong></span>
                  <span>Dépensé : <strong style={{ color: event.spentCents > event.budgetCents ? '#dc2626' : '#1a1a2e' }}>{(event.spentCents / 100).toFixed(2)} €</strong></span>
                  {event.responsible && (
                    <span>Resp. : <strong style={{ color: '#1a1a2e' }}>{event.responsible.firstName} {event.responsible.lastName}</strong></span>
                  )}
                </div>
                {canManage && (
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>Cliquer pour modifier</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Modal création */}
        {showCreate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Nouvel événement</h3>
              <form onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Titre *</label>
                  <input style={inputStyle} value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} required />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <input type="date" style={inputStyle} value={createForm.date} onChange={e => setCreateForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label style={labelStyle}>Lieu</label>
                  <input style={inputStyle} value={createForm.location} onChange={e => setCreateForm(f => ({ ...f, location: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Budget (€)</label>
                  <input type="number" step="0.01" min="0" style={inputStyle} value={createForm.budgetCents} onChange={e => setCreateForm(f => ({ ...f, budgetCents: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Responsable</label>
                  <select style={inputStyle} value={createForm.responsibleId} onChange={e => setCreateForm(f => ({ ...f, responsibleId: e.target.value }))}>
                    <option value="">— Aucun —</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                    ))}
                  </select>
                </div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => { setShowCreate(false); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                    Annuler
                  </button>
                  <button type="submit" disabled={createMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                    {createMutation.isPending ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal édition */}
        {editEvent && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Modifier l'événement</h3>
              <form onSubmit={submitEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Titre</label>
                  <input style={inputStyle} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" style={inputStyle} value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Lieu</label>
                  <input style={inputStyle} value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Statut</label>
                  <select style={inputStyle} value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Budget (€)</label>
                    <input type="number" step="0.01" min="0" style={inputStyle} value={editForm.budgetCents} onChange={e => setEditForm(f => ({ ...f, budgetCents: e.target.value }))} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Dépensé (€)</label>
                    <input type="number" step="0.01" min="0" style={inputStyle} value={editForm.spentCents} onChange={e => setEditForm(f => ({ ...f, spentCents: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Responsable</label>
                  <select style={inputStyle} value={editForm.responsibleId} onChange={e => setEditForm(f => ({ ...f, responsibleId: e.target.value }))}>
                    <option value="">— Aucun —</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                    ))}
                  </select>
                </div>
                {editEvent.tasks && editEvent.tasks.length > 0 && (
                  <div>
                    <label style={labelStyle}>Tâches</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {editEvent.tasks.map(t => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.4rem 0.6rem', background: '#f9fafb', borderRadius: 6 }}>
                          <span>{t.title}</span>
                          <span style={{ color: '#6b7280' }}>{TASK_STATUS_LABELS[t.status] ?? t.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => { setEditEvent(null); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                    Annuler
                  </button>
                  <button type="submit" disabled={updateMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                    {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
