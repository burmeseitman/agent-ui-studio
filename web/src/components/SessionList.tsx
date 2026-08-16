import React, { useState } from 'react';
import { ChatSession } from '../services/sessions';
import { MessageSquare, Plus, Trash2, Pencil, Check, X } from 'lucide-react';

interface SessionListProps {
  sessions: ChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const startRename = (session: ChatSession) => {
    setEditingId(session.id);
    setDraftTitle(session.title);
  };

  const commitRename = () => {
    if (editingId && draftTitle.trim()) {
      onRename(editingId, draftTitle);
    }
    setEditingId(null);
  };

  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onNew}
        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors shadow-accent-glow"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>New chat</span>
      </button>

      <div className="space-y-1">
        {ordered.map((session) => {
          const isActive = session.id === activeId;
          const isEditing = editingId === session.id;

          if (isEditing) {
            return (
              <div
                key={session.id}
                className="flex items-center space-x-1 p-1.5 rounded-md bg-surface-base border border-accent/40"
              >
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  aria-label="Conversation title"
                  className="flex-1 min-w-0 bg-transparent text-xs text-ink-50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={commitRename}
                  aria-label="Save title"
                  className="text-success-fg hover:text-success-fg shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  aria-label="Cancel rename"
                  className="text-ink-400 hover:text-ink-100 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          }

          return (
            <div
              key={session.id}
              className={`group flex items-center rounded-md border transition-colors ${
                isActive
                  ? 'bg-accent/[0.1] border-accent/30'
                  : 'bg-transparent border-transparent hover:bg-white/[0.04]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                aria-current={isActive ? 'true' : undefined}
                className="flex-1 min-w-0 flex items-center space-x-2 px-2 py-1.5 text-left"
              >
                <MessageSquare
                  className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-accent-fg' : 'text-ink-500'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink-100 truncate">{session.title}</span>
                  <span className="block text-2xs text-ink-600 tabular">
                    {session.messages.length} msg · {relativeTime(session.updatedAt)}
                  </span>
                </span>
              </button>

              <div className="flex items-center space-x-0.5 pr-1.5 shrink-0">
                {confirmingDelete === session.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(session.id);
                        setConfirmingDelete(null);
                      }}
                      aria-label="Confirm delete"
                      className="p-1 text-danger-fg hover:text-danger-fg"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(null)}
                      aria-label="Cancel delete"
                      className="p-1 text-ink-400 hover:text-ink-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startRename(session)}
                      aria-label={`Rename ${session.title}`}
                      className="p-1 text-ink-500 hover:text-ink-100 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(session.id)}
                      aria-label={`Delete ${session.title}`}
                      className="p-1 text-ink-500 hover:text-danger-fg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
