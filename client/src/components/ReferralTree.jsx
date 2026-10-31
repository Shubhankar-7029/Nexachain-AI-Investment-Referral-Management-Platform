import { ChevronDown, ChevronRight, GitBranch, UserRound } from 'lucide-react';
import { useState } from 'react';
function TreeNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  return <div className="tree-node"><div className="tree-person" style={{ marginLeft: depth * 20 }}>
    <button className="tree-toggle" onClick={() => setOpen(!open)} disabled={!hasChildren} aria-label={open ? 'Collapse referrals' : 'Expand referrals'}>{hasChildren ? (open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>) : <span className="toggle-spacer"/>}</button>
    <span className="tree-avatar"><UserRound size={16}/></span><span className="tree-name">{node.fullName}</span><span className="tree-level">{depth === 0 ? 'You' : `Level ${depth}`}</span>
  </div>{open && hasChildren && <div className="tree-children">{node.children.map((child) => <TreeNode key={child._id} node={child} depth={depth + 1}/>)}</div>}</div>;
}
export default function ReferralTree({ tree }) { if (!tree) return <div className="empty-state">Referral tree will appear here when referrals join.</div>; return <div className="referral-tree"><div className="tree-caption"><GitBranch size={15}/> Referral network <span>{count(tree) - 1} members</span></div><TreeNode node={tree}/></div>; }
function count(node) { return 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0); }
