'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Shift {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  type: string;
  note: string | null;
  user: { id: number; firstName: string; lastName: string } | null;
}

interface Member {
  id: number;
  firstName: string;
  lastName: string;
}

const STATUS_COLORS: Record<string, string> = {
  OUVERT: '#2563eb',
  ASSIGNE: '#d97706',
  CONFIRME: '#16a34a',
  ECHANGE_DEMANDE: '#8b5cf6',
};

const STATUS_LABELS: Record<string, string> = {
  OUVERT: 'Ouvert',
  ASSIGNE: 'Assigné',
  CONFIRME: 'Confirmé',
  ECHANGE_DEMANDE: 'Échange demandé',
};

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const inp: React.CSSProperties = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' };

function getWeekDates(anchor: Date): Date[] {
  const d = new Date(anchor);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd;
  });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function LocalPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [error, setError] = useState('');

  const [createForm, setCreateForm] = useState({
    date: '', startTime: '09:00', endTime: '12:00', userId: '', note: '',
  });

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['permanences'],
    queryFn: () => api.get<{ shifts: Shift[] }>('/shifts?type=PERMANENCE'),
    enabled: !!user,
  });

  const { data: membersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: Member[] }>('/users'),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ shift: Shift }>('/shifts', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permanences'] });
      setShowCreate(false);
      setCreateForm({ date: '', startTime: '09:00', endTime: '12:00', userId: '', note: '' });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      api.patch<{ shift: Shift }>(`/shifts/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permanences'] });
      setSelectedShift(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const claimMutation = useMutation({
    mutationFn: (id: number) => api.post<{ shift: Shift }>(`/shifts/${id}/claim`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permanences'] });
      setSelectedShift(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const canManage = user?.role === 'ADMIN' || user?.role === 'POLE_LEAD';
  const weekDates = getWeekDates(weekAnchor);
  const shifts = data?.shifts ?? [];
  const members = membersData?.users ?? [];

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.date || !createForm.startTime || !createForm.endTime) {
      setError('Date, heure début et heure fin requis'); return;
    }
    createMutation.mutate({
      date: createForm.date,
      startTime: createForm.startTime,
      endTime: createForm.endTime,
      userId: createForm.userId ? Number(createForm.userId) : undefined,
      note: createForm.note || undefined,
      type: 'PERMANENCE',
    });
  }

  if (authLoading) return null;

  const weekLabel = `${weekDates[0].getDate()} ${MONTH_NAMES[weekDates[0].getMonth()]} – ${weekDates[6].getDate()} ${MONTH_NAMES[weekDates[6].getMonth()]} ${weekDates[6].getFullYear()}`;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Local — Permanences</h2>
          {canManage && (
            <button onClick={() => { setShowCreate(true); setError(''); }}
              style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
              + Créer une permanence
            </button>
          )}
        </div>

        {/* Navigation semaine */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={() => setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
            style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '1.1rem' }}>‹</button>
          <span style={{ fontWeight: 600, minWidth: 260, textAlign: 'center' }}>{weekLabel}</span>
          <button onClick={() => setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
            style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '1.1rem' }}>›</button>
          <button onClick={() => setWeekAnchor(new Date())}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem', color: '#555' }}>
            Aujourd'hui
          </button>
        </div>

        {/* Grille semaine */}
        {isLoading ? (
          <p style={{ color: '#666' }}>Chargement...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem' }}>
            {weekDates.map(day => {
              const isToday = isSameDay(day, new Date());
              const dayShifts = shifts.filter(s => isSameDay(new Date(s.date), day));
              return (
                <div key={day.toISOString()} style={{ minHeight: 160 }}>
                  <div style={{
                    textAlign: 'center', padding: '0.5rem 0.25rem', marginBottom: '0.4rem',
                    borderRadius: 6, background: isToday ? '#e94560' : 'transparent',
                    color: isToday ? '#fff' : '#1a1a2e',
                  }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600 }}>{DAY_NAMES[day.getDay()]}</p>
                    <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{day.getDate()}</p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {dayShifts.map(shift => (
                      <div
                        key={shift.id}
                        onClick={() => { setSelectedShift(shift); setError(''); }}
                        style={{
                          background: `${STATUS_COLORS[shift.status] ?? '#6b7280'}18`,
                          border: `1px solid ${STATUS_COLORS[shift.status] ?? '#6b7280'}44`,
                          borderLeft: `3px solid ${STATUS_COLORS[shift.status] ?? '#6b7280'}`,
                          borderRadius: 4,
                          padding: '0.3rem 0.4rem',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                        }}
                      >
                        <p style={{ fontWeight: 600, color: '#1a1a2e', marginBottom: '0.1rem' }}>
                          {shift.startTime} – {shift.endTime}
                        </p>
                        <p style={{ color: '#555' }}>
                          {shift.user
                            ? `${shift.user.firstName} ${shift.user.lastName.charAt(0)}.`
                            : <span style={{ color: STATUS_COLORS[shift.status] ?? '#6b7280', fontStyle: 'italic' }}>Non assigné</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Légende */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_COLORS[k] }} />
              {v}
            </div>
          ))}
        </div>

        {/* Prochaines permanences liste */}
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '1rem' }}>Prochaines permanences</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {shifts
              .filter(s => new Date(s.date) >= new Date(new Date().setHours(0,0,0,0)))
              .slice(0, 8)
              .map(shift => (
                <div key={shift.id} onClick={() => { setSelectedShift(shift); setError(''); }}
                  style={{ background: '#fff', borderRadius: 8, padding: '0.875rem 1rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div>
                    <p style={{ fontWeight: 600, marginBottom: '0.15rem' }}>
                      {new Date(shift.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      {' · '}{shift.startTime} – {shift.endTime}
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>
                      {shift.user ? `${shift.user.firstName} ${shift.user.lastName}` : 'Non assigné'}
                    </p>
                    {shift.note && <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '0.1rem' }}>{shift.note}</p>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {shift.status === 'OUVERT' && !shift.user && (
                      <button onClick={e => { e.stopPropagation(); claimMutation.mutate(shift.id); }}
                        style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                        Je prends
                      </button>
                    )}
                    <span style={{
                      fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: 20,
                      background: `${STATUS_COLORS[shift.status]}22`, color: STATUS_COLORS[shift.status], fontWeight: 600,
                    }}>
                      {STATUS_LABELS[shift.status]}
                    </span>
                  </div>
                </div>
              ))}
            {shifts.filter(s => new Date(s.date) >= new Date(new Date().setHours(0,0,0,0))).length === 0 && (
              <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Aucune permanence à venir.</p>
            )}
          </div>
        </div>

        {/* Modal création */}
        {showCreate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Créer une permanence</h3>
              <form onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div><label style={lbl}>Date *</label><input type="date" style={inp} value={createForm.date} onChange={e => setCreateForm(f => ({ ...f, date: e.target.value }))} required /></div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Début *</label><input type="time" style={inp} value={createForm.startTime} onChange={e => setCreateForm(f => ({ ...f, startTime: e.target.value }))} required /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Fin *</label><input type="time" style={inp} value={createForm.endTime} onChange={e => setCreateForm(f => ({ ...f, endTime: e.target.value }))} required /></div>
                </div>
                <div><label style={lbl}>Assigné à</label>
                  <select style={inp} value={createForm.userId} onChange={e => setCreateForm(f => ({ ...f, userId: e.target.value }))}>
                    <option value="">— Non assigné (ouvert) —</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Note</label><input style={inp} value={createForm.note} onChange={e => setCreateForm(f => ({ ...f, note: e.target.value }))} placeholder="Ex : Permanence d'accueil" /></div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setShowCreate(false); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Annuler</button>
                  <button type="submit" disabled={createMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                    {createMutation.isPending ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal détail permanence */}
        {selectedShift && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 420 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                <div>
                  <h3 style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Permanence</h3>
                  <p style={{ fontSize: '0.9rem', color: '#555' }}>
                    {new Date(selectedShift.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  <p style={{ fontSize: '0.9rem', color: '#555' }}>{selectedShift.startTime} – {selectedShift.endTime}</p>
                </div>
                <button onClick={() => setSelectedShift(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#666' }}>✕</button>
              </div>

              <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                <strong>Assigné à :</strong> {selectedShift.user ? `${selectedShift.user.firstName} ${selectedShift.user.lastName}` : 'Non assigné'}
              </p>
              {selectedShift.note && <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#666' }}>{selectedShift.note}</p>}

              <span style={{
                display: 'inline-block', fontSize: '0.8rem', padding: '0.25rem 0.625rem', borderRadius: 20, marginBottom: '1.25rem',
                background: `${STATUS_COLORS[selectedShift.status]}22`, color: STATUS_COLORS[selectedShift.status], fontWeight: 600,
              }}>
                {STATUS_LABELS[selectedShift.status]}
              </span>

              {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {selectedShift.status === 'OUVERT' && !selectedShift.user && (
                  <button onClick={() => claimMutation.mutate(selectedShift.id)} disabled={claimMutation.isPending}
                    style={{ padding: '0.6rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                    Je prends cette permanence
                  </button>
                )}
                {canManage && (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        style={{ ...inp, flex: 1 }}
                        defaultValue={selectedShift.user?.id ?? ''}
                        onChange={e => {
                          updateMutation.mutate({
                            id: selectedShift.id,
                            body: { userId: e.target.value ? Number(e.target.value) : null },
                          });
                        }}
                      >
                        <option value="">— Non assigné —</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {['OUVERT', 'ASSIGNE', 'CONFIRME'].map(s => (
                        <button key={s} onClick={() => updateMutation.mutate({ id: selectedShift.id, body: { status: s } })}
                          disabled={selectedShift.status === s}
                          style={{
                            flex: 1, padding: '0.4rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6, border: '1px solid #d1d5db',
                            background: selectedShift.status === s ? STATUS_COLORS[s] : '#fff',
                            color: selectedShift.status === s ? '#fff' : '#333',
                            cursor: selectedShift.status === s ? 'default' : 'pointer',
                          }}>
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
