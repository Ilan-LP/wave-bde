'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Avoir {
  id: number;
  code: string;
  amountCents: number;
  status: 'ACTIF' | 'CONSOMME' | 'EXPIRE';
  reason: string | null;
  createdAt: string;
  externalName: string | null;
  externalEmail: string | null;
  issuedTo: { id: number; firstName: string; lastName: string } | null;
  issuedBy: { id: number; firstName: string; lastName: string };
}

interface User {
  id: number;
  firstName: string;
  lastName: string;
}

const STATUS_LABELS: Record<string, string> = { ACTIF: 'Actif', CONSOMME: 'Consommé', EXPIRE: 'Expiré' };
const STATUS_COLORS: Record<string, string> = { ACTIF: '#16a34a', CONSOMME: '#2563eb', EXPIRE: '#9ca3af' };
const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000';

export default function AvoirsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showConsume, setShowConsume] = useState(false);
  const [qrAvoir, setQrAvoir] = useState<Avoir | null>(null);
  const [isExternal, setIsExternal] = useState(false);

  const [createIssuedToId, setCreateIssuedToId] = useState('');
  const [createExtName, setCreateExtName] = useState('');
  const [createExtEmail, setCreateExtEmail] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createReason, setCreateReason] = useState('');
  const [consumeCode, setConsumeCode] = useState('');
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data: avoirsData, isLoading } = useQuery({
    queryKey: ['avoirs', statusFilter],
    queryFn: () => api.get<{ avoirs: Avoir[] }>(`/avoirs${statusFilter ? `?status=${statusFilter}` : ''}`),
    enabled: !!user,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: User[] }>('/users'),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ avoir: Avoir }>('/avoirs', body),
    onSuccess: (data) => {
      setLastCode(data.avoir.code);
      setShowCreate(false);
      setCreateIssuedToId(''); setCreateExtName(''); setCreateExtEmail('');
      setCreateAmount(''); setCreateReason(''); setIsExternal(false);
      queryClient.invalidateQueries({ queryKey: ['avoirs'] });
    },
  });

  const consumeMutation = useMutation({
    mutationFn: (code: string) => api.post<{ avoir: Avoir }>('/avoirs/consume', { code }),
    onSuccess: () => {
      setShowConsume(false); setConsumeCode('');
      queryClient.invalidateQueries({ queryKey: ['avoirs'] });
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(createAmount) * 100);
    createMutation.mutate({
      ...(isExternal
        ? { externalName: createExtName, externalEmail: createExtEmail || undefined }
        : { issuedToId: Number(createIssuedToId) }),
      amountCents,
      reason: createReason || undefined,
    });
  }

  function handleConsume(e: FormEvent) {
    e.preventDefault();
    consumeMutation.mutate(consumeCode.trim().toUpperCase());
  }

  const isAdmin = user?.role === 'ADMIN';

  if (authLoading) return null;

  const avoirs = avoirsData?.avoirs ?? [];
  const users = usersData?.users ?? [];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Avoirs</h2>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={() => setShowConsume(true)} style={secondaryBtn}>Scanner / Consommer</button>
            {isAdmin && <button onClick={() => setShowCreate(true)} style={primaryBtn}>Émettre un avoir</button>}
          </div>
        </div>

        {lastCode && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ color: '#16a34a', fontWeight: 600 }}>Avoir créé : <strong>{lastCode}</strong></p>
            <button onClick={() => setLastCode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}>✕</button>
          </div>
        )}

        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
          {(['', 'ACTIF', 'CONSOMME', 'EXPIRE'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '0.375rem 0.875rem', borderRadius: 20, border: '1px solid #ddd', fontSize: '0.85rem',
              background: statusFilter === s ? '#1a1a2e' : '#fff', color: statusFilter === s ? '#fff' : '#333', cursor: 'pointer',
            }}>
              {s === '' ? 'Tous' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p style={{ color: '#666' }}>Chargement...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {avoirs.map((avoir) => (
              <div key={avoir.id} style={{
                background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1rem', alignItems: 'center',
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <code style={{ fontWeight: 700, fontSize: '1rem', color: '#1a1a2e', letterSpacing: '0.05em' }}>{avoir.code}</code>
                    <span style={{
                      fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: 10,
                      background: `${STATUS_COLORS[avoir.status]}22`, color: STATUS_COLORS[avoir.status], fontWeight: 600,
                    }}>
                      {STATUS_LABELS[avoir.status]}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#555' }}>
                    Pour : <strong>
                      {avoir.issuedTo
                        ? `${avoir.issuedTo.firstName} ${avoir.issuedTo.lastName}`
                        : avoir.externalName ?? '—'}
                    </strong>
                    {avoir.externalEmail && <span style={{ color: '#9ca3af' }}> ({avoir.externalEmail})</span>}
                    {avoir.reason && <> · {avoir.reason}</>}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.15rem' }}>
                    Émis par {avoir.issuedBy.firstName} {avoir.issuedBy.lastName} ·{' '}
                    {new Date(avoir.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                  {(avoir.amountCents / 100).toFixed(2)} €
                </p>
                <button
                  onClick={() => setQrAvoir(avoir)}
                  title="Voir le QR code"
                  style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                  ▤
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Modal QR code */}
        {qrAvoir && (
          <Modal title={`QR Code — ${qrAvoir.code}`} onClose={() => setQrAvoir(null)}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <img
                src={`${API_BASE}/api/v1/avoirs/${qrAvoir.code}/qr`}
                alt={`QR code ${qrAvoir.code}`}
                style={{ width: 240, height: 240, borderRadius: 8 }}
              />
              <code style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.1em', color: '#1a1a2e' }}>
                {qrAvoir.code}
              </code>
              <p style={{ fontSize: '0.9rem', color: '#555' }}>
                {qrAvoir.issuedTo
                  ? `${qrAvoir.issuedTo.firstName} ${qrAvoir.issuedTo.lastName}`
                  : qrAvoir.externalName}
                {' — '}
                <strong>{(qrAvoir.amountCents / 100).toFixed(2)} €</strong>
              </p>
              <span style={{
                fontSize: '0.8rem', padding: '0.25rem 0.75rem', borderRadius: 20,
                background: `${STATUS_COLORS[qrAvoir.status]}22`, color: STATUS_COLORS[qrAvoir.status], fontWeight: 600,
              }}>
                {STATUS_LABELS[qrAvoir.status]}
              </span>
            </div>
          </Modal>
        )}

        {/* Modal création */}
        {showCreate && (
          <Modal title="Émettre un avoir" onClose={() => setShowCreate(false)}>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => setIsExternal(false)}
                  style={{ ...tabBtn, background: !isExternal ? '#1a1a2e' : '#f3f4f6', color: !isExternal ? '#fff' : '#333' }}>
                  Membre BDE
                </button>
                <button type="button" onClick={() => setIsExternal(true)}
                  style={{ ...tabBtn, background: isExternal ? '#1a1a2e' : '#f3f4f6', color: isExternal ? '#fff' : '#333' }}>
                  Personne externe
                </button>
              </div>

              {!isExternal ? (
                <div>
                  <label style={lbl}>Destinataire</label>
                  <select value={createIssuedToId} onChange={e => setCreateIssuedToId(e.target.value)} required style={inp}>
                    <option value="">Sélectionner un membre</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label style={lbl}>Nom / prénom *</label>
                    <input style={inp} value={createExtName} onChange={e => setCreateExtName(e.target.value)} required placeholder="Jean Dupont" />
                  </div>
                  <div>
                    <label style={lbl}>Email (optionnel)</label>
                    <input type="email" style={inp} value={createExtEmail} onChange={e => setCreateExtEmail(e.target.value)} placeholder="jean@example.com" />
                  </div>
                </>
              )}

              <div>
                <label style={lbl}>Montant (€)</label>
                <input type="number" min="0.01" step="0.01" value={createAmount} onChange={e => setCreateAmount(e.target.value)} required placeholder="ex: 5.00" style={inp} />
              </div>
              <div>
                <label style={lbl}>Motif (optionnel)</label>
                <input type="text" value={createReason} onChange={e => setCreateReason(e.target.value)} placeholder="ex: Remboursement" style={inp} />
              </div>

              {createMutation.error && <p style={{ color: '#dc2626', fontSize: '0.875rem' }}>{(createMutation.error as Error).message}</p>}

              <button type="submit" disabled={createMutation.isPending} style={primaryBtn}>
                {createMutation.isPending ? 'Création...' : "Créer l'avoir"}
              </button>
            </form>
          </Modal>
        )}

        {/* Modal consommation */}
        {showConsume && (
          <Modal title="Consommer un avoir" onClose={() => setShowConsume(false)}>
            <form onSubmit={handleConsume} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={lbl}>Code avoir</label>
                <input
                  type="text" value={consumeCode}
                  onChange={e => setConsumeCode(e.target.value)}
                  required placeholder="AV-XXXXXXXX"
                  style={{ ...inp, textTransform: 'uppercase', fontFamily: 'monospace', fontSize: '1rem', letterSpacing: '0.05em' }}
                />
              </div>
              <p style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Scannez le QR code ou saisissez le code manuellement.</p>
              {consumeMutation.error && <p style={{ color: '#dc2626', fontSize: '0.875rem' }}>{(consumeMutation.error as Error).message}</p>}
              <button type="submit" disabled={consumeMutation.isPending} style={primaryBtn}>
                {consumeMutation.isPending ? 'Traitement...' : 'Consommer'}
              </button>
            </form>
          </Modal>
        )}
      </main>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1.1rem' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#666' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '0.625rem 0.875rem', border: '1px solid #ddd', borderRadius: 8, fontSize: '0.95rem', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.375rem' };
const primaryBtn: React.CSSProperties = { padding: '0.625rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' };
const secondaryBtn: React.CSSProperties = { padding: '0.625rem 1.25rem', background: '#fff', color: '#1a1a2e', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' };
const tabBtn: React.CSSProperties = { flex: 1, padding: '0.5rem', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' };
