import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, Download, FileText, GitBranch, LayoutDashboard, LogOut, Plus, RefreshCw, Search, ShieldCheck, TrendingUp, Users, Wallet, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import StatCard from '../components/StatCard';
import ReferralTree from '../components/ReferralTree';
// Heavy / role-specific code is loaded on demand (route-level splitting happens in main.jsx).
const EarningsChart = lazy(() => import('../components/EarningsChart'));
import { toCsv } from '../utils/csv';

const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0));
const date = (v) => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
function Status({ value }) { const c = String(value || '').toLowerCase(); return <span className={`status status-${c}`}>{value}</span>; }
function Empty({ text }) { return <tr><td colSpan="6"><div className="table-empty"><FileText size={20}/>{text}</div></td></tr>; }

export default function Dashboard({ onSwitchView = null }) {
  const { user, logout } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [histories, setHistories] = useState({ investments: [], roiHistory: [], referralIncome: [] });
  const [tree, setTree] = useState(null);
  const [direct, setDirect] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvestment, setShowInvestment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [investError, setInvestError] = useState(''); // errors belong inside the modal, not in the green success banner
  const [form, setForm] = useState({ amount: '1000', planName: 'Starter Plan', durationDays: '30' });
  const [activeTab, setActiveTab] = useState('Overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [inv, setInv] = useState({ rows: [], page: 1, pages: 1, total: 0, loading: true });
  const [chart, setChart] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ amount: '1000', reference: '' });
  const [depositNotice, setDepositNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [d, h, t, r, c, dp] = await Promise.all([api.get('/dashboard'), api.get('/dashboard/histories?limit=6'), api.get('/referrals/tree'), api.get('/referrals/direct'), api.get('/dashboard/chart?days=14'), api.get('/deposits?limit=5')]);
      setDashboard(d.data.dashboard); setHistories(h.data); setTree(t.data.tree); setDirect(r.data.referrals); setChart(c.data.chart); setDeposits(dp.data.deposits);
    } catch (e) { setError(e.response?.data?.message || 'Could not load dashboard. Check your API connection.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Investments table: searching / filtering / paging happen on the server, so it scales past 100 rows.
  const [page, setPage] = useState(1);
  const loadInvestments = useCallback(async () => {
    setInv((x) => ({ ...x, loading: true }));
    try {
      const params = new URLSearchParams({ page: String(page), limit: '8' });
      if (search.trim()) params.set('q', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/investments?${params}`);
      setInv({ rows: data.investments, page: data.page, pages: data.pages, total: data.total, loading: false });
    } catch (e) { setInv((x) => ({ ...x, loading: false })); setError(e.response?.data?.message || 'Could not load investments.'); }
  }, [page, search, statusFilter]);
  useEffect(() => { const t = setTimeout(loadInvestments, search ? 300 : 0); return () => clearTimeout(t); }, [loadInvestments, search]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  const refreshAll = useCallback(() => Promise.all([load(), loadInvestments()]), [load, loadInvestments]);

  const chartData = chart.map((r) => ({ ...r, label: new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }) }));
  const hasActivity = chart.some((r) => r.roi > 0 || r.level > 0);

  async function createInvestment(e) {
    e.preventDefault(); setSaving(true); setNotice(''); setInvestError('');
    try { await api.post('/investments', { amount: Number(form.amount), planName: form.planName, durationDays: Number(form.durationDays) }); setShowInvestment(false); setNotice('Investment created. The amount was deducted from your wallet; principal is returned when the plan ends.'); await refreshAll(); }
    catch (e) { setInvestError(e.response?.data?.message || 'Could not create investment.'); }
    finally { setSaving(false); }
  }
  async function requestDeposit(e) {
    e.preventDefault(); setSaving(true); setDepositNotice('');
    try { await api.post('/deposits', { amount: Number(depositForm.amount), reference: depositForm.reference }); setShowDeposit(false); setDepositForm({ amount: '1000', reference: '' }); setNotice('Deposit request submitted. Your wallet is credited after an admin approves it.'); await load(); }
    catch (err) { setDepositNotice(err.response?.data?.message || 'Could not submit deposit request.'); }
    finally { setSaving(false); }
  }
  async function downloadCsv() {
    try {
      const all = []; // walk every page of the current search/filter (100 rows per request, capped at 50 pages)
      for (let p = 1; p <= 50; p += 1) {
        const params = new URLSearchParams({ page: String(p), limit: '100' });
        if (search.trim()) params.set('q', search.trim());
        if (statusFilter) params.set('status', statusFilter);
        const { data } = await api.get(`/investments?${params}`);
        all.push(...data.investments);
        if (p >= data.pages) break;
      }
      const rows = [['Plan', 'Amount (INR)', 'Start date', 'End date', 'Daily ROI %', 'Status'], ...all.map(i => [i.planName, i.amount, date(i.startDate), date(i.endDate), i.dailyRoiPercent, i.status])];
      const csv = toCsv(rows);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = 'nexachain-investments.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.response?.data?.message || 'Could not export investments.'); }
  }

  const nav = [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Investments', icon: CircleDollarSign }, { label: 'ROI history', icon: TrendingUp }, { label: 'Referrals', icon: Users }];
  return <div className="app-shell"><aside className="sidebar"><div className="brand side-brand"><span className="brand-mark"><Layers3Icon/></span><span>NEXACHAIN<span className="brand-ai"> AI</span></span></div><div className="workspace-label">WORKSPACE</div><nav className="side-nav">{nav.map(({ label, icon: Icon }) => <button key={label} className={activeTab === label ? 'selected' : ''} onClick={() => { setActiveTab(label); document.getElementById(label === 'Overview' ? 'overview' : label === 'Investments' ? 'investments' : label === 'ROI history' ? 'roi-history' : 'referrals')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Icon size={18}/>{label}{label === 'Referrals' && <span className="nav-count">{direct.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="secure-card"><div className="secure-icon"><ShieldCheck size={18}/></div><strong>Secure workspace</strong><p>Your account activity is protected by authenticated access.</p><span><span className="green-dot"/> API connected</span></div><button className="sidebar-logout" onClick={logout}><LogOut size={17}/> Sign out</button><div className="sidebar-version">NEXACHAIN DASHBOARD <span>v1.0.0</span></div></div></aside>
  <main className="main-content"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeTab}</strong></div><div className="top-actions"><span className="environment"><span className="green-dot"/> Demo environment</span><button className="icon-button" title="Refresh dashboard" onClick={refreshAll}><RefreshCw size={17}/></button><div className="top-divider"/><div className="user-menu"><div className="user-avatar">{(user?.fullName || 'U').slice(0,1).toUpperCase()}</div><div className="user-meta"><strong>{user?.fullName || 'User'}</strong><span>{user?.role === 'admin' ? 'Administrator' : 'Member account'}</span></div><ChevronDown size={15}/></div></div></header>
  <div className="page-wrap" id="overview"><div className="welcome-row"><div><div className="eyebrow">YOUR FINANCIAL OVERVIEW</div><h1>Good to see you, {(user?.fullName || 'there').split(' ')[0]} <span className="wave">✦</span></h1><p>Here’s a summary of your investment activity and referral network.</p></div><div className="welcome-actions"><span className="last-updated"><Clock3 size={14}/> {loading ? 'Updating…' : 'Live account data'}</span>{onSwitchView && <button className="outline-button" onClick={onSwitchView}><ShieldCheck size={15}/> Admin console</button>}<button className="outline-button" onClick={() => { setDepositNotice(''); setShowDeposit(true); }}><Wallet size={15}/> Add funds</button><button className="primary-button small" onClick={() => { setInvestError(''); setShowInvestment(true); }}><Plus size={16}/> New investment</button></div></div>
  {error && <div className="error-banner"><span>{error}</span><button onClick={load}>Try again</button></div>}{notice && <div className="notice-banner"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
  <div className="stats-grid">{loading && !dashboard ? <div className="loading-card">Loading account summary…</div> : <><StatCard title="Total investments" value={money(dashboard?.totalInvestments)} hint={`${dashboard?.investmentCount || 0} investment records`} icon={CircleDollarSign} tone="blue"/><StatCard title="Total ROI earned" value={money(dashboard?.totalRoiEarned)} hint="Cumulative recorded ROI" icon={TrendingUp} tone="green"/><StatCard title="Level income" value={money(dashboard?.totalLevelIncomeEarned)} hint="Referral income recorded" icon={Users} tone="purple"/><StatCard title="Wallet balance" value={money(dashboard?.walletBalance)} hint="Available to invest (demo)" icon={Wallet} tone="orange"/></>}</div>
  <section className="content-grid"><article className="panel earnings-panel"><div className="panel-header"><div><h2>Earnings activity</h2><p>Recorded ROI and referral income over time</p></div><span className="range-chip"><CalendarDays size={14}/> Recent activity</span></div><div className="chart-legend"><span><i className="legend-dot roi-dot"/> ROI</span><span><i className="legend-dot level-dot"/> Level income</span></div>{hasActivity ? <Suspense fallback={<div className="chart-empty"><span>Loading chart…</span></div>}><EarningsChart data={chartData}/></Suspense> : <div className="chart-empty"><div className="chart-empty-icon"><TrendingUp size={24}/></div><strong>Your earnings activity will appear here</strong><span>Once ROI or referral history exists, the chart will populate automatically.</span></div>}</article>
  <article className="panel referral-summary"><div className="panel-header"><div><h2>Referral network</h2><p>Your direct connections</p></div><span className="mini-icon purple"><GitBranch size={17}/></span></div><div className="referral-total"><div><strong>{direct.length}</strong><span>Direct referrals</span></div><div className="referral-avatars">{direct.slice(0, 4).map((r, i) => <span key={r._id} title={r.fullName} className={`mini-avatar avatar-${i}`}>{r.fullName.slice(0, 1).toUpperCase()}</span>)}{direct.length > 4 && <span className="mini-avatar more-avatar">+{direct.length - 4}</span>}</div></div><div className="referral-divider"/><div className="referral-link-row"><div><span>Your referral code</span><strong>{user?.referralCode || '—'}</strong></div><button onClick={() => { navigator.clipboard?.writeText(user?.referralCode || ''); setNotice('Referral code copied (if clipboard access is available).'); }} className="copy-button">Copy code</button></div><button className="text-link" onClick={() => { setActiveTab('Referrals'); document.getElementById('referrals')?.scrollIntoView({ behavior: 'smooth' }); }}>Explore referral tree <ArrowUpRight size={15}/></button></article></section>
  <section className="panel table-panel" id="investments"><div className="panel-header"><div><h2>Investment history</h2><p>Review your investment plans and current status</p></div><div className="table-actions"><div className="search-input"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search plans"/></div><select className="outline-button" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option>Active</option><option>Completed</option><option>Cancelled</option></select><button className="outline-button" onClick={downloadCsv}><Download size={15}/> Export</button><button className="outline-button" onClick={() => { setInvestError(''); setShowInvestment(true); }}><Plus size={15}/> Add</button></div></div><div className="table-scroll"><table><thead><tr><th>PLAN</th><th>INVESTMENT</th><th>START DATE</th><th>END DATE</th><th>DAILY ROI</th><th>STATUS</th></tr></thead><tbody>{inv.rows.length ? inv.rows.map(i => <tr key={i._id}><td><div className="plan-cell"><span className="plan-icon"><CircleDollarSign size={17}/></span><span><strong>{i.planName}</strong><small>#{i._id.slice(-6).toUpperCase()}</small></span></div></td><td className="amount-cell">{money(i.amount)}</td><td>{date(i.startDate)}</td><td>{date(i.endDate)}</td><td>{Number(i.dailyRoiPercent).toFixed(2)}%</td><td><Status value={i.status}/></td></tr>) : <Empty text={inv.loading ? 'Loading investments…' : (search || statusFilter ? 'No investments match your filters.' : 'No investment records yet. Add funds, then create one.')}/>}</tbody></table></div><div className="table-footer"><span>Showing <strong>{inv.rows.length}</strong> of <strong>{inv.total}</strong> records · Amounts in INR</span><div className="pager"><button className="outline-button" disabled={inv.page <= 1 || inv.loading} onClick={() => setPage((x) => Math.max(1, x - 1))}>Prev</button><span>Page {inv.page} of {inv.pages}</span><button className="outline-button" disabled={inv.page >= inv.pages || inv.loading} onClick={() => setPage((x) => x + 1)}>Next</button></div></div></section>
  <section className="history-grid" id="roi-history"><article className="panel table-panel"><div className="panel-header"><div><h2>ROI history</h2><p>Daily returns recorded by the scheduler</p></div><span className="mini-icon green"><TrendingUp size={17}/></span></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>INVESTMENT</th><th>ROI AMOUNT</th><th>STATUS</th></tr></thead><tbody>{histories.roiHistory.length ? histories.roiHistory.slice(0, 6).map((r) => <tr key={r._id}><td>{date(r.date)}</td><td>{r.investment?.planName || 'Investment'}</td><td className="amount-cell positive">+{money(r.amount)}</td><td><Status value={r.status}/></td></tr>) : <Empty text="No ROI entries recorded yet."/>}</tbody></table></div></article><article className="panel table-panel"><div className="panel-header"><div><h2>Referral income</h2><p>Level earnings credited to your wallet</p></div><span className="mini-icon purple"><Users size={17}/></span></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>GENERATED BY</th><th>LEVEL</th><th>AMOUNT</th></tr></thead><tbody>{histories.referralIncome.length ? histories.referralIncome.slice(0, 6).map((r) => <tr key={r._id}><td>{date(r.date)}</td><td>{r.generatedBy?.fullName || 'Member'}</td><td><span className="level-pill">L{r.level}</span></td><td className="amount-cell positive">+{money(r.amount)}</td></tr>) : <Empty text="No referral income entries yet."/>}</tbody></table></div></article></section>
  <section className="panel table-panel" id="deposits"><div className="panel-header"><div><h2>Wallet deposits</h2><p>Requests are credited after an admin approves them</p></div><button className="outline-button" onClick={() => { setDepositNotice(''); setShowDeposit(true); }}><Plus size={15}/> Add funds</button></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>REFERENCE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>{deposits.length ? deposits.map((d) => <tr key={d._id}><td>{date(d.createdAt)}</td><td>{d.reference}</td><td className="amount-cell">{money(d.amount)}</td><td><Status value={d.status}/></td></tr>) : <Empty text="No deposit requests yet."/>}</tbody></table></div></section>
  <section className="panel tree-panel" id="referrals"><div className="panel-header"><div><h2>Referral tree</h2><p>Explore your referral hierarchy up to five levels</p></div><span className="range-chip"><Users size={14}/> {direct.length} direct</span></div><ReferralTree tree={tree}/></section>
  <footer className="page-footer"><span>© {new Date().getFullYear()} Nexachain AI · Assessment demo</span><span><ShieldCheck size={14}/> Secure session <i/> All values are demonstration data</span></footer>
  </div></main>
  {showDeposit && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowDeposit(false); }}><div className="modal"><div className="modal-heading"><div><span className="eyebrow">WALLET</span><h2>Request a deposit</h2><p>Pay using your usual method, then enter the payment reference. An admin verifies it and credits your wallet.</p></div><button className="icon-button" onClick={() => setShowDeposit(false)} aria-label="Close"><X size={18}/></button></div><form className="investment-form" onSubmit={requestDeposit}><label>Amount (INR)<input type="number" min="1" max="1000000" step="0.01" value={depositForm.amount} onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })} required/></label><label>Payment reference<input value={depositForm.reference} onChange={e => setDepositForm({ ...depositForm, reference: e.target.value })} placeholder="e.g. UPI / bank transaction ID" maxLength={100} required/></label><div className="assumption-note"><ShieldCheck size={16}/><span>Demo wallet only: no real payment is processed by this app.</span></div>{depositNotice && <div className="error-box">{depositNotice}</div>}<div className="modal-actions"><button type="button" className="outline-button" onClick={() => setShowDeposit(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Submitting…' : 'Submit request'} <ArrowRight size={16}/></button></div></form></div></div>}
  {showInvestment && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowInvestment(false); }}><div className="modal"><div className="modal-heading"><div><span className="eyebrow">PORTFOLIO</span><h2>Create investment record</h2><p>Use sample values to test the assessment workflow.</p></div><button className="icon-button" onClick={() => setShowInvestment(false)} aria-label="Close"><X size={18}/></button></div><form className="investment-form" onSubmit={createInvestment}><label>Plan name<input value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} required maxLength={80}/></label><label>Investment amount (INR)<input type="number" min="1" max="1000000" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required/></label><label>Duration (days)<input type="number" min="1" max="3650" value={form.durationDays} onChange={e => setForm({ ...form, durationDays: e.target.value })} required/></label><div className="assumption-note"><ShieldCheck size={16}/><span>The amount is deducted from your wallet and returned when the plan ends. Daily ROI uses the configured demo rate; no real returns are promised.</span></div>{investError && <div className="error-box">{investError}</div>}<div className="modal-actions"><button type="button" className="outline-button" onClick={() => setShowInvestment(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Creating…' : 'Create record'} <ArrowRight size={16}/></button></div></form></div></div>}
  </div>;
}
function Layers3Icon() { return <span className="layers-icon">N</span>; }
