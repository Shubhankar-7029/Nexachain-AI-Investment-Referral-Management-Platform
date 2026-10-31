export default function StatCard({ title, value, hint, icon: Icon, tone = 'blue' }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={20}/></div><div className="stat-title">{title}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></article>;
}
