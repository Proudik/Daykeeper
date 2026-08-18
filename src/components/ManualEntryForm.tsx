import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Matter, ActivityType, ManualEntry } from '@/types';
import { X } from 'lucide-react';

interface ManualEntryFormProps {
  workDate: string;
  matters: Matter[];
  activityTypes: ActivityType[];
  onSaved: (entry: ManualEntry) => void;
  onCancel: () => void;
}

export function ManualEntryForm({
  workDate,
  matters,
  activityTypes,
  onSaved,
  onCancel,
}: ManualEntryFormProps) {
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [description, setDescription] = useState('');
  const [activityType, setActivityType] = useState('');
  const [matterId, setMatterId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim() || duration <= 0) return;
    setSaving(true);
    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from('manual_entries')
        .insert({
          work_date: workDate,
          start_time: startTime || null,
          duration_minutes: duration,
          description: description.trim(),
          activity_type: activityType || null,
          matter_id: matterId || null,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;
      onSaved(data as ManualEntry);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  }

  const openMatters = matters.filter((m) => m.state_is_open);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-900">Add manual entry</h2>
          <button onClick={onCancel} className="btn-ghost px-1 py-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="start-time">Start time (optional)</label>
              <input
                id="start-time"
                type="time"
                className="input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="duration">Duration (minutes)</label>
              <input
                id="duration"
                type="number"
                min={1}
                step={1}
                className="input"
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
                required
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="matter">Matter</label>
            <select
              id="matter"
              className="input"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
            >
              <option value="">— Select matter —</option>
              {openMatters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.case_id_visible ?? m.external_id} — {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="activity">Activity type</label>
            <select
              id="activity"
              className="input"
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
            >
              <option value="">— None —</option>
              {activityTypes.map((t) => (
                <option key={t.id} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="desc">Description</label>
            <textarea
              id="desc"
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Court hearing — Krajský soud, hearing on preliminary injunction"
              required
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={saving || !description.trim()} className="btn-primary">
              {saving ? 'Saving...' : 'Add entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
