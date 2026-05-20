import { useState } from 'react';
import { MessageSquare, Plus, Trash2, Copy, Edit3, Search, CheckSquare, Square } from 'lucide-react';
import type { CommentTemplate } from '../types';

function generateId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

const STORAGE_KEY = 'mmb-sites-comments';
const MAX_CHARS = 500;

function loadTemplates(): CommentTemplate[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveTemplates(data: CommentTemplate[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

const CATEGORIES = ['General', 'Appreciation', 'Question', 'Feedback', 'Technical', 'Casual'];

export default function CommentTemplatesPage() {
  const [templates, setTemplates]         = useState<CommentTemplate[]>(loadTemplates);
  const [showAdd, setShowAdd]             = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CommentTemplate | null>(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [search, setSearch]               = useState('');
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  const persist = (next: CommentTemplate[]) => { setTemplates(next); saveTemplates(next); };

  const addTemplate = (text: string, category: string) => {
    const entry: CommentTemplate = { id: generateId(), text, category, usedCount: 0 };
    persist([...templates, entry]);
    showToast('Template added');
  };

  const updateTemplate = (id: string, text: string, category: string) => {
    persist(templates.map(t => t.id === id ? { ...t, text, category } : t));
    showToast('Template updated');
  };

  const deleteTemplate = (id: string) => {
    persist(templates.filter(t => t.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const deleteSelected = () => {
    if (selected.size === 0) return;
    persist(templates.filter(t => !selected.has(t.id)));
    setSelected(new Set());
    showToast(`Deleted ${selected.size} templates`);
  };

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const selectAll = () => setSelected(new Set(filtered.map(t => t.id)));
  const deselectAll = () => setSelected(new Set());

  const filtered = templates.filter(t => {
    const catMatch = filterCategory === 'all' || t.category === filterCategory;
    const txtMatch = !search || t.text.toLowerCase().includes(search.toLowerCase());
    return catMatch && txtMatch;
  });

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-xl border
          ${toast.ok ? 'bg-green-900/90 border-green-600/40 text-green-300' : 'bg-red-900/90 border-red-600/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare size={20} className="text-yellow-400" />
          <span className="text-white font-medium">Comment Templates ({templates.length})</span>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 bg-yellow-600 rounded-lg text-white text-xs hover:bg-yellow-500 transition-all">
          <Plus size={12} /> Add Template
        </button>
      </div>

      <p className="text-gray-500 text-xs">
        Pre-saved comments for blog posts. These will be randomly picked when commenting is enabled for a profile.
      </p>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-white text-xs outline-none focus:border-yellow-500"
        />
      </div>

      {/* Filter + Bulk actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilterCategory('all')}
          className={`px-2.5 py-1 rounded-lg text-xs border ${filterCategory === 'all' ? 'bg-yellow-600/20 border-yellow-600/40 text-yellow-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
          All ({templates.length})
        </button>
        {CATEGORIES.map(cat => {
          const count = templates.filter(t => t.category === cat).length;
          return (
            <button key={cat} onClick={() => setFilterCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs border ${filterCategory === cat ? 'bg-yellow-600/20 border-yellow-600/40 text-yellow-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              {cat} {count > 0 && `(${count})`}
            </button>
          );
        })}

        {filtered.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={selected.size === filtered.length ? deselectAll : selectAll}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-all">
              {selected.size === filtered.length
                ? <><CheckSquare size={12} /> Deselect All</>
                : <><Square size={12} /> Select All</>}
            </button>
            {selected.size > 0 && (
              <button onClick={deleteSelected}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 bg-red-900/20 border border-red-700/30 px-2.5 py-1 rounded-lg transition-all">
                <Trash2 size={11} /> Delete ({selected.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Templates */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <MessageSquare size={48} className="mb-4 opacity-30" />
          <p className="text-sm">{search ? 'No matching templates' : 'No templates yet'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(t => (
            <div key={t.id}
              className={`bg-gray-900 border rounded-xl p-4 transition-all ${
                selected.has(t.id) ? 'border-yellow-600/50 bg-yellow-900/5' : 'border-gray-800'
              }`}>
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => toggleSelect(t.id)} className="flex-shrink-0 mt-0.5 text-gray-500 hover:text-yellow-400 transition-all">
                  {selected.has(t.id) ? <CheckSquare size={13} className="text-yellow-400" /> : <Square size={13} />}
                </button>
                <p className="text-gray-300 text-sm flex-1">{t.text}</p>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => navigator.clipboard.writeText(t.text)} title="Copy"
                    className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-gray-300 transition-all">
                    <Copy size={12} />
                  </button>
                  <button onClick={() => setEditingTemplate(t)} title="Edit"
                    className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-yellow-400 transition-all">
                    <Edit3 size={12} />
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} title="Delete"
                    className="p-1 hover:bg-red-900/30 rounded text-red-400 transition-all">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">{t.category}</span>
                <span className="text-xs text-gray-600">Used: {t.usedCount}x</span>
                <span className="text-xs text-gray-700 ml-auto">{t.text.length} chars</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <TemplateModal
          title="Add Comment Template"
          onSave={(text, category) => { addTemplate(text, category); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Edit Modal */}
      {editingTemplate && (
        <TemplateModal
          title="Edit Template"
          initialText={editingTemplate.text}
          initialCategory={editingTemplate.category}
          onSave={(text, category) => { updateTemplate(editingTemplate.id, text, category); setEditingTemplate(null); }}
          onClose={() => setEditingTemplate(null)}
        />
      )}
    </div>
  );
}

function TemplateModal({
  title,
  initialText = '',
  initialCategory = 'General',
  onSave,
  onClose,
}: {
  title: string;
  initialText?: string;
  initialCategory?: string;
  onSave: (text: string, category: string) => void;
  onClose: () => void;
}) {
  const [text, setText]         = useState(initialText);
  const [category, setCategory] = useState(initialCategory);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-4">{title}</h2>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-gray-400 text-xs">Comment Text</label>
              <span className={`text-xs ${text.length > MAX_CHARS ? 'text-red-400' : 'text-gray-500'}`}>
                {text.length}/{MAX_CHARS}
              </span>
            </div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
              maxLength={MAX_CHARS}
              placeholder="Great article! Really helpful information..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none resize-none focus:border-yellow-500" />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 text-sm hover:text-white">Cancel</button>
            <button onClick={() => { if (text.trim()) onSave(text.trim(), category); }}
              disabled={!text.trim() || text.length > MAX_CHARS}
              className="px-4 py-2 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-500 disabled:opacity-50 transition-all">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
