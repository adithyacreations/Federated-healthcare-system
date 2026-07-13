import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiUsers, FiPlus, FiRefreshCw, FiCopy } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import FormInput from '../../components/auth/FormInput';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const TABS = ['Doctors', 'Lab Technicians', 'Drivers'];

const STATUS_DOT = ({ ok }) => (
  <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-success' : 'bg-gray-300'}`} />
);

// Small red pill shown next to a suspended staff member's name.
const SuspendedBadge = () => (
  <span
    className="ml-1.5 align-middle"
    style={{
      fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
      backgroundColor: '#FEF2F2', color: '#EF4444', fontWeight: 700,
    }}
  >
    SUSPENDED
  </span>
);

const StaffActions = ({ canSetDept, onSetDept, isActive = true, onSuspend, onResume, onTerminate }) => (
  <div className="flex flex-col gap-2 w-full min-w-[120px]">
    {canSetDept && (
      <button
        onClick={onSetDept}
        className="w-full px-3 py-1.5 rounded-md text-xs font-semibold text-center whitespace-nowrap"
        style={{ backgroundColor: '#FFF7ED', color: '#F97316', border: '1px solid #FED7AA' }}
      >
        🏥 Set Dept
      </button>
    )}
    {isActive ? (
      <button
        onClick={onSuspend}
        className="w-full px-3 py-1.5 rounded-md text-xs font-semibold text-center whitespace-nowrap"
        style={{ backgroundColor: '#FFF7ED', color: '#F97316', border: '1px solid #FED7AA' }}
      >
        🔴 Suspend
      </button>
    ) : (
      <button
        onClick={onResume}
        className="w-full px-3 py-1.5 rounded-md text-xs font-semibold text-center whitespace-nowrap"
        style={{ backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}
      >
        ✅ Resume
      </button>
    )}
    <button
      onClick={onTerminate}
      className="w-full px-3 py-1.5 rounded-md text-xs font-semibold text-center whitespace-nowrap"
      style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1.5px solid #FCA5A5' }}
    >
      ⛔ Terminate
    </button>
  </div>
);

const BLANK_DOCTOR = { full_name: '', specialization: '', license_no: '', experience_years: '', consultation_fee: '', email: '', phone: '', dept_id: '' };
const BLANK_LAB    = { full_name: '', qualification: '', specialization: '', phone: '', email: '' };
const BLANK_DRIVER = { full_name: '', license_no: '', phone: '', email: '', vehicle_no: '', ambulance_type: 'basic' };

const StaffPage = () => {
  const [tab, setTab] = useState('Doctors');
  const [modal, setModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);

  const doctors  = useApi('/api/hospital/doctors/');
  const labTechs = useApi('/api/hospital/lab-techs/');
  const drivers  = useApi('/api/hospital/drivers/');
  const deptsApi = useApi('/api/hospital/departments/');
  const departmentList = Array.isArray(deptsApi.data) ? deptsApi.data : deptsApi.data?.data || [];

  const [doctorForm, setDoctorForm] = useState(BLANK_DOCTOR);
  const [labForm,    setLabForm]    = useState(BLANK_LAB);
  const [driverForm, setDriverForm] = useState(BLANK_DRIVER);

  // Inline "set department" fix for doctors created before department selection.
  const [editingDoctor, setEditingDoctor] = useState(null);
  const [selectedDept, setSelectedDept] = useState('');
  const [savingDept, setSavingDept] = useState(false);

  const deptOptions = [
    { value: '', label: 'Select Department…' },
    ...departmentList.map((dp) => ({ value: dp.dept_id, label: dp.dept_name })),
  ];

  const refetchAll = () => { doctors.refetch(); labTechs.refetch(); drivers.refetch(); };

  const saveDoctorDept = async () => {
    if (!selectedDept) { toast.error('Select a department!'); return; }
    setSavingDept(true);
    try {
      await API.put(`/api/hospital/doctors/${editingDoctor.doctor_id}/`, { dept_id: selectedDept });
      toast.success('Department updated!');
      setEditingDoctor(null);
      doctors.refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update department');
    } finally {
      setSavingDept(false);
    }
  };

  // ── Suspend / terminate staff ─────────────────────────────────────────────
  // Staff edit their own profiles, so the hospital admin only assigns departments
  // (doctors) and can suspend / terminate accounts — no general edit here.
  const [actionStaff, setActionStaff] = useState(null); // { role, id, name, email }
  const [actionType, setActionType] = useState('');       // 'suspend' | 'terminate'
  const [actionLoading, setActionLoading] = useState(false);

  const askAction = (role, id, name, email, type) => {
    setActionStaff({ role, id, name, email });
    setActionType(type);
  };

  const handleStaffAction = async () => {
    if (!actionStaff || !actionType) return;
    setActionLoading(true);
    try {
      const { data } = await API.post(
        `/api/hospital/staff/${actionStaff.role}/${actionStaff.id}/action/`,
        { action: actionType }
      );
      toast.success(data?.message || 'Done!');
      if (data?.data?.email_sent) toast.success('📧 Email sent!');
      setActionStaff(null);
      refetchAll();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Action failed!');
    } finally {
      setActionLoading(false);
    }
  };

  const closeModal = () => {
    setModal(null);
    setDoctorForm(BLANK_DOCTOR);
    setLabForm(BLANK_LAB);
    setDriverForm(BLANK_DRIVER);
  };

  const handleAdd = async (kind) => {
    const map = {
      doctor: { url: '/api/hospital/add-doctor/',   form: doctorForm, label: 'Doctor' },
      lab:    { url: '/api/hospital/add-lab-tech/', form: labForm,    label: 'Lab Technician' },
      driver: { url: '/api/hospital/add-driver/',   form: driverForm, label: 'Driver' },
    };
    const { url, form, label } = map[kind];
    setSubmitting(true);
    try {
      const { data } = await API.post(url, form);
      const d = data?.data || {};
      toast.success(`${label} added`);
      setCreated({ kind: label, ...d });
      closeModal();
      doctors.refetch();
      labTechs.refetch();
      drivers.refetch();
    } catch (err) {
      const msg = err?.response?.data?.errors
        ? Object.values(err.response.data.errors).flat().join(' · ')
        : err?.response?.data?.message || `${label} creation failed`;
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const doctorList  = Array.isArray(doctors.data)  ? doctors.data  : doctors.data?.data  || [];
  const labList     = Array.isArray(labTechs.data) ? labTechs.data : labTechs.data?.data || [];
  const driverList  = Array.isArray(drivers.data)  ? drivers.data  : drivers.data?.data  || [];

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Staff Management</h1>
          <p className="text-sm text-gray-500">Manage doctors, lab technicians, and ambulance drivers</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setModal('doctor')} className="inline-flex items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition whitespace-nowrap">
            <FiPlus className="w-4 h-4" /> Doctor
          </button>
          <button onClick={() => setModal('lab')} className="inline-flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-black/80 transition whitespace-nowrap">
            <FiPlus className="w-4 h-4" /> Lab Tech
          </button>
          <button onClick={() => setModal('driver')} className="inline-flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-black/80 transition whitespace-nowrap">
            <FiPlus className="w-4 h-4" /> Driver
          </button>
        </div>
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              tab === t ? 'bg-white text-primary-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
            <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold bg-gray-200 text-gray-600">
              {t === 'Doctors' ? doctorList.length : t === 'Lab Technicians' ? labList.length : driverList.length}
            </span>
          </button>
        ))}
      </div>

      {/* ─── Doctors Table ────────────────────────────────────── */}
      {tab === 'Doctors' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Specialization</th>
                  <th className="px-4 py-3">Fee</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {doctors.loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : doctorList.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No doctors added yet.</td></tr>
                ) : (
                  doctorList.map((d) => (
                    <tr key={d.doctor_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {d.full_name}
                        {d.is_active === false && <SuspendedBadge />}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{d.specialization}</td>
                      <td className="px-4 py-3 font-medium text-gray-700">₹{d.consultation_fee?.toFixed?.(0) ?? d.consultation_fee}</td>
                      <td className="px-4 py-3 text-xs">
                        {d.dept_name ? (
                          <span className="font-semibold" style={{ color: '#F97316' }}>{d.dept_name}</span>
                        ) : (
                          <button
                            onClick={() => { setEditingDoctor(d); setSelectedDept(''); }}
                            className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
                            style={{ backgroundColor: '#FFF7ED', color: '#F97316', border: '1px solid #FED7AA' }}
                          >
                            ⚠️ Set Department
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <STATUS_DOT ok={d.is_online} />
                          {d.is_online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{d.email}</td>
                      <td className="px-4 py-3">
                        <StaffActions
                          canSetDept
                          isActive={d.is_active !== false}
                          onSetDept={() => { setEditingDoctor(d); setSelectedDept(d.dept_id || ''); }}
                          onSuspend={() => askAction('doctor', d.doctor_id, d.full_name, d.email, 'suspend')}
                          onResume={() => askAction('doctor', d.doctor_id, d.full_name, d.email, 'resume')}
                          onTerminate={() => askAction('doctor', d.doctor_id, d.full_name, d.email, 'terminate')}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Lab Techs Table ──────────────────────────────────── */}
      {tab === 'Lab Technicians' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Qualification</th>
                  <th className="px-4 py-3">Specialization</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {labTechs.loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : labList.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No lab technicians added yet.</td></tr>
                ) : (
                  labList.map((lt) => (
                    <tr key={lt.lab_tech_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {lt.full_name}
                        {lt.is_active === false && <SuspendedBadge />}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{lt.qualification || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{lt.specialization || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        📞 {lt.phone || <span className="text-gray-400">No phone number</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{lt.email}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 capitalize">{lt.approval_status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StaffActions
                          isActive={lt.is_active !== false}
                          onSuspend={() => askAction('lab_tech', lt.lab_tech_id, lt.full_name, lt.email, 'suspend')}
                          onResume={() => askAction('lab_tech', lt.lab_tech_id, lt.full_name, lt.email, 'resume')}
                          onTerminate={() => askAction('lab_tech', lt.lab_tech_id, lt.full_name, lt.email, 'terminate')}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Drivers Table ────────────────────────────────────── */}
      {tab === 'Drivers' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">License No</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Vehicle No</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Availability</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {drivers.loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : driverList.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No drivers added yet.</td></tr>
                ) : (
                  driverList.map((dr) => (
                    <tr key={dr.driver_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {dr.full_name}
                        {dr.is_active === false && <SuspendedBadge />}
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{dr.license_no}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{dr.phone}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{dr.vehicle_no || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{dr.ambulance_type || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${dr.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {dr.is_available ? 'Available' : 'On Duty'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StaffActions
                          isActive={dr.is_active !== false}
                          onSuspend={() => askAction('driver', dr.driver_id, dr.full_name, dr.email, 'suspend')}
                          onResume={() => askAction('driver', dr.driver_id, dr.full_name, dr.email, 'resume')}
                          onTerminate={() => askAction('driver', dr.driver_id, dr.full_name, dr.email, 'terminate')}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Add Doctor Modal ─────────────────────────────────── */}
      <Modal isOpen={modal === 'doctor'} onClose={closeModal} title="Add Doctor">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Full Name" value={doctorForm.full_name} onChange={(e) => setDoctorForm({ ...doctorForm, full_name: e.target.value })} />
          <FormInput label="Specialization" value={doctorForm.specialization} onChange={(e) => setDoctorForm({ ...doctorForm, specialization: e.target.value })} />
          {/* Department — picked from this hospital's own departments */}
          {departmentList.length === 0 ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Department</label>
              <div className="rounded-xl px-3 py-2.5 text-sm" style={{ border: '1.5px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#EF4444' }}>
                ❌ No departments added yet!
              </div>
              <p className="text-xs mt-1.5" style={{ color: '#F97316' }}>
                ⚠️ Add departments in the Departments section first.
              </p>
            </div>
          ) : (
            <FormInput
              label="Department"
              as="select"
              value={doctorForm.dept_id}
              onChange={(e) => setDoctorForm({ ...doctorForm, dept_id: e.target.value })}
              options={deptOptions}
            />
          )}
          <FormInput label="License No" value={doctorForm.license_no} onChange={(e) => setDoctorForm({ ...doctorForm, license_no: e.target.value })} />
          <FormInput label="Experience (years)" type="number" value={doctorForm.experience_years} onChange={(e) => setDoctorForm({ ...doctorForm, experience_years: e.target.value })} />
          <FormInput label="Consultation Fee (₹)" type="number" value={doctorForm.consultation_fee} onChange={(e) => setDoctorForm({ ...doctorForm, consultation_fee: e.target.value })} />
          <FormInput label="Email" type="email" value={doctorForm.email} onChange={(e) => setDoctorForm({ ...doctorForm, email: e.target.value })} />
          <FormInput label="Phone" value={doctorForm.phone} onChange={(e) => setDoctorForm({ ...doctorForm, phone: e.target.value })} />
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={closeModal} className="btn-secondary">Cancel</button>
          <button onClick={() => handleAdd('doctor')} disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Adding…' : 'Add Doctor'}
          </button>
        </div>
      </Modal>

      {/* ─── Add Lab Tech Modal ───────────────────────────────── */}
      <Modal isOpen={modal === 'lab'} onClose={closeModal} title="Add Lab Technician">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Full Name" value={labForm.full_name} onChange={(e) => setLabForm({ ...labForm, full_name: e.target.value })} />
          <FormInput label="Qualification" value={labForm.qualification} onChange={(e) => setLabForm({ ...labForm, qualification: e.target.value })} />
          <FormInput label="Specialization" value={labForm.specialization} onChange={(e) => setLabForm({ ...labForm, specialization: e.target.value })} />
          <FormInput label="Phone" value={labForm.phone} onChange={(e) => setLabForm({ ...labForm, phone: e.target.value })} />
          <FormInput label="Email" type="email" value={labForm.email} onChange={(e) => setLabForm({ ...labForm, email: e.target.value })} />
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={closeModal} className="btn-secondary">Cancel</button>
          <button onClick={() => handleAdd('lab')} disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Adding…' : 'Add Lab Tech'}
          </button>
        </div>
      </Modal>

      {/* ─── Add Driver Modal ─────────────────────────────────── */}
      <Modal isOpen={modal === 'driver'} onClose={closeModal} title="Add Ambulance Driver">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Full Name" value={driverForm.full_name} onChange={(e) => setDriverForm({ ...driverForm, full_name: e.target.value })} />
          <FormInput label="Driving License No" value={driverForm.license_no} onChange={(e) => setDriverForm({ ...driverForm, license_no: e.target.value })} />
          <FormInput label="Phone" value={driverForm.phone} onChange={(e) => setDriverForm({ ...driverForm, phone: e.target.value })} />
          <FormInput label="Email" type="email" value={driverForm.email} onChange={(e) => setDriverForm({ ...driverForm, email: e.target.value })} />
          <FormInput label="Vehicle No" value={driverForm.vehicle_no} onChange={(e) => setDriverForm({ ...driverForm, vehicle_no: e.target.value })} />
          <FormInput label="Ambulance Type" as="select" value={driverForm.ambulance_type}
            onChange={(e) => setDriverForm({ ...driverForm, ambulance_type: e.target.value })}
            options={[
              { value: 'basic', label: 'Basic' },
              { value: 'advanced', label: 'Advanced' },
              { value: 'neonatal', label: 'Neonatal' },
            ]}
          />
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={closeModal} className="btn-secondary">Cancel</button>
          <button onClick={() => handleAdd('driver')} disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Adding…' : 'Add Driver'}
          </button>
        </div>
      </Modal>

      {/* ─── Created credential reveal ────────────────────────── */}
      <Modal isOpen={Boolean(created)} onClose={() => setCreated(null)} title={`${created?.kind} Created`}>
        {/* Welcome-email status */}
        {created?.email_sent ? (
          <div className="rounded-xl px-4 py-3 mb-3 text-sm" style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC' }}>
            <span className="font-semibold" style={{ color: '#16A34A' }}>✅ Welcome email sent</span>
            <span className="text-gray-600"> to {created?.login_email} with the temporary password.</span>
          </div>
        ) : (
          <div className="rounded-xl px-4 py-3 mb-3 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5' }}>
            <span className="font-semibold" style={{ color: '#EF4444' }}>❌ Welcome email failed</span>
            <span className="text-gray-600"> — please share these credentials manually.</span>
          </div>
        )}

        <p className="text-gray-700 mb-3">
          Credentials for <strong>{created?.full_name}</strong>:
        </p>
        <div className="bg-primary-50 border border-primary-100 rounded-xl p-4 space-y-2 text-sm">
          <div><span className="text-gray-500">Email:</span> <code className="text-primary-600">{created?.login_email}</code></div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Temp password:</span>
            <code className="bg-white px-2 py-0.5 rounded border border-gray-200 text-primary-600">{created?.temp_password}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(created?.temp_password || ''); toast.success('Copied'); }}
              className="text-gray-400 hover:text-primary-500"
            >
              <FiCopy className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            🔒 They'll be required to set a new password on their first login.
          </p>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={() => setCreated(null)} className="btn-primary">Done</button>
        </div>
      </Modal>

      {/* ─── Set / fix department for an existing doctor ──────────── */}
      <Modal isOpen={Boolean(editingDoctor)} onClose={() => setEditingDoctor(null)} title="Set Department">
        <p className="text-sm text-gray-500 mb-4">Dr. {editingDoctor?.full_name}</p>
        {departmentList.length === 0 ? (
          <div className="rounded-xl px-3 py-2.5 text-sm" style={{ border: '1.5px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#EF4444' }}>
            ❌ No departments yet — add some in the Departments section first.
          </div>
        ) : (
          <FormInput
            label="Department"
            as="select"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            options={deptOptions}
          />
        )}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setEditingDoctor(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={saveDoctorDept}
            disabled={!selectedDept || savingDept}
            className="btn-primary disabled:opacity-60"
          >
            {savingDept ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* ─── Suspend / Terminate confirmation ─────────────────────── */}
      <Modal
        isOpen={Boolean(actionStaff)}
        onClose={() => setActionStaff(null)}
        title={
          actionType === 'resume'
            ? '✅ Resume Staff Member?'
            : actionType === 'suspend'
              ? '🔴 Suspend Staff Member?'
              : '⛔ Terminate Staff Member?'
        }
      >
        {actionStaff && (
          <>
            <p className="text-sm text-gray-600 mb-1">
              You are about to {actionType} <strong className="text-black">{actionStaff.name}</strong>.
            </p>
            <p className="text-sm text-gray-500 mb-4">
              📧 A notification email will be sent to <strong>{actionStaff.email}</strong>.
            </p>
            <div
              className="rounded-xl px-4 py-3 mb-5 text-sm"
              style={
                actionType === 'resume'
                  ? { backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', color: '#16A34A' }
                  : actionType === 'suspend'
                    ? { backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', color: '#F97316' }
                    : { backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', color: '#EF4444' }
              }
            >
              {actionType === 'resume'
                ? '✅ Staff will be reactivated and can log in again.'
                : actionType === 'suspend'
                  ? '🔴 The account will be suspended — sign-in is blocked until it is reactivated.'
                  : '⛔ The account will be terminated and can no longer sign in. A farewell email will be sent.'}
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setActionStaff(null)} disabled={actionLoading} className="btn-secondary">Cancel</button>
              <button
                onClick={handleStaffAction}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: actionType === 'resume' ? '#22C55E' : actionType === 'suspend' ? '#F97316' : '#EF4444' }}
              >
                {actionLoading
                  ? 'Processing…'
                  : actionType === 'resume'
                    ? '✅ Yes, Resume'
                    : actionType === 'suspend'
                      ? '🔴 Yes, Suspend'
                      : '⛔ Yes, Terminate'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default StaffPage;
