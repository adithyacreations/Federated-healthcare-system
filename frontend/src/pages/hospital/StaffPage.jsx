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

const BLANK_DOCTOR = { full_name: '', specialization: '', license_no: '', experience_years: '', consultation_fee: '', email: '', phone: '' };
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

  const [doctorForm, setDoctorForm] = useState(BLANK_DOCTOR);
  const [labForm,    setLabForm]    = useState(BLANK_LAB);
  const [driverForm, setDriverForm] = useState(BLANK_DRIVER);

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Staff Management</h1>
          <p className="text-sm text-gray-500">Manage doctors, lab technicians, and ambulance drivers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal('doctor')} className="inline-flex items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition">
            <FiPlus className="w-4 h-4" /> Doctor
          </button>
          <button onClick={() => setModal('lab')} className="inline-flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-black/80 transition">
            <FiPlus className="w-4 h-4" /> Lab Tech
          </button>
          <button onClick={() => setModal('driver')} className="inline-flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-black/80 transition">
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {doctors.loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : doctorList.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No doctors added yet.</td></tr>
                ) : (
                  doctorList.map((d) => (
                    <tr key={d.doctor_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">{d.full_name}</td>
                      <td className="px-4 py-3 text-gray-600">{d.specialization}</td>
                      <td className="px-4 py-3 font-medium text-gray-700">₹{d.consultation_fee?.toFixed?.(0) ?? d.consultation_fee}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{d.dept_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <STATUS_DOT ok={d.is_online} />
                          {d.is_online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{d.email}</td>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {labTechs.loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : labList.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No lab technicians added yet.</td></tr>
                ) : (
                  labList.map((lt) => (
                    <tr key={lt.lab_tech_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">{lt.full_name}</td>
                      <td className="px-4 py-3 text-gray-600">{lt.qualification || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{lt.specialization || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{lt.phone || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{lt.email}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 capitalize">{lt.approval_status}</span>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {drivers.loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : driverList.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No drivers added yet.</td></tr>
                ) : (
                  driverList.map((dr) => (
                    <tr key={dr.driver_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">{dr.full_name}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{dr.license_no}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{dr.phone}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{dr.vehicle_no || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{dr.ambulance_type || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${dr.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {dr.is_available ? 'Available' : 'On Duty'}
                        </span>
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
        <p className="text-gray-700 mb-3">
          Share these credentials with <strong>{created?.full_name}</strong>:
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
          <p className="text-xs text-gray-400 mt-2">They should change this password after first login.</p>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={() => setCreated(null)} className="btn-primary">Done</button>
        </div>
      </Modal>
    </DashboardLayout>
  );
};

export default StaffPage;
