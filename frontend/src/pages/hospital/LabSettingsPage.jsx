import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LAB_SETTINGS_TIMEOUT = 20000;

const LabSettingsPage = () => {
  const [config, setConfig] = useState({
    working_days: [0, 1, 2, 3, 4, 5],
    start_time: '08:00',
    end_time: '18:00',
    slot_duration_minutes: 30,
    max_patients_per_slot: 5,
    lunch_break_start: '13:00',
    lunch_break_end: '14:00',
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setLoadError(null);
    const loadConfig = async () => {
      try {
        const { data } = await API.get('/api/hospital/lab-config/', { signal, timeout: LAB_SETTINGS_TIMEOUT });
        if (signal.aborted) return;
        if (data?.success) setConfig(data.data);
        else setLoadError(data?.message || 'Could not load lab settings.');
      } catch (error) {
        if (!signal.aborted) setLoadError(error?.response?.data?.message || 'Could not load lab settings.');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };
    loadConfig();
    return () => controller.abort();
  }, [loadAttempt]);

  const toggleDay = (index) => {
    setConfig((c) => {
      const days = c.working_days || [];
      return {
        ...c,
        working_days: days.includes(index)
          ? days.filter((d) => d !== index)
          : [...days, index].sort((a, b) => a - b),
      };
    });
  };

  const saveConfig = async () => {
    if (saving || loading || loadError) return;
    try {
      setSaving(true);
      const { data } = await API.put('/api/hospital/lab-config/', config, { timeout: LAB_SETTINGS_TIMEOUT });
      if (!data?.success) {
        toast.error(data?.message || 'Could not save lab settings.');
        return;
      }
      setConfig((c) => ({ ...c, config_id: data.data.config_id, configured: true }));
      toast.success('Lab settings saved and slots generated.');
    } catch (error) {
      toast.error(error?.response?.data?.message || (error?.code === 'ECONNABORTED'
        ? 'Saving took too long. Reload lab settings to check whether it completed.'
        : 'Could not save lab settings.'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400';

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-black">🔬 Lab Settings</h1>
          <p className="text-gray-500 text-sm">Configure lab slot availability for patients</p>
        </div>

        {loading && <p role="status" className="text-sm text-gray-500 mb-4">Loading lab settings…</p>}
        {loadError && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-red-700">{loadError}</p>
            <button type="button" className="btn-orange-outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              Retry loading settings
            </button>
          </div>
        )}

        {/* Not-configured warning — patients can't book until the admin saves. */}
        {config.configured === false && (
          <div
            className="rounded-xl px-5 py-4 mb-6 max-w-3xl flex items-center justify-between gap-4"
            style={{ backgroundColor: '#FFF7ED', border: '1.5px solid #FED7AA' }}
          >
            <div>
              <p className="font-bold m-0 mb-1" style={{ color: '#F97316' }}>⚠️ Lab Not Configured</p>
              <p className="text-[13px] text-gray-600 m-0">
                Patients cannot book lab tests at your hospital until you save your lab schedule below.
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl p-6 border border-gray-100 mb-6 max-w-3xl">
          {/* Working days */}
          <h3 className="font-bold mb-3">📅 Working Days</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
            {DAYS.map((day, index) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(index)}
                className="w-full py-2 px-2 rounded-full text-sm font-medium transition-all text-center"
                style={{
                  backgroundColor: (config.working_days || []).includes(index) ? '#F97316' : '#F3F4F6',
                  color: (config.working_days || []).includes(index) ? 'white' : '#666',
                }}
              >
                {day}
              </button>
            ))}
          </div>

          {/* Working hours */}
          <h3 className="font-bold mb-3">🕐 Working Hours</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">Start Time</label>
              <input type="time" value={config.start_time} onChange={(e) => setConfig({ ...config, start_time: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">End Time</label>
              <input type="time" value={config.end_time} onChange={(e) => setConfig({ ...config, end_time: e.target.value })} className={inputCls} />
            </div>
          </div>

          {/* Lunch break */}
          <h3 className="font-bold mb-3">🍽️ Lunch Break</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">Lunch Start</label>
              <input type="time" value={config.lunch_break_start || '13:00'} onChange={(e) => setConfig({ ...config, lunch_break_start: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">Lunch End</label>
              <input type="time" value={config.lunch_break_end || '14:00'} onChange={(e) => setConfig({ ...config, lunch_break_end: e.target.value })} className={inputCls} />
            </div>
          </div>

          {/* Slot settings */}
          <h3 className="font-bold mb-3">⚙️ Slot Settings</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">Slot Duration (minutes)</label>
              <select
                value={config.slot_duration_minutes}
                onChange={(e) => setConfig({ ...config, slot_duration_minutes: parseInt(e.target.value, 10) })}
                className={inputCls}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">Max Patients per Slot</label>
              <input
                type="number"
                min={1}
                max={20}
                value={config.max_patients_per_slot}
                onChange={(e) => setConfig({ ...config, max_patients_per_slot: parseInt(e.target.value, 10) })}
                className={inputCls}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-gray-600 mb-2">📊 Preview</p>
            <p className="text-sm text-gray-500">
              Working: {DAYS.filter((_, i) => (config.working_days || []).includes(i)).join(', ') || 'None'}
            </p>
            <p className="text-sm text-gray-500">
              Hours: {config.start_time} - {config.end_time} (excl. {config.lunch_break_start}-{config.lunch_break_end})
            </p>
            <p className="text-sm text-gray-500">
              Slots every {config.slot_duration_minutes} min, max {config.max_patients_per_slot} patients each
            </p>
          </div>

          <button
            type="button"
            onClick={saveConfig}
            disabled={saving || loading || Boolean(loadError)}
            className="w-full py-3 rounded-2xl font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: '#F97316' }}
          >
            {saving ? '⏳ Saving & Regenerating Slots...' : '💾 Save Lab Settings'}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LabSettingsPage;
