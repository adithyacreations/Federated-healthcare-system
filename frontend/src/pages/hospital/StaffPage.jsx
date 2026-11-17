import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiPlus, FiCopy } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import FormInput from '../../components/auth/FormInput';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const TABS = ['Doctors', 'Lab Technicians', 'Drivers'];
const STAFF_PHONE_LENGTH = 10;
const DRIVER_IDENTIFIER_LENGTH = 12;
const normalizeStaffPhone = (value) => value.replace(/\D/g, '').slice(0, STAFF_PHONE_LENGTH);
const normalizeDriverIdentifier = (value) =>
  value.replace(/[^A-Za-z0-9]/g, '').slice(0, DRIVER_IDENTIFIER_LENGTH);

const staffContactErrors = (form, role, { phoneRequired = false } = {}) => ({
  name: /\p{N}/u.test(form.full_name) ? `${role} name cannot contain numbers.` : null,
  phone: (phoneRequired || form.phone) && form.phone.length !== STAFF_PHONE_LENGTH
    ? 'Enter a 10-digit phone number.'
    : null,
});

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
  <div className="grid w-full grid-cols-2 gap-2 xl:min-w-[120px] xl:grid-cols-1">
    {canSetDept && (
      <button
        onClick={onSetDept}
        className="min-h-[44px] w-full rounded-md px-2 py-1.5 text-center text-xs font-semibold xl:min-h-0 xl:whitespace-nowrap xl:px-3"
        style={{ backgroundColor: '#FFF7ED', color: '#F97316', border: '1px solid #FED7AA' }}
      >
        🏥 Set Dept
      </button>
    )}
    {isActive ? (
      <button
        onClick={onSuspend}
        className="min-h-[44px] w-full rounded-md px-2 py-1.5 text-center text-xs font-semibold xl:min-h-0 xl:whitespace-nowrap xl:px-3"
        style={{ backgroundColor: '#FFF7ED', color: '#F97316', border: '1px solid #FED7AA' }}
      >
        🔴 Suspend
      </button>
    ) : (
      <button
        onClick={onResume}
        className="min-h-[44px] w-full rounded-md px-2 py-1.5 text-center text-xs font-semibold xl:min-h-0 xl:whitespace-nowrap xl:px-3"
        style={{ backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}
      >
        ✅ Resume
      </button>
    )}
    <button
      onClick={onTerminate}
      className="min-h-[44px] w-full rounded-md px-2 py-1.5 text-center text-xs font-semibold xl:min-h-0 xl:whitespace-nowrap xl:px-3"
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
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [showDriverIdentifierErrors, setShowDriverIdentifierErrors] = useState(false);
  const [labForm,    setLabForm]    = useState(BLANK_LAB);
  const [driverForm, setDriverForm] = useState(BLANK_DRIVER);
  const doctorErrors = staffContactErrors(doctorForm, 'Doctor');
  const labErrors = staffContactErrors(labForm, 'Lab technician');
  const driverErrors = {
    ...staffContactErrors(driverForm, 'Driver', { phoneRequired: true }),
    license: driverForm.license_no ? null : 'Driving license number is required.',
    vehicle: driverForm.vehicle_no ? null : 'Vehicle number is required.',
  };

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
    setPhoneTouched(false);
    setShowDriverIdentifierErrors(false);
    setLabForm(BLANK_LAB);
    setDriverForm(BLANK_DRIVER);
  };

  const handleAdd = async (kind) => {
    const map = {
      doctor: { url: '/api/hospital/add-doctor/',   form: doctorForm, label: 'Doctor', errors: doctorErrors },
      lab:    { url: '/api/hospital/add-lab-tech/', form: labForm,    label: 'Lab Technician', errors: labErrors },
      driver: { url: '/api/hospital/add-driver/',   form: driverForm, label: 'Driver', errors: driverErrors },
    };
    const { url, form, label, errors } = map[kind];
    if (errors?.name || errors?.phone || errors?.license || errors?.vehicle) {
      setPhoneTouched(true);
      if (errors.license || errors.vehicle) setShowDriverIdentifierErrors(true);
      return;
    }
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
          <button onClick={() => setModal('doctor')} aria-label="Add doctor" className="inline-flex min-h-[44px] items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition whitespace-nowrap">
            <FiPlus className="w-4 h-4" /> Doctor
          </button>
          <button onClick={() => setModal('lab')} aria-label="Add lab technician" className="inline-flex min-h-[44px] items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-black/80 transition whitespace-nowrap">
            <FiPlus className="w-4 h-4" /> Lab Tech
          </button>
          <button onClick={() => setModal('driver')} aria-label="Add ambulance driver" className="inline-flex min-h-[44px] items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-black/80 transition whitespace-nowrap">
            <FiPlus className="w-4 h-4" /> Driver
          </button>
        </div>
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────── */}
      <div className="mb-6 flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`min-h-[44px] rounded-lg px-3 py-1.5 text-sm font-medium transition ${
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
            <table role="table" className="block w-full text-sm xl:table">
              <thead className="sr-only xl:not-sr-only xl:table-header-group">
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
              <tbody className="block divide-y divide-gray-200 xl:table-row-group xl:divide-gray-50">
                {doctors.loading ? (
                  <tr role="row" className="block xl:table-row"><td role="cell" colSpan={7} className="block px-4 py-8 xl:table-cell text-center text-gray-400">Loading…</td></tr>
                ) : doctorList.length === 0 ? (
                  <tr role="row" className="block xl:table-row"><td role="cell" colSpan={7} className="block px-4 py-8 xl:table-cell text-center text-gray-400">No doctors added yet.</td></tr>
                ) : (
                  doctorList.map((d) => (
                    <tr key={d.doctor_id} role="row" className="block space-y-2 p-4 transition hover:bg-primary-50/20 xl:table-row xl:space-y-0 xl:p-0">
                      <td role="cell" className="block break-words pb-2 xl:table-cell xl:px-4 xl:py-3 font-semibold text-gray-800">
                        {d.full_name}
                        {d.is_active === false && <SuspendedBadge />}
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-600">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Specialization</span>
                        <div className="min-w-0 xl:contents">
                          {d.specialization}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 font-medium text-gray-700">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Fee</span>
                        <div className="min-w-0 xl:contents">
                          ₹{d.consultation_fee?.toFixed?.(0) ?? d.consultation_fee}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Department</span>
                        <div className="min-w-0 xl:contents">
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
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Status</span>
                        <div className="min-w-0 xl:contents">
                          <span className="inline-flex items-center gap-1.5 text-xs">
                          <STATUS_DOT ok={d.is_online} />
                          {d.is_online ? 'Online' : 'Offline'}
                        </span>
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-500 text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Email</span>
                        <div className="min-w-0 xl:contents">
                          {d.email}
                        </div>
                      </td>
                      <td role="cell" className="block border-t border-gray-100 pt-2 xl:table-cell xl:border-0 xl:px-4 xl:py-3">
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
            <table role="table" className="block w-full text-sm xl:table">
              <thead className="sr-only xl:not-sr-only xl:table-header-group">
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
              <tbody className="block divide-y divide-gray-200 xl:table-row-group xl:divide-gray-50">
                {labTechs.loading ? (
                  <tr role="row" className="block xl:table-row"><td role="cell" colSpan={7} className="block px-4 py-8 xl:table-cell text-center text-gray-400">Loading…</td></tr>
                ) : labList.length === 0 ? (
                  <tr role="row" className="block xl:table-row"><td role="cell" colSpan={7} className="block px-4 py-8 xl:table-cell text-center text-gray-400">No lab technicians added yet.</td></tr>
                ) : (
                  labList.map((lt) => (
                    <tr key={lt.lab_tech_id} role="row" className="block space-y-2 p-4 transition hover:bg-primary-50/20 xl:table-row xl:space-y-0 xl:p-0">
                      <td role="cell" className="block break-words pb-2 xl:table-cell xl:px-4 xl:py-3 font-semibold text-gray-800">
                        {lt.full_name}
                        {lt.is_active === false && <SuspendedBadge />}
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-600">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Qualification</span>
                        <div className="min-w-0 xl:contents">
                          {lt.qualification || '—'}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-600">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Specialization</span>
                        <div className="min-w-0 xl:contents">
                          {lt.specialization || '—'}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-500 text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Phone</span>
                        <div className="min-w-0 xl:contents">
                          📞 {lt.phone || <span className="text-gray-400">No phone number</span>}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-500 text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Email</span>
                        <div className="min-w-0 xl:contents">
                          {lt.email}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Status</span>
                        <div className="min-w-0 xl:contents">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 capitalize">{lt.approval_status}</span>
                        </div>
                      </td>
                      <td role="cell" className="block border-t border-gray-100 pt-2 xl:table-cell xl:border-0 xl:px-4 xl:py-3">
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
            <table role="table" className="block w-full text-sm xl:table">
              <thead className="sr-only xl:not-sr-only xl:table-header-group">
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
              <tbody className="block divide-y divide-gray-200 xl:table-row-group xl:divide-gray-50">
                {drivers.loading ? (
                  <tr role="row" className="block xl:table-row"><td role="cell" colSpan={7} className="block px-4 py-8 xl:table-cell text-center text-gray-400">Loading…</td></tr>
                ) : driverList.length === 0 ? (
                  <tr role="row" className="block xl:table-row"><td role="cell" colSpan={7} className="block px-4 py-8 xl:table-cell text-center text-gray-400">No drivers added yet.</td></tr>
                ) : (
                  driverList.map((dr) => (
                    <tr key={dr.driver_id} role="row" className="block space-y-2 p-4 transition hover:bg-primary-50/20 xl:table-row xl:space-y-0 xl:p-0">
                      <td role="cell" className="block break-words pb-2 xl:table-cell xl:px-4 xl:py-3 font-semibold text-gray-800">
                        {dr.full_name}
                        {dr.is_active === false && <SuspendedBadge />}
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-600 font-mono text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">License No</span>
                        <div className="min-w-0 xl:contents">
                          {dr.license_no}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-500 text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Phone</span>
                        <div className="min-w-0 xl:contents">
                          {dr.phone}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-600 font-mono text-xs">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Vehicle No</span>
                        <div className="min-w-0 xl:contents">
                          {dr.vehicle_no || '—'}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3 text-gray-600 capitalize">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Type</span>
                        <div className="min-w-0 xl:contents">
                          {dr.ambulance_type || '—'}
                        </div>
                      </td>
                      <td role="cell" className="grid grid-cols-[minmax(5.5rem,2fr)_minmax(0,3fr)] items-start gap-2 break-words xl:table-cell xl:px-4 xl:py-3">
                        <span aria-hidden="true" className="font-medium text-gray-500 xl:hidden">Availability</span>
                        <div className="min-w-0 xl:contents">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${dr.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {dr.is_available ? 'Available' : 'On Duty'}
                        </span>
                        </div>
                      </td>
                      <td role="cell" className="block border-t border-gray-100 pt-2 xl:table-cell xl:border-0 xl:px-4 xl:py-3">
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
          <FormInput label="Full Name" aria-label="Doctor full name" value={doctorForm.full_name}
            onChange={(e) => setDoctorForm({ ...doctorForm, full_name: e.target.value })} error={doctorErrors.name} />
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
          <FormInput label="Phone" aria-label="Doctor phone number" type="tel" inputMode="numeric"
            maxLength={STAFF_PHONE_LENGTH} hint="10 digits (optional)" value={doctorForm.phone}
            onChange={(e) => setDoctorForm({ ...doctorForm, phone: normalizeStaffPhone(e.target.value) })}
            onBlur={() => setPhoneTouched(true)} error={phoneTouched ? doctorErrors.phone : null} />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button onClick={closeModal} className="btn-secondary">Cancel</button>
          <button onClick={() => handleAdd('doctor')} disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Adding…' : 'Add Doctor'}
          </button>
        </div>
      </Modal>

      {/* ─── Add Lab Tech Modal ───────────────────────────────── */}
      <Modal isOpen={modal === 'lab'} onClose={closeModal} title="Add Lab Technician">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Full Name" aria-label="Lab technician full name" value={labForm.full_name}
            onChange={(e) => setLabForm({ ...labForm, full_name: e.target.value })} error={labErrors.name} />
          <FormInput label="Qualification" value={labForm.qualification} onChange={(e) => setLabForm({ ...labForm, qualification: e.target.value })} />
          <FormInput label="Specialization" value={labForm.specialization} onChange={(e) => setLabForm({ ...labForm, specialization: e.target.value })} />
          <FormInput label="Phone" aria-label="Lab technician phone number" type="tel" inputMode="numeric"
            maxLength={STAFF_PHONE_LENGTH} hint="10 digits (optional)" value={labForm.phone}
            onChange={(e) => setLabForm({ ...labForm, phone: normalizeStaffPhone(e.target.value) })}
            onBlur={() => setPhoneTouched(true)} error={phoneTouched ? labErrors.phone : null} />
          <FormInput label="Email" type="email" value={labForm.email} onChange={(e) => setLabForm({ ...labForm, email: e.target.value })} />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button onClick={closeModal} className="btn-secondary">Cancel</button>
          <button onClick={() => handleAdd('lab')} disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Adding…' : 'Add Lab Tech'}
          </button>
        </div>
      </Modal>

      {/* ─── Add Driver Modal ─────────────────────────────────── */}
      <Modal isOpen={modal === 'driver'} onClose={closeModal} title="Add Ambulance Driver">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Full Name" aria-label="Driver full name" value={driverForm.full_name}
            onChange={(e) => setDriverForm({ ...driverForm, full_name: e.target.value })} error={driverErrors.name} />
          <FormInput label="Driving License No" aria-label="Driving license number" required
            hint="Up to 12 letters or digits" value={driverForm.license_no}
            onChange={(e) => setDriverForm({
              ...driverForm,
              license_no: normalizeDriverIdentifier(e.target.value),
            })}
            error={showDriverIdentifierErrors ? driverErrors.license : null} />
          <FormInput label="Phone" aria-label="Driver phone number" type="tel" inputMode="numeric" required
            maxLength={STAFF_PHONE_LENGTH} hint="10 digits (required)" value={driverForm.phone}
            onChange={(e) => setDriverForm({ ...driverForm, phone: normalizeStaffPhone(e.target.value) })}
            onBlur={() => setPhoneTouched(true)} error={phoneTouched ? driverErrors.phone : null} />
          <FormInput label="Email" type="email" value={driverForm.email} onChange={(e) => setDriverForm({ ...driverForm, email: e.target.value })} />
          <FormInput label="Vehicle No" aria-label="Vehicle number" required
            hint="Up to 12 letters or digits" value={driverForm.vehicle_no}
            onChange={(e) => setDriverForm({
              ...driverForm,
              vehicle_no: normalizeDriverIdentifier(e.target.value),
            })}
            error={showDriverIdentifierErrors ? driverErrors.vehicle : null} />
          <FormInput label="Ambulance Type" as="select" value={driverForm.ambulance_type}
            onChange={(e) => setDriverForm({ ...driverForm, ambulance_type: e.target.value })}
            options={[
              { value: 'basic', label: 'Basic' },
              { value: 'advanced', label: 'Advanced' },
              { value: 'neonatal', label: 'Neonatal' },
            ]}
          />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
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

        <p className="mb-3 break-words text-gray-700">
          Credentials for <strong>{created?.full_name}</strong>:
        </p>
        <div className="bg-primary-50 border border-primary-100 rounded-xl p-4 space-y-2 text-sm">
          <div><span className="text-gray-500">Email:</span> <code className="break-all text-primary-600">{created?.login_email}</code></div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500">Temp password:</span>
            <code className="min-w-0 break-all rounded border border-gray-200 bg-white px-2 py-0.5 text-primary-600">{created?.temp_password}</code>
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
        <p className="mb-4 break-words text-sm text-gray-500">Dr. {editingDoctor?.full_name}</p>
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
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
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
            <p className="mb-4 break-words text-sm text-gray-500">
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
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
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
