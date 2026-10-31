// Prev / Next control used by every paginated table.
export default function Pager({ page, pages, total, shown, loading, onPage }) {
  return <div className="table-footer"><span>Showing <strong>{shown}</strong> of <strong>{total}</strong></span><div className="pager"><button className="outline-button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>Prev</button><span>Page {page} of {pages}</span><button className="outline-button" disabled={page >= pages || loading} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}
