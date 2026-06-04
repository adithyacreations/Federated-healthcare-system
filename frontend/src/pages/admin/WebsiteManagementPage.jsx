import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';

const DEV_DEFAULT = {
  name: '', role: '', department: 'MCA Final Year', college: 'MIIT',
  github_url: '', linkedin_url: '', email: '', order: 0,
};

const FEATURE_DEFAULT = {
  title: '', description: '', icon: '⚙️', category: 'General', order: 0,
};

const DEV_FIELDS = [
  { key: 'name', label: 'Full Name *', placeholder: 'e.g. Adithya M' },
  { key: 'role', label: 'Role *', placeholder: 'e.g. Full Stack Developer' },
  { key: 'department', label: 'Department', placeholder: 'e.g. MCA Final Year' },
  { key: 'college', label: 'College', placeholder: 'MIIT' },
  { key: 'email', label: 'Email', placeholder: 'email@example.com' },
  { key: 'github_url', label: 'GitHub URL', placeholder: 'https://github.com/...' },
  { key: 'linkedin_url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...' },
];

const inputStyle = {
  width: '100%', padding: '10px 14px', border: '1.5px solid #E5E5E5',
  borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box', outline: 'none',
};

const orangeBtn = {
  padding: '10px 20px', backgroundColor: '#F97316', color: 'white',
  border: 'none', borderRadius: '12px', fontWeight: '600', cursor: 'pointer',
};

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export default function WebsiteManagementPage() {
  const [activeTab, setActiveTab] = useState('developers');
  const [developers, setDevelopers] = useState([]);
  const [features, setFeatures] = useState([]);
  const [showAddDev, setShowAddDev] = useState(false);
  const [showAddFeature, setShowAddFeature] = useState(false);
  const [editingDev, setEditingDev] = useState(null);
  const [editingFeature, setEditingFeature] = useState(null);
  const [saving, setSaving] = useState(false);

  const [devForm, setDevForm] = useState(DEV_DEFAULT);
  const [devPhoto, setDevPhoto] = useState(null);
  const [devPhotoPreview, setDevPhotoPreview] = useState(null);

  const [featureForm, setFeatureForm] = useState(FEATURE_DEFAULT);
  const [featurePhoto, setFeaturePhoto] = useState(null);
  const [featurePhotoPreview, setFeaturePhotoPreview] = useState(null);

  const fetchDevelopers = async () => {
    try {
      const res = await API.get('/api/admin/developers/');
      if (res.data.success) setDevelopers(res.data.data);
    } catch (e) { console.log(e); }
  };

  const fetchFeatures = async () => {
    try {
      const res = await API.get('/api/admin/features/');
      if (res.data.success) setFeatures(res.data.data);
    } catch (e) { console.log(e); }
  };

  useEffect(() => {
    fetchDevelopers();
    fetchFeatures();
  }, []);

  const handleDevPhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDevPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setDevPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleFeaturePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFeaturePhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setFeaturePhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const resetDevForm = () => {
    setShowAddDev(false);
    setEditingDev(null);
    setDevForm(DEV_DEFAULT);
    setDevPhoto(null);
    setDevPhotoPreview(null);
  };

  const resetFeatureForm = () => {
    setShowAddFeature(false);
    setEditingFeature(null);
    setFeatureForm(FEATURE_DEFAULT);
    setFeaturePhoto(null);
    setFeaturePhotoPreview(null);
  };

  const saveDeveloper = async () => {
    if (!devForm.name?.trim() || !devForm.role?.trim()) {
      toast.error('Name and role are required');
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      Object.entries(devForm).forEach(([key, val]) => formData.append(key, val));
      if (devPhoto) formData.append('photo', devPhoto);

      if (editingDev) {
        await API.put(`/api/admin/developers/${editingDev.developer_id}/`, formData, multipart);
        toast.success('Developer updated!');
      } else {
        await API.post('/api/admin/developers/', formData, multipart);
        toast.success('Developer added!');
      }
      resetDevForm();
      fetchDevelopers();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save!');
    } finally {
      setSaving(false);
    }
  };

  const deleteDeveloper = async (id) => {
    if (!window.confirm('Remove this developer?')) return;
    try {
      await API.delete(`/api/admin/developers/${id}/`);
      toast.success('Removed!');
      fetchDevelopers();
    } catch (e) {
      toast.error('Failed!');
    }
  };

  const saveFeature = async () => {
    if (!featureForm.title?.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      Object.entries(featureForm).forEach(([key, val]) => formData.append(key, val));
      if (featurePhoto) formData.append('photo', featurePhoto);

      if (editingFeature) {
        await API.put(`/api/admin/features/${editingFeature.feature_id}/`, formData, multipart);
        toast.success('Feature updated!');
      } else {
        await API.post('/api/admin/features/', formData, multipart);
        toast.success('Feature added!');
      }
      resetFeatureForm();
      fetchFeatures();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save!');
    } finally {
      setSaving(false);
    }
  };

  const deleteFeature = async (id) => {
    if (!window.confirm('Remove this feature?')) return;
    try {
      await API.delete(`/api/admin/features/${id}/`);
      toast.success('Removed!');
      fetchFeatures();
    } catch (e) {
      toast.error('Failed!');
    }
  };

  const openAddDev = () => {
    setEditingDev(null);
    setDevForm(DEV_DEFAULT);
    setDevPhoto(null);
    setDevPhotoPreview(null);
    setShowAddDev(true);
  };

  const openEditDev = (dev) => {
    setEditingDev(dev);
    setDevForm({
      name: dev.name, role: dev.role, department: dev.department || '',
      college: dev.college || 'MIIT', github_url: dev.github_url || '',
      linkedin_url: dev.linkedin_url || '', email: dev.email || '', order: dev.order || 0,
    });
    setDevPhoto(null);
    setDevPhotoPreview(dev.photo);
    setShowAddDev(true);
  };

  const openAddFeature = () => {
    setEditingFeature(null);
    setFeatureForm(FEATURE_DEFAULT);
    setFeaturePhoto(null);
    setFeaturePhotoPreview(null);
    setShowAddFeature(true);
  };

  const openEditFeature = (feat) => {
    setEditingFeature(feat);
    setFeatureForm({
      title: feat.title, description: feat.description || '', icon: feat.icon || '⚙️',
      category: feat.category || 'General', order: feat.order || 0,
    });
    setFeaturePhoto(null);
    setFeaturePhotoPreview(feat.photo);
    setShowAddFeature(true);
  };

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink font-bricolage">🌐 Website Management</h1>
          <p className="text-gray-500 text-sm">Manage developers and feature showcase on the landing page</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'developers', label: '👥 Developers', count: developers.length },
          { key: 'features', label: '⚡ Features', count: features.length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px', borderRadius: '999px', border: 'none',
              backgroundColor: activeTab === tab.key ? '#F97316' : 'white',
              color: activeTab === tab.key ? 'white' : '#333',
              fontWeight: '600', cursor: 'pointer', fontSize: '14px',
            }}
          >
            {tab.label}
            <span style={{
              marginLeft: '6px',
              backgroundColor: activeTab === tab.key ? 'rgba(255,255,255,0.3)' : '#F3F4F6',
              padding: '1px 8px', borderRadius: '999px', fontSize: '12px',
            }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* DEVELOPERS TAB */}
      {activeTab === 'developers' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openAddDev} style={orangeBtn}>+ Add Developer</button>
          </div>

          {developers.length === 0 ? (
            <div className="bg-white border border-hairline rounded-2xl p-10 text-center text-gray-400">
              No developers yet. Click “+ Add Developer” to add one.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {developers.map((dev) => (
                <div key={dev.developer_id} style={{ backgroundColor: 'white', borderRadius: '16px', overflow: 'hidden', border: '1px solid #E5E5E5' }}>
                  <div style={{ height: '160px', backgroundColor: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {dev.photo ? (
                      <img src={dev.photo} alt={dev.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#F97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: 'white', fontWeight: '700' }}>
                        {dev.name?.charAt(0)}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '16px' }}>
                    <p style={{ fontWeight: '700', fontSize: '16px', margin: '0 0 4px' }}>{dev.name}</p>
                    <p style={{ color: '#F97316', fontSize: '13px', fontWeight: '600', margin: '0 0 2px' }}>{dev.role}</p>
                    <p style={{ color: '#9CA3AF', fontSize: '12px', margin: '0 0 12px' }}>{dev.college || 'MIIT'}</p>

                    {(dev.github_url || dev.linkedin_url) && (
                      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                        {dev.github_url && (
                          <a href={dev.github_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: '#F97316', textDecoration: 'none' }}>GitHub →</a>
                        )}
                        {dev.linkedin_url && (
                          <a href={dev.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: '#0077B5', textDecoration: 'none' }}>LinkedIn →</a>
                        )}
                      </div>
                    )}

                    {!dev.is_active && (
                      <span style={{ display: 'inline-block', fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#FEF2F2', color: '#EF4444', fontWeight: '600', marginBottom: '12px' }}>
                        Hidden
                      </span>
                    )}

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => openEditDev(dev)} style={{ flex: 1, padding: '8px', border: '1px solid #E5E5E5', borderRadius: '8px', backgroundColor: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>✏️ Edit</button>
                      <button onClick={() => deleteDeveloper(dev.developer_id)} style={{ flex: 1, padding: '8px', border: '1px solid #FCA5A5', borderRadius: '8px', backgroundColor: '#FEF2F2', color: '#EF4444', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🗑️ Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FEATURES TAB */}
      {activeTab === 'features' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openAddFeature} style={orangeBtn}>+ Add Feature</button>
          </div>

          {features.length === 0 ? (
            <div className="bg-white border border-hairline rounded-2xl p-10 text-center text-gray-400">
              No features yet. Click “+ Add Feature” to add one.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {features.map((feat) => (
                <div key={feat.feature_id} style={{ backgroundColor: 'white', borderRadius: '16px', overflow: 'hidden', border: '1px solid #E5E5E5' }}>
                  <div style={{ height: '140px', backgroundColor: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {feat.photo ? (
                      <img src={feat.photo} alt={feat.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '48px' }}>{feat.icon || '⚙️'}</span>
                    )}
                  </div>

                  <div style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '20px' }}>{feat.icon}</span>
                      <p style={{ fontWeight: '700', fontSize: '15px', margin: 0 }}>{feat.title}</p>
                    </div>
                    <p style={{ color: '#666', fontSize: '12px', margin: '0 0 8px', lineHeight: '1.4' }}>
                      {feat.description?.slice(0, 80)}{feat.description?.length > 80 ? '...' : ''}
                    </p>
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#FFF7ED', color: '#F97316', fontWeight: '600' }}>
                      {feat.category}
                    </span>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <button onClick={() => openEditFeature(feat)} style={{ flex: 1, padding: '8px', border: '1px solid #E5E5E5', borderRadius: '8px', backgroundColor: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>✏️ Edit</button>
                      <button onClick={() => deleteFeature(feat.feature_id)} style={{ flex: 1, padding: '8px', border: '1px solid #FCA5A5', borderRadius: '8px', backgroundColor: '#FEF2F2', color: '#EF4444', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>🗑️ Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ADD/EDIT DEVELOPER MODAL */}
      {showAddDev && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontWeight: '700', fontSize: '18px', margin: 0 }}>{editingDev ? '✏️ Edit Developer' : '+ Add Developer'}</h3>
              <button onClick={resetDevForm} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#666' }}>✕</button>
            </div>

            <label style={{ display: 'block', border: '2px dashed #E5E5E5', borderRadius: '12px', padding: '16px', textAlign: 'center', cursor: 'pointer', marginBottom: '16px' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleDevPhotoChange} />
              {devPhotoPreview ? (
                <div>
                  <img src={devPhotoPreview} alt="Preview" style={{ width: '100px', height: '100px', borderRadius: '50%', objectFit: 'cover', margin: '0 auto' }} />
                  <p style={{ fontSize: '12px', color: '#F97316', marginTop: '8px' }}>Click to change photo</p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '32px', margin: 0 }}>👤</p>
                  <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>Click to upload developer photo</p>
                </div>
              )}
            </label>

            {DEV_FIELDS.map((field) => (
              <div key={field.key} style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>{field.label}</label>
                <input
                  value={devForm[field.key]}
                  onChange={(e) => setDevForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = '#F97316')}
                  onBlur={(e) => (e.target.style.borderColor = '#E5E5E5')}
                />
              </div>
            ))}

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>Display Order</label>
              <input
                type="number"
                value={devForm.order}
                onChange={(e) => setDevForm((prev) => ({ ...prev, order: e.target.value }))}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = '#F97316')}
                onBlur={(e) => (e.target.style.borderColor = '#E5E5E5')}
              />
            </div>

            <button onClick={saveDeveloper} disabled={saving} style={{ width: '100%', padding: '14px', backgroundColor: '#F97316', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', fontSize: '15px', cursor: 'pointer', marginTop: '8px', opacity: saving ? 0.6 : 1 }}>
              {editingDev ? '💾 Update Developer' : '+ Add Developer'}
            </button>
          </div>
        </div>
      )}

      {/* ADD/EDIT FEATURE MODAL */}
      {showAddFeature && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontWeight: '700', fontSize: '18px', margin: 0 }}>{editingFeature ? '✏️ Edit Feature' : '+ Add Feature'}</h3>
              <button onClick={resetFeatureForm} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#666' }}>✕</button>
            </div>

            <label style={{ display: 'block', border: '2px dashed #E5E5E5', borderRadius: '12px', padding: '16px', textAlign: 'center', cursor: 'pointer', marginBottom: '16px' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFeaturePhotoChange} />
              {featurePhotoPreview ? (
                <div>
                  <img src={featurePhotoPreview} alt="Preview" style={{ width: '100%', maxHeight: '140px', borderRadius: '10px', objectFit: 'cover' }} />
                  <p style={{ fontSize: '12px', color: '#F97316', marginTop: '8px' }}>Click to change screenshot</p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '32px', margin: 0 }}>🖼️</p>
                  <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>Click to upload feature screenshot</p>
                </div>
              )}
            </label>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>Title *</label>
              <input value={featureForm.title} onChange={(e) => setFeatureForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. AI Symptom Checker" style={inputStyle} onFocus={(e) => (e.target.style.borderColor = '#F97316')} onBlur={(e) => (e.target.style.borderColor = '#E5E5E5')} />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>Description</label>
              <textarea rows={3} value={featureForm.description} onChange={(e) => setFeatureForm((p) => ({ ...p, description: e.target.value }))} placeholder="Short description of the feature" style={{ ...inputStyle, resize: 'vertical' }} onFocus={(e) => (e.target.style.borderColor = '#F97316')} onBlur={(e) => (e.target.style.borderColor = '#E5E5E5')} />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              <div style={{ width: '90px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>Icon</label>
                <input value={featureForm.icon} onChange={(e) => setFeatureForm((p) => ({ ...p, icon: e.target.value }))} placeholder="🧠" maxLength={4} style={{ ...inputStyle, textAlign: 'center', fontSize: '20px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>Category</label>
                <input value={featureForm.category} onChange={(e) => setFeatureForm((p) => ({ ...p, category: e.target.value }))} placeholder="e.g. AI, Emergency, Lab" style={inputStyle} onFocus={(e) => (e.target.style.borderColor = '#F97316')} onBlur={(e) => (e.target.style.borderColor = '#E5E5E5')} />
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '5px', color: '#333' }}>Display Order</label>
              <input type="number" value={featureForm.order} onChange={(e) => setFeatureForm((p) => ({ ...p, order: e.target.value }))} style={inputStyle} onFocus={(e) => (e.target.style.borderColor = '#F97316')} onBlur={(e) => (e.target.style.borderColor = '#E5E5E5')} />
            </div>

            <button onClick={saveFeature} disabled={saving} style={{ width: '100%', padding: '14px', backgroundColor: '#F97316', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', fontSize: '15px', cursor: 'pointer', marginTop: '8px', opacity: saving ? 0.6 : 1 }}>
              {editingFeature ? '💾 Update Feature' : '+ Add Feature'}
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
