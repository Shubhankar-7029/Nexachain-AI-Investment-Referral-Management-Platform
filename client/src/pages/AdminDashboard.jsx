import { useCallback, useEffect, useState } from 'react';
import { Banknote, Check, CircleDollarSign, FileText, LayoutDashboard, LogOut, PlayCircle, RefreshCw, Search, ShieldCheck, TrendingUp, UserCheck, UserX, Users, Wallet, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import StatCard from '../components/StatCard';
import Pager from '../components/Pager';
import { date, dateTime, money } from '../utils/format';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'deposits', label: 'Deposits', icon: Banknote },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'investments', label: 'Investments', icon: CircleDollarSign },
  { id: 'roi', label: 'ROI ledger', icon: TrendingUp }
];

const Status = ({ value }) => <span className={`status status-${String(value || '').toLowerCase()}`}>{value}</span>;
const Empty = ({ cols, text }) => <tr><td colSpan={cols}><div className="table-empty"><FileText size={20}/>{text}</div></td></tr>;
const errText = (e, fallback) => e.response?.data?.message || fallback;

// One hook for every paginated admin table: page + filters in, rows + paging out.
function useList(path, params) {
  const [state, setState] = useState({ rows: [], page: 1, pages: 1, total: 0, loading: true, error: '' });
  const [page, setPage] = useState(1);
  const key = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [key]);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '10' });
      for (const [k, v] of Object.entries(JSON.parse(key))) if (v) qs.set(k, v);
      const { data } = await api.get(`${path}?${qs}`);
      const rows = data[Object.keys(data).find((k) => Array.isArray(data[k]))];
      setState({ rows, page: data.page, pages: data.pages, total: data.total, loading: false, error: '' });
    } catch (e) { setState((s) => ({ ...s, loading: false, error: errText(e, 'Could not load data.') })); }
  }, [path, page, key]);
  useEffect(() => { const t = setTimeout(load, params.q ? 300 : 0); return () => clearTimeout(t); }, [load]);
  return { ...state, setPage, reload: load };
}

function Toolbar({ q, setQ, placeholder, children }) {
  return <div className="table-actions">{setQ && <div className="search-input"><Search size={15}/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}/></div>}{children}</div>;
}

function Overview({ goTo, refreshKey }) {
  const [stats, setStats] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/stats').then(({ data }) => { setStats(data.stats); setError(''); }).catch((e) => setError(errText(e, 'Could not load statistics.'))); }, [refreshKey]);
  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!stats) return <div className="loading-card">Loading statistics…</div>;
  const s = stats;
  return <>
    <div className="stats-grid stats-8">
      <StatCard title="Members" value={s.members} hint={`${s.newMembersToday} joined today · ${s.admins} admin(s)`} icon={Users} tone="blue"/>
      <StatCard title="Pending deposits" value={s.deposits.pendingCount} hint={`${money(s.deposits.pendingAmount)} waiting for review`} icon={Banknote} tone="orange"/>
      <StatCard title="Deposits approved" value={money(s.deposits.approvedAmount)} hint={`${s.deposits.approvedCount} approved · ${s.deposits.rejectedCount} rejected`} icon={Check} tone="green"/>
      <StatCard title="Wallet liability" value={money(s.walletLiability)} hint="Total in all member wallets" icon={Wallet} tone="purple"/>
      <StatCard title="Active investments" value={money(s.investments.activeAmount)} hint={`${s.investments.activeCount} active plan(s)`} icon={CircleDollarSign} tone="blue"/>
      <StatCard title="All investments" value={s.investments.totalCount} hint={`${money(s.investments.totalAmount)} invested · ${s.investments.completedCount} completed`} icon={FileText} tone="purple"/>
      <StatCard title="ROI paid" value={money(s.roiPaidTotal)} hint={`${money(s.roiPaidToday)} today${s.lastRoiDate ? ` · last run ${date(s.lastRoiDate)}` : ''}`} icon={TrendingUp} tone="green"/>
      <StatCard title="Referral income paid" value={money(s.referralPaidTotal)} hint={s.inactiveAccounts ? `${s.inactiveAccounts} suspended/closed account(s)` : 'No suspended accounts'} icon={Users} tone="orange"/>
    </div>
    <section className="panel"><div className="panel-header"><div><h2>Quick actions</h2><p>Most common admin tasks</p></div></div>
      <div className="table-actions" style={{ padding: '0 22px 22px', flexWrap: 'wrap' }}>
        <button className="primary-button small" onClick={() => goTo('deposits')}><Banknote size={16}/> Review deposits{s.deposits.pendingCount ? ` (${s.deposits.pendingCount})` : ''}</button>
        <button className="outline-button" onClick={() => goTo('users')}><Users size={15}/> Manage users</button>
        <button className="outline-button" onClick={() => goTo('roi')}><PlayCircle size={15}/> Run daily ROI</button>
      </div></section>
  </>;
}

function Deposits({ onChanged }) {
  const [status, setStatus] = useState('Pending');
  const list = useList('/admin/deposits', { status });
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  async function decide(id, action) {
    setBusy(id); setMsg(''); setErr('');
    try { await api.post(`/admin/deposits/${id}/${action}`, {}); setMsg(action === 'approve' ? 'Deposit approved and the wallet was credited.' : 'Deposit rejected.'); await list.reload(); onChanged(); }
    catch (e) { setErr(errText(e, 'Action failed.')); await list.reload(); }
    finally { setBusy(''); }
  }
  return <section className="panel table-panel"><div className="panel-header"><div><h2>Deposit requests</h2><p>Approving credits the member's wallet once. You cannot review your own request.</p></div>
    <Toolbar><select className="outline-button select-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option>Pending</option><option>Approved</option><option>Rejected</option><option>All</option></select><button className="outline-button" onClick={list.reload}><RefreshCw size={15}/> Refresh</button></Toolbar></div>
    {msg && <div className="notice-banner"><Check size={17}/><span>{msg}</span></div>}{(err || list.error) && <div className="error-banner"><span>{err || list.error}</span></div>}
    <div className="table-scroll"><table><thead><tr><th>MEMBER</th><th>AMOUNT</th><th>REFERENCE</th><th>REQUESTED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
      {list.rows.length ? list.rows.map((d) => <tr key={d._id}><td><strong className="who-name">{d.user?.fullName || 'Member'}</strong><small className="sub-hint">{d.user?.email}</small></td><td className="amount-cell">{money(d.amount)}</td><td>{d.reference}</td><td>{dateTime(d.createdAt)}</td><td><Status value={d.status}/></td>
        <td>{d.status === 'Pending' ? <div className="row-actions"><button className="outline-button" disabled={busy === d._id} onClick={() => decide(d._id, 'approve')}><Check size={14}/> Approve</button><button className="outline-button danger" disabled={busy === d._id} onClick={() => decide(d._id, 'reject')}><X size={14}/> Reject</button></div> : <small className="sub-hint">{d.reviewedAt ? dateTime(d.reviewedAt) : '—'}</small>}</td></tr>)
        : <Empty cols={6} text={list.loading ? 'Loading…' : `No ${status === 'All' ? '' : status.toLowerCase() + ' '}deposit requests.`}/>}
    </tbody></table></div>
    <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} onPage={list.setPage}/></section>;
}

function UsersTab({ me }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [role, setRole] = useState('');
  const list = useList('/admin/users', { q: q.trim(), status, role });
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  async function setUserStatus(u, next) {
    if (next === 'Suspended' && !window.confirm(`Suspend ${u.fullName}? They will be signed out and unable to log in.`)) return;
    setBusy(u._id); setErr(''); setMsg('');
    try { await api.patch(`/admin/users/${u._id}/status`, { status: next }); setMsg(`${u.fullName} is now ${next}.`); await list.reload(); }
    catch (e) { setErr(errText(e, 'Could not change the status.')); }
    finally { setBusy(''); }
  }
  return <section className="panel table-panel"><div className="panel-header"><div><h2>Users</h2><p>All registered accounts with wallet and investment totals</p></div>
    <Toolbar q={q} setQ={setQ} placeholder="Search name or email">
      <select className="outline-button select-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option>Active</option><option>Suspended</option><option>Closed</option></select>
      <select className="outline-button select-input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role"><option value="">All roles</option><option value="user">Members</option><option value="admin">Admins</option></select></Toolbar></div>
    {msg && <div className="notice-banner"><Check size={17}/><span>{msg}</span></div>}{(err || list.error) && <div className="error-banner"><span>{err || list.error}</span></div>}
    <div className="table-scroll"><table><thead><tr><th>USER</th><th>ROLE</th><th>WALLET</th><th>INVESTED</th><th>REFERRALS</th><th>JOINED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
      {list.rows.length ? list.rows.map((u) => <tr key={u._id}><td><strong className="who-name">{u.fullName}</strong><small className="sub-hint">{u.email} · {u.mobileNumber}</small>{u.referredBy && <small className="sub-hint">Referred by {u.referredBy.fullName}</small>}</td>
        <td><Status value={u.role}/></td><td className="amount-cell">{money(u.walletBalance)}</td><td>{money(u.investedAmount)}<small className="sub-hint">{u.investmentCount} plan(s)</small></td><td>{u.directReferrals}</td><td>{date(u.createdAt)}</td><td><Status value={u.status}/></td>
        <td>{u._id === me._id || u.role === 'admin' || u.status === 'Closed' ? <small className="sub-hint">{u._id === me._id ? 'You' : '—'}</small>
          : u.status === 'Active' ? <button className="outline-button danger" disabled={busy === u._id} onClick={() => setUserStatus(u, 'Suspended')}><UserX size={14}/> Suspend</button>
          : <button className="outline-button" disabled={busy === u._id} onClick={() => setUserStatus(u, 'Active')}><UserCheck size={14}/> Activate</button>}</td></tr>)
        : <Empty cols={8} text={list.loading ? 'Loading…' : 'No users match your filters.'}/>}
    </tbody></table></div>
    <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} onPage={list.setPage}/></section>;
}

function InvestmentsTab() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const list = useList('/admin/investments', { q: q.trim(), status });
  return <section className="panel table-panel"><div className="panel-header"><div><h2>All investments</h2><p>Every member's plans</p></div>
    <Toolbar q={q} setQ={setQ} placeholder="Search plan name"><select className="outline-button select-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option>Active</option><option>Completed</option><option>Cancelled</option></select></Toolbar></div>
    {list.error && <div className="error-banner"><span>{list.error}</span></div>}
    <div className="table-scroll"><table><thead><tr><th>MEMBER</th><th>PLAN</th><th>AMOUNT</th><th>START</th><th>END</th><th>DAILY ROI</th><th>STATUS</th></tr></thead><tbody>
      {list.rows.length ? list.rows.map((i) => <tr key={i._id}><td><strong className="who-name">{i.user?.fullName || 'Member'}</strong><small className="sub-hint">{i.user?.email}</small></td><td>{i.planName}</td><td className="amount-cell">{money(i.amount)}</td><td>{date(i.startDate)}</td><td>{date(i.endDate)}</td><td>{Number(i.dailyRoiPercent).toFixed(2)}%</td><td><Status value={i.status}/></td></tr>)
        : <Empty cols={7} text={list.loading ? 'Loading…' : 'No investments found.'}/>}
    </tbody></table></div>
    <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} onPage={list.setPage}/></section>;
}

function RoiTab({ onChanged }) {
  const list = useList('/admin/roi', {});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  async function run() {
    setBusy(true); setMsg(''); setErr('');
    try {
      const { data } = await api.post('/admin/run-roi', {});
      const credited = data.results.reduce((n, r) => n + (r.credited || 0), 0); const failed = data.results.filter((r) => r.error).length;
      setMsg(`ROI job finished for ${data.date.slice(0, 10)}: ${data.processed} plan(s) checked, ${money(credited)} credited${failed ? `, ${failed} failed` : ''}.`);
      await list.reload(); onChanged();
    } catch (e) { setErr(errText(e, 'The ROI job failed.')); } finally { setBusy(false); }
  }
  return <section className="panel table-panel"><div className="panel-header"><div><h2>ROI ledger</h2><p>Daily returns credited to members. The scheduler runs at midnight; you can also run it now (safe to repeat: a day is never credited twice).</p></div>
    <Toolbar><button className="primary-button small" onClick={run} disabled={busy}><PlayCircle size={16}/> {busy ? 'Running…' : 'Run daily ROI now'}</button></Toolbar></div>
    {msg && <div className="notice-banner"><Check size={17}/><span>{msg}</span></div>}{(err || list.error) && <div className="error-banner"><span>{err || list.error}</span></div>}
    <div className="table-scroll"><table><thead><tr><th>DATE</th><th>MEMBER</th><th>PLAN</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>
      {list.rows.length ? list.rows.map((r) => <tr key={r._id}><td>{date(r.date)}</td><td><strong className="who-name">{r.user?.fullName || 'Member'}</strong><small className="sub-hint">{r.user?.email}</small></td><td>{r.investment?.planName || '—'}</td><td className="amount-cell positive">+{money(r.amount)}</td><td><Status value={r.status}/></td></tr>)
        : <Empty cols={5} text={list.loading ? 'Loading…' : 'No ROI has been credited yet. Run the daily ROI job.'}/>}
    </tbody></table></div>
    <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} onPage={list.setPage}/></section>;
}

export default function AdminDashboard({ onSwitchView }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);
  const current = TABS.find((t) => t.id === tab);
  return <div className="app-shell"><aside className="sidebar"><div className="brand side-brand"><span className="brand-mark"><span className="layers-icon">N</span></span><span>NEXACHAIN<span className="brand-ai"> AI</span></span></div><span className="admin-badge" style={{ marginLeft: 0, marginTop: 14, marginBottom: 14, alignSelf: 'flex-start' }}>ADMIN CONSOLE</span>
    <div className="workspace-label">ADMINISTRATION</div>
    <nav className="side-nav">{TABS.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}><Icon size={18}/>{label}</button>)}</nav>
    <div className="sidebar-bottom"><button className="sidebar-logout" onClick={onSwitchView} style={{ marginBottom: 6 }}><Wallet size={17}/> My member dashboard</button><button className="sidebar-logout" onClick={logout}><LogOut size={17}/> Sign out</button><div className="sidebar-version">ADMIN CONSOLE <span>v1.0.0</span></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumbs"><span>Admin</span><span className="crumb-slash">/</span><strong>{current.label}</strong></div>
      <div className="top-actions"><span className="environment"><ShieldCheck size={13}/> Admin session</span><button className="icon-button" title="Refresh" onClick={changed}><RefreshCw size={17}/></button><div className="top-divider"/><div className="user-menu"><div className="user-avatar">{(user?.fullName || 'A').slice(0, 1).toUpperCase()}</div><div className="user-meta"><strong>{user?.fullName}</strong><span>Administrator</span></div></div></div></header>
      <div className="page-wrap"><div className="welcome-row"><div><div className="eyebrow">ADMIN CONSOLE</div><h1>{current.label}</h1><p>{{ overview: 'Platform totals at a glance.', deposits: 'Review member deposit requests.', users: 'Find members and manage account access.', investments: 'Every investment across the platform.', roi: 'Daily returns and the ROI job.' }[tab]}</p></div></div>
        {tab === 'overview' && <Overview goTo={setTab} refreshKey={refreshKey}/>}
        {tab === 'deposits' && <Deposits onChanged={changed}/>}
        {tab === 'users' && <UsersTab me={user}/>}
        {tab === 'investments' && <InvestmentsTab key={refreshKey}/>}
        {tab === 'roi' && <RoiTab onChanged={changed}/>}
      </div></main></div>;
}
