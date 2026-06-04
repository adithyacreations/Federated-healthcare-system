import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { FiSave, FiEdit3, FiCamera } from 'react-icons/fi';
import { format } from 'date-fns';
import DashboardLayout from '../../components/common/DashboardLayout';
import PasswordResetModal from '../../components/common/PasswordResetModal';
import LocationPicker from '../../components/common/LocationPicker';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  doctor: 'Doctor',
  patient: 'Patient',
  pharmacist: 'Pharmacist',
  lab_tech: 'Lab Technician',
  driver: 'Ambulance Driver',
  vendor: 'Equipment Vendor',
};

const ROLE_COLORS = {
  super_admin: 'bg-purple-100 text-purple-700',
  hospital_admin: 'bg-blue-100 text-blue-700',
  doctor: 'bg-green-100 text-green-700',
  patient: 'bg-cyan-100 text-cyan-700',
  pharmacist: 'bg-orange-100 text-orange-700',
  lab_tech: 'bg-pink-100 text-pink-700',
  driver: 'bg-yellow-100 text-yellow-700',
  vendor: 'bg-indigo-100 text-indigo-700',
};

const ProfilePage = () => {
  const { role, updateProfile } = useAuth();
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [loginData, setLoginData] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [editForm, setEditForm] = useState({ full_name: '', phone: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [showResetModal, setShowResetModal] = useState(false);

  const [loc, setLoc] = useState({ latitude: '', longitude: '' });
  const [savingLoc, setSavingLoc] = useState(false);

  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [togglingReminder, setTogglingReminder] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await API.get('/api/auth/profile/');
        const data = res.data?.data || {};
        setLoginData({ email: data.email, role: data.role, created_at: data.created_at });
        const p = data.profile || {};
        setProfile(p);
        setEditForm({
          full_name: p.full_name || p.contact_name || '',
          phone: p.phone || p.contact_phone || '',
        });
        setLoc({
          latitude: p.latitude != null ? String(p.latitude) : '',
          longitude: p.longitude != null ? String(p.longitude) : '',
        });
        if (p.reminder_enabled !== undefined) {
          setReminderEnabled(Boolean(p.reminder_enabled));
        }
      } catch {
        toast.error('Could not load profile');
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchProfile();
  }, []);

  const displayName =
    profile?.full_name || profile?.hospital_name || profile?.contact_name ||
    profile?.company_name || loginData?.email || 'User';

  const memberSince = loginData?.created_at
    ? (() => { try { return format(new Date(loginData.created_at), 'MMMM yyyy'); } catch { return '—'; } })()
    : '—';

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a JPEG or PNG image');
      return;
    }
    const formData = new FormData();
    formData.append('image', file);
    setUploading(true);
    try {
      const res = await API.post('/api/auth/profile/upload-photo/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const photoUrl = res.data?.data?.photo_url;
      if (photoUrl) {
        setProfile((p) => ({ ...p, profile_photo: photoUrl }));
        updateProfile({ profile_photo: photoUrl });
        toast.success('Profile photo updated!');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Photo upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!editForm.full_name.trim() && !editForm.phone.trim()) {
      toast.error('Please enter at least one field to update');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await API.put('/api/auth/profile/update/', editForm);
      toast.success('Profile updated successfully!');
      const updated = res.data?.data || {};
      setProfile(updated);
      updateProfile(updated);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Profile update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveLocation = async () => {
    if (!loc.latitude || !loc.longitude) {
      toast.error('Please set both latitude and longitude');
      return;
    }
    setSavingLoc(true);
    try {
      const res = await API.put('/api/auth/profile/update/', {
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
      toast.success('📍 Hospital location updated!');
      const updated = res.data?.data || {};
      setProfile(updated);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Location update failed');
    } finally {
      setSavingLoc(false);
    }
  };

  if (loadingProfile) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-40 text-gray-400">Loading profile…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary-500">My Profile</h1>
        <p className="text-sm text-gray-500">Manage your account information and security settings</p>
      </div>

      <div className="max-w-6xl space-y-6">
        {/* Section 1 — Profile Info Card with Photo */}
        <div className="card">
          <div className="flex items-start gap-6">
            {/* Photo upload area */}
            <div className="flex flex-col items-center gap-2 shrink-0">
              <div className="relative">
                {profile?.profile_photo ? (
                  <img
                    src={profile.profile_photo}
                    alt="Profile"
                    className="w-20 h-20 rounded-full object-cover ring-4 ring-primary-100"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-orange-500 text-white flex items-center justify-center text-3xl font-bold ring-4 ring-primary-100">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {uploading && (
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1 text-xs text-primary-500 font-medium hover:underline disabled:opacity-50 transition"
              >
                <FiCamera className="w-3 h-3" />
                {uploading ? 'Uploading…' : 'Change Photo'}
              </button>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-xl font-bold text-gray-800">{displayName}</div>
              <div className="text-sm text-gray-500 mt-0.5">{loginData?.email}</div>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${ROLE_COLORS[role] || 'bg-gray-100 text-gray-600'}`}>
                  {ROLE_LABELS[role] || role}
                </span>
                <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-medium">
                  Member since {memberSince}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Two-column layout — left: edit + role extras · right: security + info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* LEFT COLUMN */}
          <div className="space-y-6">

        {/* Section 2 — Edit Profile */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <FiEdit3 className="w-5 h-5 text-primary-500" />
            <h2 className="font-bold text-gray-700">Edit Profile</h2>
          </div>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={editForm.full_name}
                onChange={(e) => setEditForm((p) => ({ ...p, full_name: e.target.value }))}
                placeholder="Enter your full name"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input
                type="tel"
                value={editForm.phone}
                onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                placeholder="Enter your phone number"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={loginData?.email || ''}
                disabled
                className="w-full border border-gray-100 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
              />
              <p className="text-xs text-gray-400 mt-1">Email cannot be changed.</p>
            </div>
            <button
              type="submit"
              disabled={savingEdit}
              className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-60"
            >
              <FiSave className="w-4 h-4" />
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Hospital location (emergency routing) — hospital admins only */}
        {role === 'hospital_admin' && (
          <div className="card">
            <h3 className="font-bold text-lg mb-1 text-gray-700">📍 Hospital Location</h3>
            <p className="text-gray-500 text-sm mb-4">
              Used to route emergency ambulances and reserve beds for nearby patients.
            </p>
            <LocationPicker
              latitude={loc.latitude}
              longitude={loc.longitude}
              onChange={(la, lo) => setLoc({ latitude: la, longitude: lo })}
            />
            <button
              onClick={handleSaveLocation}
              disabled={savingLoc}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#F97316' }}
            >
              {savingLoc ? 'Saving…' : 'Save Location'}
            </button>
          </div>
        )}

        {/* Notifications — patient-only toggle for appointment reminders */}
        {role === 'patient' && (
          <div className="card">
            <h3 className="font-bold text-lg mb-1 text-gray-700">🔔 Notifications</h3>
            <p className="text-gray-500 text-sm mb-4">
              Manage how FederCare contacts you about appointments
            </p>
            <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="font-medium text-black">Appointment Reminders</p>
                <p className="text-sm text-gray-500 mt-1">
                  Get email + in-app reminder 1 hour before your consultation
                </p>
              </div>
              <button
                onClick={async () => {
                  const newValue = !reminderEnabled;
                  setTogglingReminder(true);
                  try {
                    const res = await API.put('/api/auth/profile/update/', {
                      reminder_enabled: newValue,
                    });
                    if (res.data?.success) {
                      setReminderEnabled(newValue);
                      toast.success(newValue ? '🔔 Reminders enabled!' : '🔕 Reminders disabled!');
                    } else {
                      toast.error('Failed to update!');
                    }
                  } catch {
                    toast.error('Failed to update!');
                  } finally {
                    setTogglingReminder(false);
                  }
                }}
                disabled={togglingReminder}
                className="relative w-14 h-7 rounded-full transition-all duration-300 flex-shrink-0 disabled:opacity-60"
                style={{ backgroundColor: reminderEnabled ? '#F97316' : '#E5E5E5' }}
              >
                <div
                  className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-300 ${
                    reminderEnabled ? 'left-7' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

          </div>{/* END LEFT COLUMN */}

          {/* RIGHT COLUMN */}
          <div className="space-y-6">

        {/* Section 3 — Security (OTP-verified password reset only) */}
        <div className="card">
          <h3 className="font-bold text-lg mb-1 text-gray-700">🔐 Security</h3>
          <p className="text-gray-500 text-sm mb-4">Manage your account password</p>
          <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 rounded-xl">
            <div>
              <p className="font-medium text-black">Password</p>
              <p className="text-sm text-gray-400">
                A 6-digit OTP is sent to <b>{loginData?.email}</b> to verify it's you.
              </p>
            </div>
            <button
              onClick={() => setShowResetModal(true)}
              className="shrink-0 px-6 py-2 rounded-full font-semibold text-white text-sm"
              style={{ backgroundColor: '#F97316' }}
            >
              Reset Password
            </button>
          </div>
        </div>

        {/* Account Information */}
        <div className="card">
          <h3 className="font-bold text-lg mb-2 text-gray-700">ℹ️ Account Information</h3>
          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-500">Role</span>
              <span className="text-sm font-semibold text-gray-800">{ROLE_LABELS[role] || role}</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-500">Member Since</span>
              <span className="text-sm font-semibold text-gray-800">{memberSince}</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-500">Account Status</span>
              <span className="text-sm font-semibold text-green-600">✅ Active</span>
            </div>
          </div>
        </div>

          </div>{/* END RIGHT COLUMN */}
        </div>{/* END two-column grid */}
      </div>

      <PasswordResetModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        email={loginData?.email || ''}
        isAuthenticated
        requireCurrentPassword
      />
    </DashboardLayout>
  );
};

export default ProfilePage;
