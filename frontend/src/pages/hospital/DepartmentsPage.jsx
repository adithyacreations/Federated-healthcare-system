import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiBriefcase, FiPlus, FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const DepartmentsPage = () => {
  const departments = useApi('/api/hospital/departments/');
  const [form, setForm] = useState({ dept_name: '', description: '' });
  const [adding, setAdding] = useState(false);
  const [deptPhoto, setDeptPhoto] = useState(null);
  const [deptPhotoPreview, setDeptPhotoPreview] = useState(null);

  const deptList = Array.isArray(departments.data) ? departments.data : departments.data?.data || [];

  const handleDeptPhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDeptPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setDeptPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.dept_name.trim()) { toast.error('Department name is required'); return; }
    setAdding(true);
    try {
      const formData = new FormData();
      formData.append('dept_name', form.dept_name);
      formData.append('description', form.description || '');
      if (deptPhoto) formData.append('department_photo', deptPhoto);
      await API.post('/api/hospital/departments/add/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Department added');
      departments.refetch();
      setForm({ dept_name: '', description: '' });
      setDeptPhoto(null);
      setDeptPhotoPreview(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add department');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdatePhoto = async (deptId, file) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('department_photo', file);
      await API.put(`/api/hospital/departments/${deptId}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Department photo updated');
      departments.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update photo');
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Departments</h1>
          <p className="text-sm text-gray-500">Manage hospital departments</p>
        </div>
        <button
          onClick={departments.refetch}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ─── Add Department Form ───────────────────────────────── */}
      <section className="card mb-8">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-700 mb-4">
          <FiPlus className="w-4 h-4" /> Add Department
        </h2>
        <form onSubmit={handleAdd} className="space-y-3">
          {/* Optional department photo */}
          <div className="sm:max-w-xs">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Department Photo <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <label
              htmlFor="dept-photo"
              className="block border-2 border-dashed rounded-xl text-center cursor-pointer transition"
              style={{
                borderColor: deptPhotoPreview ? '#F97316' : '#E5E5E5',
                backgroundColor: deptPhotoPreview ? '#FFF7ED' : 'white',
                padding: deptPhotoPreview ? '12px' : '16px',
              }}
            >
              <input id="dept-photo" type="file" accept="image/*" className="hidden" onChange={handleDeptPhotoChange} />
              {deptPhotoPreview ? (
                <div>
                  <img src={deptPhotoPreview} alt="Dept preview" className="w-full object-cover rounded-lg" style={{ height: '120px' }} />
                  <p className="text-xs mt-2" style={{ color: '#F97316' }}>✅ Click to change</p>
                </div>
              ) : (
                <div>
                  <p className="text-3xl mb-1">🏥</p>
                  <p className="font-semibold text-gray-600 text-[13px]">Upload department photo</p>
                  <p className="text-[11px] text-gray-400">JPG, PNG — Optional</p>
                </div>
              )}
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Department Name *</label>
            <input
              placeholder="e.g. Cardiology"
              value={form.dept_name}
              onChange={(e) => setForm((p) => ({ ...p, dept_name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              placeholder="Brief description"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="inline-flex items-center justify-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-60"
          >
            <FiPlus className="w-4 h-4" />
            {adding ? 'Adding…' : 'Add Department'}
          </button>
          </div>
        </form>
      </section>

      {/* ─── Departments Grid ─────────────────────────────────── */}
      <section>
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-700 mb-4">
          <FiBriefcase className="w-4 h-4" /> All Departments
          <span className="ml-1 text-xs bg-primary-100 text-primary-600 px-2 py-0.5 rounded-full font-semibold">
            {deptList.length}
          </span>
        </h2>
        {departments.loading ? (
          <div className="card text-center text-gray-400 py-8">Loading departments…</div>
        ) : deptList.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-4xl mb-3">🏥</div>
            <p className="text-gray-500 font-medium">No departments added yet.</p>
            <p className="text-gray-400 text-sm mt-1">Use the form above to add your first department.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {deptList.map((d) => (
              <div key={d.dept_id} className="card hover:border-primary-200 hover:shadow-md transition border border-transparent">
                {d.department_photo ? (
                  <div className="relative group">
                    <img
                      src={d.department_photo}
                      alt={d.dept_name}
                      className="w-full h-28 object-cover rounded-xl mb-3"
                    />
                    <label className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition rounded-xl mb-3 flex items-center justify-center cursor-pointer text-sm font-medium">
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => handleUpdatePhoto(d.dept_id, e.target.files?.[0])} 
                      />
                      Change Photo
                    </label>
                  </div>
                ) : (
                  <label
                    className="w-full h-28 rounded-xl mb-3 flex flex-col items-center justify-center text-4xl cursor-pointer hover:bg-orange-100 transition group relative"
                    style={{ backgroundColor: '#FFF7ED' }}
                  >
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleUpdatePhoto(d.dept_id, e.target.files?.[0])} 
                    />
                    🏥
                    <span className="absolute bottom-2 text-[10px] text-orange-500 font-bold opacity-0 group-hover:opacity-100 transition bg-white/80 px-2 py-0.5 rounded-md">
                      Add Photo
                    </span>
                  </label>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                    <FiBriefcase className="w-5 h-5 text-primary-500" />
                  </div>
                  <span className="text-xs bg-primary-50 text-primary-600 px-2.5 py-1 rounded-full font-semibold">
                    {d.doctor_count ?? 0} doctor{(d.doctor_count ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <h3 className="font-bold text-lg text-gray-800">{d.dept_name}</h3>
                {d.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{d.description}</p>
                )}
                <p className="text-xs text-gray-400 mt-3">
                  Added {new Date(d.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </DashboardLayout>
  );
};

export default DepartmentsPage;
