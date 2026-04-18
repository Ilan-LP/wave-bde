'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Member {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  pole: string | null;
  bio: string | null;
  photoUrl: string | null;
  isActive: boolean;
  isPublic: boolean;
}

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Admin', POLE_LEAD: 'Pôle Lead', MEMBRE: 'Membre' };
const POLES = ['BUREAU', 'COMMUNICATION', 'EVENEMENT', 'PARTENARIAT', 'TRESORERIE', 'LOGISTIQUE'];
const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000';

const inputStyle: React.CSSProperties = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' };

interface CreateForm { email: string; password: string; firstName: string; lastName: string; role: string; pole: string; }
interface EditForm { firstName: string; lastName: string; pole: string; bio: string; isActive: boolean; isPublic: boolean; }

export default function MembresPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ email: '', password: '', firstName: '', lastName: '', role: 'MEMBRE', pole: '' });
  const [editForm, setEditForm] = useState<EditForm>({ firstName: '', lastName: '', pole: '', bio: '', isActive: true, isPublic: true });
  const [error, setError] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: Member[] }>('/users'),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ user: Member }>('/users', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setCreateForm({ email: '', password: '', firstName: '', lastName: '', role: 'MEMBRE', pole: '' });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api.patch<{ user: Member }>(`/users/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditMember(null); setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<{ success: boolean }>(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditMember(null); setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  async function handlePhotoUpload(memberId: number, file: File) {
    setUploadingPhoto(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch(`${API_BASE}/api/v1/users/${memberId}/photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        credentials: 'include',
      });
      const json = await res.json() as { success: boolean; message?: string };
      if (!res.ok) throw new Error(json.message ?? 'Erreur upload');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  const isAdmin = user?.role === 'ADMIN';
  const canEdit = user?.role === 'ADMIN' || user?.role === 'POLE_LEAD';

  function openEdit(m: Member) {
    setEditMember(m);
    setEditForm({ firstName: m.firstName, lastName: m.lastName, pole: m.pole ?? '', bio: m.bio ?? '', isActive: m.isActive, isPublic: m.isPublic });
    setError('');
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.email || !createForm.password || !createForm.firstName || !createForm.lastName) {
      setError('Tous les champs obligatoires sont requis'); return;
    }
    createMutation.mutate({ ...createForm, pole: createForm.pole || undefined });
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editMember) return;
    updateMutation.mutate({ id: editMember.id, body: { ...editForm, pole: editForm.pole || undefined, bio: editForm.bio || undefined } });
  }

  if (authLoading) return null;

  const members = data?.users ?? [];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Membres</h2>
          {isAdmin && (
            <button onClick={() => { setShowCreate(true); setError(''); }}
              style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
              + Ajouter un membre
            </button>
          )}
        </div>

        {isLoading ? (
          <p style={{ color: '#666' }}>Chargement...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
            {members.map((m) => {
              const isMe = user?.id === m.id;
              const canUploadPhoto = isMe || isAdmin;
              return (
                <div key={m.id} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', opacity: m.isActive ? 1 : 0.5 }}>
                  {/* Photo */}
                  <div
                    style={{ position: 'relative', height: 120, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canUploadPhoto ? 'pointer' : 'default' }}
                    onClick={() => canUploadPhoto && photoInputRef.current && (photoInputRef.current.dataset.memberId = String(m.id), photoInputRef.current.click())}
                  >
                    {m.photoUrl ? (
                      <img src={`${API_BASE}${m.photoUrl}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#e94560', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '1.5rem', fontWeight: 700 }}>
                        {m.firstName[0]}{m.lastName[0]}
                      </div>
                    )}
                    {canUploadPhoto && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1', e.currentTarget.style.background = 'rgba(0,0,0,0.3)')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '0', e.currentTarget.style.background = 'rgba(0,0,0,0)')}>
                        <span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>Changer photo</span>
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '1rem', cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && openEdit(m)}>
                    <p style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{m.firstName} {m.lastName}</p>
                    <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>{m.email}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: '#e94560', color: '#fff', borderRadius: 10 }}>{ROLE_LABELS[m.role] ?? m.role}</span>
                      {m.pole && <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: '#1a1a2e22', color: '#1a1a2e', borderRadius: 10 }}>{m.pole}</span>}
                      {!m.isActive && <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: '#f3f4f6', color: '#9ca3af', borderRadius: 10 }}>Inactif</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Input photo caché */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            const memberId = Number(e.target.dataset.memberId);
            if (file && memberId) await handlePhotoUpload(memberId, file);
            e.target.value = '';
          }}
        />
        {uploadingPhoto && (
          <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', background: '#1a1a2e', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 8, fontSize: '0.9rem' }}>
            Upload en cours...
          </div>
        )}

        {/* Modal création */}
        {showCreate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Nouveau membre</h3>
              <form onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}><label style={labelStyle}>Prénom *</label><input style={inputStyle} value={createForm.firstName} onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))} required /></div>
                  <div style={{ flex: 1 }}><label style={labelStyle}>Nom *</label><input style={inputStyle} value={createForm.lastName} onChange={e => setCreateForm(f => ({ ...f, lastName: e.target.value }))} required /></div>
                </div>
                <div><label style={labelStyle}>Email *</label><input type="email" style={inputStyle} value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required /></div>
                <div><label style={labelStyle}>Mot de passe *</label><input type="password" style={inputStyle} value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} required /></div>
                <div><label style={labelStyle}>Rôle</label>
                  <select style={inputStyle} value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="MEMBRE">Membre</option><option value="POLE_LEAD">Pôle Lead</option><option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div><label style={labelStyle}>Pôle</label>
                  <select style={inputStyle} value={createForm.pole} onChange={e => setCreateForm(f => ({ ...f, pole: e.target.value }))}>
                    <option value="">— Aucun —</option>{POLES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
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

        {/* Modal édition */}
        {editMember && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Modifier le membre</h3>
              <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '1.5rem' }}>{editMember.email}</p>
              <form onSubmit={submitEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}><label style={labelStyle}>Prénom</label><input style={inputStyle} value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} /></div>
                  <div style={{ flex: 1 }}><label style={labelStyle}>Nom</label><input style={inputStyle} value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} /></div>
                </div>
                <div><label style={labelStyle}>Pôle</label>
                  <select style={inputStyle} value={editForm.pole} onChange={e => setEditForm(f => ({ ...f, pole: e.target.value }))}>
                    <option value="">— Aucun —</option>{POLES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div><label style={labelStyle}>Bio</label><textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={editForm.bio} onChange={e => setEditForm(f => ({ ...f, bio: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} /> Actif
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.isPublic} onChange={e => setEditForm(f => ({ ...f, isPublic: e.target.checked }))} /> Profil public
                  </label>
                </div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  {isAdmin && (
                    <button type="button" onClick={() => { if (confirm(`Archiver ${editMember.firstName} ?`)) deleteMutation.mutate(editMember.id); }}
                      style={{ padding: '0.5rem 1rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                      Archiver
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '0.75rem', marginLeft: 'auto' }}>
                    <button type="button" onClick={() => { setEditMember(null); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Annuler</button>
                    <button type="submit" disabled={updateMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                      {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
