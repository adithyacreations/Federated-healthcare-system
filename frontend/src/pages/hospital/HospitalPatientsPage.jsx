import { useState, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  FiUsers, FiPlus, FiDownload, FiSearch, FiEye, FiX,
  FiChevronRight, FiChevronLeft, FiActivity, FiHeart,
  FiList, FiFilter, FiUpload, FiCpu,
} from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import StatCard from '../../components/common/StatCard';
import FormInput from '../../components/auth/FormInput';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

// ─── Static data ───────────────────────────────────────────────────────────────

const DISEASES = [
  'Fungal infection', 'Allergy', 'GERD', 'Chronic cholestasis', 'Drug Reaction',
  'Peptic ulcer disease', 'AIDS', 'Diabetes', 'Gastroenteritis', 'Bronchial Asthma',
  'Hypertension', 'Migraine', 'Cervical spondylosis', 'Paralysis (brain hemorrhage)',
  'Jaundice', 'Malaria', 'Chicken pox', 'Dengue', 'Typhoid', 'Hepatitis A',
  'Hepatitis B', 'Hepatitis C', 'Hepatitis D', 'Hepatitis E', 'Alcoholic hepatitis',
  'Tuberculosis', 'Common Cold', 'Pneumonia', 'Dimorphic hemorrhoids(piles)',
  'Heart attack', 'Varicose veins', 'Hypothyroidism', 'Hyperthyroidism',
  'Hypoglycemia', 'Osteoarthritis', 'Arthritis',
  '(vertigo) Paroxysmal Positional Vertigo', 'Acne',
  'Urinary tract infection', 'Psoriasis', 'Impetigo',
];

const DISEASE_SEVERITY = {
  'Heart attack': 'critical', 'Tuberculosis': 'critical', 'AIDS': 'critical',
  'Malaria': 'critical', 'Dengue': 'critical', 'Typhoid': 'critical',
  'Hepatitis A': 'critical', 'Hepatitis B': 'critical', 'Hepatitis C': 'critical',
  'Hepatitis D': 'critical', 'Hepatitis E': 'critical',
  'Alcoholic hepatitis': 'critical', 'Pneumonia': 'critical',
  'Paralysis (brain hemorrhage)': 'critical',
  'Diabetes': 'moderate', 'Hypertension': 'moderate', 'Bronchial Asthma': 'moderate',
  'Migraine': 'moderate', 'Jaundice': 'moderate', 'Chronic cholestasis': 'moderate',
  'Drug Reaction': 'moderate', 'Hypoglycemia': 'moderate',
  'Hypothyroidism': 'moderate', 'Hyperthyroidism': 'moderate',
  'Gastroenteritis': 'moderate',
};

const SEVERITY_BADGE = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  moderate: 'bg-orange-100 text-orange-700 border border-orange-200',
  mild: 'bg-green-100 text-green-700 border border-green-200',
};

const getSeverity = (diagnosis) => DISEASE_SEVERITY[diagnosis] || 'mild';

const ALL_SYMPTOMS = [
  'itching', 'skin_rash', 'nodal_skin_eruptions', 'continuous_sneezing', 'shivering',
  'chills', 'joint_pain', 'stomach_pain', 'acidity', 'ulcers_on_tongue',
  'muscle_wasting', 'vomiting', 'burning_micturition', 'spotting_urination', 'fatigue',
  'weight_gain', 'anxiety', 'cold_hands_and_feets', 'mood_swings', 'weight_loss',
  'restlessness', 'lethargy', 'patches_in_throat', 'irregular_sugar_level', 'cough',
  'high_fever', 'sunken_eyes', 'breathlessness', 'sweating', 'dehydration',
  'indigestion', 'headache', 'yellowish_skin', 'dark_urine', 'nausea',
  'loss_of_appetite', 'pain_behind_the_eyes', 'back_pain', 'constipation',
  'abdominal_pain', 'diarrhoea', 'mild_fever', 'yellow_urine', 'yellowing_of_eyes',
  'acute_liver_failure', 'fluid_overload', 'swelling_of_stomach', 'swelled_lymph_nodes',
  'malaise', 'blurred_and_distorted_vision', 'phlegm', 'throat_irritation',
  'redness_of_eyes', 'sinus_pressure', 'runny_nose', 'congestion', 'chest_pain',
  'weakness_in_limbs', 'fast_heart_rate', 'pain_during_bowel_movements',
  'pain_in_anal_region', 'bloody_stool', 'irritation_in_anus', 'neck_pain', 'dizziness',
  'cramps', 'bruising', 'obesity', 'swollen_legs', 'swollen_blood_vessels',
  'puffy_face_and_eyes', 'enlarged_thyroid', 'brittle_nails', 'swollen_extremities',
  'excessive_hunger', 'extra_marital_contacts', 'drying_and_tingling_lips',
  'slurred_speech', 'knee_pain', 'hip_joint_pain', 'muscle_weakness', 'stiff_neck',
  'swelling_joints', 'movement_stiffness', 'spinning_movements', 'loss_of_balance',
  'unsteadiness', 'weakness_of_one_body_side', 'loss_of_smell', 'bladder_discomfort',
  'foul_smell_of_urine', 'continuous_feel_of_urine', 'passage_of_gases',
  'internal_itching', 'toxic_look_(typhos)', 'depression', 'irritability', 'muscle_pain',
  'altered_sensorium', 'red_spots_over_body', 'belly_pain', 'abnormal_menstruation',
  'dischromic_patches', 'watering_from_eyes', 'increased_appetite', 'polyuria',
  'family_history', 'mucoid_sputum', 'rusty_sputum', 'lack_of_concentration',
  'visual_disturbances', 'receiving_blood_transfusion', 'receiving_unsterile_injections',
  'coma', 'stomach_bleeding', 'distention_of_abdomen', 'history_of_alcohol_consumption',
  'blood_in_sputum', 'prominent_veins_on_calf', 'palpitations', 'painful_walking',
  'pus_filled_pimples', 'blackheads', 'scurring', 'skin_peeling', 'silver_like_dusting',
  'small_dents_in_nails', 'inflammatory_nails', 'blister', 'red_sore_around_nose',
  'yellow_crust_ooze',
];

const DISEASE_SYMPTOMS = {
  'Diabetes': ['fatigue', 'weight_loss', 'restlessness', 'lethargy', 'irregular_sugar_level', 'polyuria', 'excessive_hunger'],
  'Malaria': ['chills', 'vomiting', 'high_fever', 'sweating', 'headache', 'nausea', 'muscle_pain'],
  'Tuberculosis': ['fatigue', 'cough', 'weight_loss', 'breathlessness', 'high_fever', 'phlegm', 'blood_in_sputum'],
  'Hypertension': ['headache', 'dizziness', 'loss_of_balance', 'chest_pain', 'fatigue', 'lack_of_concentration'],
  'Common Cold': ['continuous_sneezing', 'chills', 'fatigue', 'cough', 'high_fever', 'headache', 'swelled_lymph_nodes', 'runny_nose'],
  'Dengue': ['skin_rash', 'chills', 'vomiting', 'high_fever', 'headache', 'nausea', 'pain_behind_the_eyes', 'back_pain', 'muscle_pain'],
  'Heart attack': ['vomiting', 'breathlessness', 'sweating', 'chest_pain', 'fast_heart_rate'],
  'Pneumonia': ['chills', 'fatigue', 'cough', 'high_fever', 'breathlessness', 'sweating', 'malaise', 'phlegm', 'chest_pain', 'rusty_sputum'],
  'AIDS': ['fatigue', 'muscle_wasting', 'patches_in_throat', 'weight_loss', 'vomiting', 'high_fever', 'sweating', 'diarrhoea'],
  'Typhoid': ['chills', 'vomiting', 'high_fever', 'headache', 'nausea', 'abdominal_pain', 'constipation', 'toxic_look_(typhos)'],
  'Hepatitis A': ['joint_pain', 'vomiting', 'fatigue', 'high_fever', 'nausea', 'loss_of_appetite', 'yellowish_skin', 'dark_urine', 'yellowing_of_eyes'],
  'Hepatitis B': ['fatigue', 'weight_loss', 'vomiting', 'nausea', 'loss_of_appetite', 'yellowish_skin', 'dark_urine', 'yellowing_of_eyes', 'abdominal_pain'],
  'Hepatitis C': ['fatigue', 'nausea', 'loss_of_appetite', 'yellowish_skin', 'dark_urine', 'yellowing_of_eyes', 'family_history'],
  'Hepatitis D': ['fatigue', 'vomiting', 'nausea', 'loss_of_appetite', 'yellowish_skin', 'dark_urine', 'yellowing_of_eyes', 'abdominal_pain'],
  'Hepatitis E': ['fatigue', 'vomiting', 'nausea', 'loss_of_appetite', 'yellowish_skin', 'dark_urine', 'yellowing_of_eyes', 'joint_pain'],
  'Alcoholic hepatitis': ['vomiting', 'abdominal_pain', 'yellowish_skin', 'dark_urine', 'fluid_overload', 'swelling_of_stomach', 'history_of_alcohol_consumption'],
  'Fungal infection': ['itching', 'skin_rash', 'nodal_skin_eruptions', 'dischromic_patches'],
  'Allergy': ['continuous_sneezing', 'shivering', 'watering_from_eyes', 'redness_of_eyes', 'runny_nose', 'skin_rash'],
  'GERD': ['acidity', 'chest_pain', 'cough', 'vomiting', 'stomach_pain'],
  'Chronic cholestasis': ['itching', 'vomiting', 'yellowish_skin', 'nausea', 'loss_of_appetite', 'abdominal_pain'],
  'Drug Reaction': ['itching', 'skin_rash', 'stomach_pain', 'burning_micturition', 'spotting_urination'],
  'Peptic ulcer disease': ['vomiting', 'indigestion', 'abdominal_pain', 'loss_of_appetite', 'nausea'],
  'Gastroenteritis': ['vomiting', 'diarrhoea', 'dehydration', 'abdominal_pain', 'nausea'],
  'Bronchial Asthma': ['fatigue', 'cough', 'breathlessness', 'mucoid_sputum', 'chest_pain'],
  'Migraine': ['headache', 'nausea', 'vomiting', 'blurred_and_distorted_vision', 'visual_disturbances'],
  'Cervical spondylosis': ['neck_pain', 'back_pain', 'weakness_in_limbs', 'dizziness'],
  'Paralysis (brain hemorrhage)': ['headache', 'vomiting', 'weakness_of_one_body_side', 'altered_sensorium', 'dizziness'],
  'Jaundice': ['yellowish_skin', 'dark_urine', 'nausea', 'loss_of_appetite', 'abdominal_pain', 'fatigue'],
  'Chicken pox': ['itching', 'skin_rash', 'high_fever', 'fatigue', 'headache', 'loss_of_appetite'],
  'Dimorphic hemorrhoids(piles)': ['constipation', 'pain_in_anal_region', 'bloody_stool', 'irritation_in_anus'],
  'Varicose veins': ['swollen_legs', 'swollen_blood_vessels', 'prominent_veins_on_calf', 'bruising', 'painful_walking'],
  'Hypothyroidism': ['fatigue', 'weight_gain', 'cold_hands_and_feets', 'constipation', 'mood_swings', 'enlarged_thyroid'],
  'Hyperthyroidism': ['fatigue', 'weight_loss', 'anxiety', 'mood_swings', 'fast_heart_rate', 'excessive_hunger'],
  'Hypoglycemia': ['fatigue', 'sweating', 'dizziness', 'headache', 'nausea', 'irregular_sugar_level'],
  'Osteoarthritis': ['joint_pain', 'knee_pain', 'hip_joint_pain', 'swelling_joints', 'movement_stiffness'],
  'Arthritis': ['joint_pain', 'swelling_joints', 'movement_stiffness', 'muscle_weakness', 'fatigue'],
  '(vertigo) Paroxysmal Positional Vertigo': ['dizziness', 'spinning_movements', 'loss_of_balance', 'unsteadiness', 'nausea'],
  'Acne': ['skin_rash', 'pus_filled_pimples', 'blackheads', 'scurring'],
  'Urinary tract infection': ['burning_micturition', 'bladder_discomfort', 'foul_smell_of_urine', 'continuous_feel_of_urine'],
  'Psoriasis': ['skin_rash', 'joint_pain', 'skin_peeling', 'silver_like_dusting', 'small_dents_in_nails', 'inflammatory_nails'],
  'Impetigo': ['skin_rash', 'blister', 'red_sore_around_nose', 'yellow_crust_ooze'],
};

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

const BLANK_FORM = {
  full_name: '', age: '', gender: 'male', blood_group: 'O+', notes: '',
  diagnosis: '', symptoms: [],
};

// ─── Component ─────────────────────────────────────────────────────────────────

const HospitalPatientsPage = () => {
  const [modal, setModal] = useState(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(BLANK_FORM);
  const [viewPatient, setViewPatient] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingView, setLoadingView] = useState(false);
  const [symptomSearch, setSymptomSearch] = useState('');
  const [search, setSearch] = useState('');
  const [diagFilter, setDiagFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  // CSV import state
  const [csvFile, setCsvFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const csvInputRef = useRef(null);

  // Demo generate state
  const [demoCount, setDemoCount] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [demoResult, setDemoResult] = useState(null);

  const stats = useApi('/api/hospital/patients/stats/');
  const patientsApi = useApi('/api/hospital/patients/');

  const statsData = stats.data || {};
  const totalPatients = statsData.total_patients || 0;
  const readyForTraining = statsData.ready_for_training || false;

  const diagDist = useMemo(
    () => statsData.diagnosis_distribution || {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.data],
  );

  const mostCommonDisease = useMemo(() => {
    const entries = Object.entries(diagDist);
    if (entries.length === 0) return 'N/A';
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }, [diagDist]);

  const diseasesCount = Object.keys(diagDist).length;

  const patientList = useMemo(() => {
    const raw = Array.isArray(patientsApi.data) ? patientsApi.data : [];
    return raw.filter((p) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        p.full_name.toLowerCase().includes(q) ||
        p.diagnosis.toLowerCase().includes(q);
      const matchDiag = !diagFilter || p.diagnosis === diagFilter;
      return matchSearch && matchDiag;
    });
  }, [patientsApi.data, search, diagFilter]);

  const filteredSymptoms = useMemo(() => {
    if (!symptomSearch) return ALL_SYMPTOMS;
    const q = symptomSearch.toLowerCase().replace(/ /g, '_');
    return ALL_SYMPTOMS.filter((s) => s.includes(q));
  }, [symptomSearch]);

  const openAdd = () => {
    setForm(BLANK_FORM);
    setStep(1);
    setSymptomSearch('');
    setModal('add');
  };

  const closeModal = () => {
    setModal(null);
    setViewPatient(null);
    setForm(BLANK_FORM);
    setStep(1);
    setSymptomSearch('');
  };

  const handleDiagnosisChange = (diagnosis) => {
    const suggested = DISEASE_SYMPTOMS[diagnosis] || [];
    setForm((f) => ({ ...f, diagnosis, symptoms: suggested }));
  };

  const toggleSymptom = (symptom) => {
    setForm((f) => ({
      ...f,
      symptoms: f.symptoms.includes(symptom)
        ? f.symptoms.filter((s) => s !== symptom)
        : [...f.symptoms, symptom],
    }));
  };

  const goToStep2 = () => {
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    const age = parseInt(form.age);
    if (!form.age || isNaN(age) || age < 1 || age > 120) { toast.error('Enter a valid age (1–120)'); return; }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!form.diagnosis) { toast.error('Please select a diagnosis'); return; }
    if (form.symptoms.length === 0) { toast.error('Select at least one symptom'); return; }
    setSubmitting(true);
    try {
      await API.post('/api/hospital/patients/add/', {
        full_name: form.full_name.trim(),
        age: parseInt(form.age),
        gender: form.gender,
        blood_group: form.blood_group,
        notes: form.notes.trim(),
        diagnosis: form.diagnosis,
        symptoms: form.symptoms,
      });
      toast.success('Patient record added!');
      closeModal();
      patientsApi.refetch();
      stats.refetch();
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to add patient';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewPatient = async (patientId) => {
    setLoadingView(true);
    setViewPatient(null);
    setModal('view');
    try {
      const { data } = await API.get(`/api/hospital/patients/${patientId}/`);
      setViewPatient(data?.data || data);
    } catch {
      toast.error('Failed to load patient details');
      setModal(null);
    } finally {
      setLoadingView(false);
    }
  };

  const handleExport = async () => {
    if (totalPatients === 0) { toast.error('No patient records to export'); return; }
    setExporting(true);
    try {
      const response = await API.get('/api/hospital/patients/export/', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'hospital_training_data.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Training data exported!');
    } catch {
      toast.error('Export failed — ensure patient records exist');
    } finally {
      setExporting(false);
    }
  };

  const openImport = () => {
    setCsvFile(null);
    setImportResult(null);
    setModal('import');
  };

  const openGenerate = () => {
    setDemoCount(30);
    setDemoResult(null);
    setModal('generate');
  };

  const handleCsvDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.endsWith('.csv')) setCsvFile(file);
    else toast.error('Please drop a .csv file');
  };

  const handleImport = async () => {
    if (!csvFile) { toast.error('Please select a CSV file first'); return; }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('csv_file', csvFile);
      const { data } = await API.post('/api/hospital/patients/import-csv/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data.data);
      toast.success(data.message);
      patientsApi.refetch();
      stats.refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data } = await API.post('/api/hospital/patients/generate-demo/', { count: demoCount });
      setDemoResult(data.data);
      toast.success(data.message);
      patientsApi.refetch();
      stats.refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const readiness = (() => {
    if (totalPatients >= 50) return {
      bg: 'bg-green-50 border-green-200',
      icon: '✅',
      title: 'Excellent Training Data!',
      desc: `${totalPatients} patients available`,
      sub: 'Using: Real hospital data only',
      acc: 'Expected accuracy: 95%+',
      textColor: 'text-green-700',
    };
    if (totalPatients >= 10) return {
      bg: 'bg-blue-50 border-blue-200',
      icon: '✅',
      title: 'Good Training Data',
      desc: `${totalPatients} patients available`,
      sub: 'Using: Real data + reference supplement',
      acc: 'Expected accuracy: 90%+',
      textColor: 'text-blue-700',
    };
    return {
      bg: 'bg-yellow-50 border-yellow-200',
      icon: '⚠️',
      title: 'Limited Training Data',
      desc: `Only ${totalPatients} patients added`,
      sub: 'Using: reference dataset only',
      acc: 'Add more patients for better accuracy',
      textColor: 'text-yellow-700',
      showAdd: true,
    };
  })();

  return (
    <DashboardLayout>

      {/* ─── Page Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Hospital Patients</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Patient records for federated learning training
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              const token = localStorage.getItem('access_token');
              const url = `${API.defaults.baseURL || ''}/api/hospital/patients/csv-template/`;
              fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                .then((r) => r.blob())
                .then((blob) => {
                  const a = document.createElement('a');
                  a.href = window.URL.createObjectURL(blob);
                  a.download = 'federcare_patients_template.csv';
                  a.click();
                })
                .catch(() => toast.error('Template download failed'));
            }}
            className="inline-flex items-center gap-1.5 bg-gray-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-gray-600 transition"
          >
            <FiDownload className="w-4 h-4" /> Download Template
          </button>
          <button
            onClick={openImport}
            className="inline-flex items-center gap-1.5 bg-success text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 transition"
          >
            <FiUpload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={openGenerate}
            className="inline-flex items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition"
          >
            <FiCpu className="w-4 h-4" /> Generate Demo Patients
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition"
          >
            <FiPlus className="w-4 h-4" /> Add Patient
          </button>
        </div>
      </div>

      {/* ─── Stats Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Patients"
          value={stats.loading ? '…' : totalPatients}
          icon={FiUsers}
          color="primary"
        />
        <StatCard
          title="FL Training Status"
          value={stats.loading ? '…' : readyForTraining ? '✅ Ready' : '⚠️ Not Ready'}
          icon={FiActivity}
          color={readyForTraining ? 'success' : 'warning'}
        />
        <StatCard
          title="Most Common Disease"
          value={stats.loading ? '…' : mostCommonDisease}
          icon={FiHeart}
          color="info"
        />
        <StatCard
          title="Diseases Covered"
          value={stats.loading ? '…' : diseasesCount}
          icon={FiList}
          color="success"
        />
      </div>

      {/* ─── Search & Filter ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search by name or diagnosis…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9 w-full"
          />
        </div>
        <div className="relative">
          <FiFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <select
            value={diagFilter}
            onChange={(e) => setDiagFilter(e.target.value)}
            className="input-field pl-9 min-w-[200px]"
          >
            <option value="">All Diagnoses</option>
            {DISEASES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Patients Table ────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Age</th>
                <th className="px-4 py-3">Gender</th>
                <th className="px-4 py-3">Blood Group</th>
                <th className="px-4 py-3">Diagnosis</th>
                <th className="px-4 py-3">Symptoms</th>
                <th className="px-4 py-3">Visit Date</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {patientsApi.loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    Loading patients…
                  </td>
                </tr>
              ) : patientList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    {search || diagFilter
                      ? 'No patients match your filter.'
                      : 'No patients added yet. Click "+ Add Hospital Patient" to begin.'}
                  </td>
                </tr>
              ) : patientList.map((p, idx) => {
                const sev = getSeverity(p.diagnosis);
                return (
                  <tr key={p.patient_id} className="hover:bg-primary-50/20 transition">
                    <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{p.full_name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.age}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{p.gender}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.blood_group || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEVERITY_BADGE[sev]}`}>
                        {p.diagnosis}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.symptoms_count} symptom{p.symptoms_count !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {p.visit_date ? new Date(p.visit_date).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleViewPatient(p.patient_id)}
                        className="inline-flex items-center gap-1 text-primary-500 hover:text-primary-700 text-xs font-semibold transition"
                      >
                        <FiEye className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Export Info + Training Readiness ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Export info card */}
        <div className="card">
          <h3 className="font-semibold text-primary-500 mb-2 flex items-center gap-2 text-sm">
            <FiDownload className="w-4 h-4" /> Export Training Data
          </h3>
          <p className="text-sm text-gray-600 mb-3">
            This CSV contains{' '}
            <strong>{totalPatients}</strong> patient records in the standard training format
            for federated learning training.
          </p>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 bg-success text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition disabled:opacity-60"
          >
            <FiDownload className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Download hospital_training_data.csv'}
          </button>
        </div>

        {/* Training readiness card */}
        <div className={`card border ${readiness.bg}`}>
          <h3 className={`font-bold text-base mb-1 ${readiness.textColor}`}>
            {readiness.icon} {readiness.title}
          </h3>
          <p className={`text-sm font-medium ${readiness.textColor}`}>{readiness.desc}</p>
          <p className="text-sm text-gray-600 mt-1">{readiness.sub}</p>
          <p className="text-sm font-semibold text-gray-700 mt-0.5">{readiness.acc}</p>
          {readiness.showAdd && (
            <button
              onClick={openAdd}
              className="mt-3 inline-flex items-center gap-1.5 bg-warning text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 transition"
            >
              <FiPlus className="w-4 h-4" /> Add Patient
            </button>
          )}
        </div>
      </div>

      {/* ─── Add Patient Modal ─────────────────────────────────────── */}
      <Modal isOpen={modal === 'add'} onClose={closeModal} title="Add Hospital Patient" size="lg">

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-6">
          {[
            { n: 1, label: 'Basic Info' },
            { n: 2, label: 'Medical Info' },
          ].map(({ n, label }, i, arr) => (
            <div key={n} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === n
                  ? 'bg-orange-500 text-white'
                  : step > n
                    ? 'bg-success text-white'
                    : 'bg-gray-200 text-gray-500'
              }`}>
                {step > n ? '✓' : n}
              </div>
              <span className={`text-xs font-medium ${step === n ? 'text-primary-500' : 'text-gray-400'}`}>
                {label}
              </span>
              {i < arr.length - 1 && (
                <div className={`h-px w-10 ${step > n ? 'bg-success' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1 — Basic Info */}
        {step === 1 && (
          <div className="space-y-4">
            <FormInput
              label="Full Name *"
              placeholder="Patient full name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label="Age *"
                type="number"
                placeholder="1–120"
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
              />
              <FormInput
                label="Gender *"
                as="select"
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </div>
            <FormInput
              label="Blood Group"
              as="select"
              value={form.blood_group}
              onChange={(e) => setForm({ ...form, blood_group: e.target.value })}
              options={BLOOD_GROUPS.map((g) => ({ value: g, label: g }))}
            />
            <FormInput
              label="Notes (optional)"
              as="textarea"
              placeholder="Additional clinical notes…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <div className="flex justify-end pt-1">
              <button onClick={goToStep2} className="btn-primary flex items-center gap-1.5">
                Next <FiChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Medical Info */}
        {step === 2 && (
          <div className="space-y-4">

            {/* Diagnosis dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Diagnosis *</label>
              <select
                value={form.diagnosis}
                onChange={(e) => handleDiagnosisChange(e.target.value)}
                className="input-field w-full"
              >
                <option value="">-- Select Disease --</option>
                {DISEASES.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {form.diagnosis && (
                <p className="text-xs mt-1 text-gray-500">
                  Severity:{' '}
                  <span className={`font-semibold capitalize ${
                    getSeverity(form.diagnosis) === 'critical' ? 'text-red-600'
                      : getSeverity(form.diagnosis) === 'moderate' ? 'text-orange-600'
                        : 'text-green-600'
                  }`}>
                    {getSeverity(form.diagnosis)}
                  </span>
                  {DISEASE_SYMPTOMS[form.diagnosis] && ' · Symptoms auto-suggested'}
                </p>
              )}
            </div>

            {/* Symptoms multi-select */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Symptoms *{' '}
                <span className="text-gray-400 font-normal">
                  ({form.symptoms.length} selected)
                </span>
              </label>

              {/* Selected symptom tags */}
              {form.symptoms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 p-2.5 bg-primary-50 rounded-lg border border-primary-100 max-h-24 overflow-y-auto">
                  {form.symptoms.map((s) => (
                    <span
                      key={s}
                      onClick={() => toggleSymptom(s)}
                      className="inline-flex items-center gap-1 bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full cursor-pointer hover:bg-red-500 transition select-none"
                      title="Click to remove"
                    >
                      {s.replace(/_/g, ' ')} <FiX className="w-3 h-3" />
                    </span>
                  ))}
                </div>
              )}

              {/* Symptom search */}
              <div className="relative mb-2">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search symptoms…"
                  value={symptomSearch}
                  onChange={(e) => setSymptomSearch(e.target.value)}
                  className="input-field pl-9 w-full"
                />
              </div>

              {/* Symptoms checklist */}
              <div className="border border-gray-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-gray-50">
                {filteredSymptoms.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-6">No matching symptoms</p>
                ) : filteredSymptoms.map((s) => {
                  const checked = form.symptoms.includes(s);
                  return (
                    <label
                      key={s}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm hover:bg-primary-50/40 transition ${
                        checked ? 'bg-primary-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSymptom(s)}
                        className="w-4 h-4 accent-primary-500 rounded flex-shrink-0"
                      />
                      <span className={checked ? 'text-primary-600 font-medium' : 'text-gray-700'}>
                        {s.replace(/_/g, ' ')}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="btn-secondary flex items-center gap-1.5">
                <FiChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Add Patient'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── View Patient Modal ────────────────────────────────────── */}
      <Modal isOpen={modal === 'view'} onClose={closeModal} title="Patient Details">
        {loadingView ? (
          <div className="py-12 text-center text-gray-400">Loading patient details…</div>
        ) : viewPatient ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Name</span>
                <p className="font-semibold text-gray-800 mt-0.5">{viewPatient.full_name}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Age</span>
                <p className="text-gray-800 mt-0.5">{viewPatient.age} yrs</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Gender</span>
                <p className="text-gray-800 capitalize mt-0.5">{viewPatient.gender}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Blood Group</span>
                <p className="font-mono text-gray-800 mt-0.5">{viewPatient.blood_group || '—'}</p>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500 text-xs uppercase tracking-wide">Diagnosis</span>
                <div className="mt-0.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEVERITY_BADGE[getSeverity(viewPatient.diagnosis)]}`}>
                    {viewPatient.diagnosis}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Visit Date</span>
                <p className="text-gray-800 mt-0.5">
                  {viewPatient.visit_date
                    ? new Date(viewPatient.visit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                </p>
              </div>
            </div>

            {viewPatient.notes && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <span className="font-medium text-gray-700">Notes:</span>{' '}
                <span className="text-gray-600">{viewPatient.notes}</span>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Symptoms ({viewPatient.symptoms?.length || 0})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(viewPatient.symptoms || []).map((s) => (
                  <span key={s} className="text-xs bg-secondary/10 text-secondary px-2 py-0.5 rounded-full">
                    {s.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={closeModal} className="btn-primary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ─── Import CSV Modal ──────────────────────────────────────── */}
      <Modal isOpen={modal === 'import'} onClose={closeModal} title="Import Patients from CSV" size="lg">
        <div className="space-y-4">

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <p className="font-semibold mb-1">How to import:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
              <li>Download template first (grey button in header)</li>
              <li>Fill patient data in Excel / Sheets</li>
              <li>Save as CSV format (.csv)</li>
              <li>Upload here</li>
            </ol>
          </div>

          {/* File drop zone */}
          {!importResult && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCsvDrop}
              onClick={() => csvInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-success hover:bg-green-50/30 transition"
            >
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              />
              {csvFile ? (
                <div>
                  <p className="text-2xl mb-1">📄</p>
                  <p className="font-semibold text-gray-700">{csvFile.name}</p>
                  <p className="text-xs text-gray-400 mt-1">Click to change file</p>
                </div>
              ) : (
                <div>
                  <p className="text-3xl mb-2">📄</p>
                  <p className="text-gray-600 font-medium">Drop CSV file here</p>
                  <p className="text-gray-400 text-sm mt-1">or click to browse</p>
                  <p className="text-xs text-gray-400 mt-2">Accepts .csv only</p>
                </div>
              )}
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="font-bold text-green-700 text-base">
                  ✅ Success: {importResult.imported} patients imported!
                </p>
              </div>
              {importResult.warning_list?.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="font-semibold text-yellow-700 mb-1">⚠️ {importResult.warnings} warnings:</p>
                  <ul className="text-xs text-yellow-700 space-y-0.5 list-disc list-inside">
                    {importResult.warning_list.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              {importResult.error_list?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="font-semibold text-red-700 mb-1">❌ {importResult.errors} errors:</p>
                  <ul className="text-xs text-red-700 space-y-0.5 list-disc list-inside">
                    {importResult.error_list.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-1">
            <button onClick={closeModal} className="btn-secondary">Cancel</button>
            {importResult ? (
              <button onClick={closeModal} className="btn-primary">View Patients</button>
            ) : (
              <button
                onClick={handleImport}
                disabled={importing || !csvFile}
                className="inline-flex items-center gap-1.5 bg-success text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {importing ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                ) : (
                  <><FiUpload className="w-4 h-4" /> Import Patients</>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* ─── Generate Demo Modal ───────────────────────────────────── */}
      <Modal isOpen={modal === 'generate'} onClose={closeModal} title="Generate Demo Patients">
        <div className="space-y-4">

          {/* Info card */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
            <p className="font-semibold mb-0.5">What this does:</p>
            <p className="text-purple-700">
              Generates realistic demo patients with proper symptoms and diagnoses
              from the reference symptom dataset — ideal for FL training testing.
            </p>
          </div>

          {!demoResult && (
            <>
              {/* Count selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How many patients to generate?{' '}
                  <span className="text-purple-600 font-bold">{demoCount}</span>
                </label>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={5}
                  value={demoCount}
                  onChange={(e) => setDemoCount(Number(e.target.value))}
                  className="w-full accent-purple-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>10</span><span>50</span>
                </div>
              </div>

              {/* Coverage info */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                <p>Covers <strong>15 different diseases</strong> from the reference symptom dataset including Diabetes, Malaria, Tuberculosis, Hypertension, Dengue, and more.</p>
              </div>
            </>
          )}

          {/* Result */}
          {demoResult && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="font-bold text-green-700 text-base">
                  ✅ {demoResult.generated} demo patients generated!
                </p>
                <p className="text-sm text-green-600 mt-0.5">
                  Total patients now: {demoResult.total_patients}
                </p>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Age</th>
                      <th className="px-3 py-2 text-left">Disease</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(demoResult.patients || []).slice(0, 8).map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium text-gray-700">{p.name}</td>
                        <td className="px-3 py-1.5 text-gray-500">{p.age}</td>
                        <td className="px-3 py-1.5 text-gray-600">{p.diagnosis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {demoResult.generated > 8 && (
                  <p className="text-xs text-gray-400 text-center py-1.5">
                    +{demoResult.generated - 8} more patients…
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-1">
            <button onClick={closeModal} className="btn-secondary">Cancel</button>
            {demoResult ? (
              <button onClick={closeModal} className="btn-primary">View All Patients</button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-1.5 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50"
              >
                {generating ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                ) : (
                  <><FiCpu className="w-4 h-4" /> Generate Patients</>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>

    </DashboardLayout>
  );
};

export default HospitalPatientsPage;
