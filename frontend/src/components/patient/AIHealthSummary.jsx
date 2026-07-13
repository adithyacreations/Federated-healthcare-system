import { useState } from 'react';
import { motion } from 'framer-motion';

import API from '../../api/axios';

const SECTION_EMOJI = ['🌟', '📋', '💡', '✅', '🎯', '👉', '⚕️'];

const buildPrompt = (data) => `
You are a friendly healthcare AI assistant for FederCare Health Network.

Generate a warm, personalized health summary for this patient based on their recent records.

Patient: ${data.basic_info.name}
Age: ${data.basic_info.age}
Blood Group: ${data.basic_info.blood_group}
Gender: ${data.basic_info.gender}

Overall Health Activity:
- Total Consultations: ${data.stats.total_consultations}
- Total Prescriptions: ${data.stats.total_prescriptions}
- Total Lab Tests: ${data.stats.total_lab_tests}

Recent Activity details (last 90 days):

${data.consultations.length > 0 ? `Recent Consultations:
${data.consultations.map((c) => `- ${c.date}: Dr. ${c.doctor}${c.diagnosis ? ' (' + c.diagnosis.slice(0, 50) + ')' : ''}`).join('\n')}` : 'No recent consultations.'}

${data.prescriptions.length > 0 ? `Recent Medicines Prescribed:
${data.prescriptions.map((p) => `- ${p.date}: ${p.medicines.slice(0, 3).join(', ')}`).join('\n')}` : 'No recent prescriptions.'}

${data.lab_tests.length > 0 ? `Recent Lab Tests:
${data.lab_tests.map((l) => `- ${l.date}: ${l.tests.slice(0, 3).join(', ')}${l.abnormal_count > 0 ? ' (' + l.abnormal_count + ' abnormal)' : ''}`).join('\n')}` : 'No recent lab tests.'}

Please write a health summary with these sections:
🌟 Overall Health Status
📋 Recent Health Activity
💡 Key Insights
✅ What's Going Well
🎯 Tips for Better Health
👉 Next Steps

Rules:
- Be warm, friendly and encouraging
- Use simple non-medical language
- Keep under 250 words
- Use the emoji headers shown above
- Do NOT diagnose or prescribe
- End with: "⚕️ Always consult your doctor for medical decisions"
`;

const generateDemoSummary = (data) => {
  const name = (data.basic_info.name || 'there').split(' ')[0];
  const hasConsults = data.stats.total_consultations > 0;
  const hasLabs = data.stats.total_lab_tests > 0;

  return `🌟 Overall Health Status
Hi ${name}! Your health profile shows ${hasConsults ? 'active healthcare engagement' : 'room for more regular check-ups'} with FederCare.

📋 Overall Health Activity
- ${data.stats.total_consultations} doctor consultation(s) completed
- ${data.stats.total_prescriptions} prescription(s) issued
- ${data.stats.total_lab_tests} lab test(s) done

💡 Key Insights
${hasConsults ? 'You are proactively managing your health by visiting doctors regularly — keep it up!' : 'Consider scheduling a routine check-up to stay ahead of any health concerns.'}
${hasLabs ? 'Your lab tests help track important health markers.' : 'Lab tests can give valuable insights into your health status.'}

✅ What's Going Well
- Your health records are securely stored in FederCare
- ${hasConsults ? 'You are staying connected with healthcare providers' : 'You have access to excellent healthcare through FederCare'}
- Your EHR wallet keeps all your records organized

🎯 Tips for Better Health
1. Schedule regular check-ups every 6 months
2. Keep your medicines and allergies updated in EHR
3. Stay hydrated and maintain a balanced diet

👉 Next Steps
${hasConsults ? 'Follow up on your recent consultations and complete prescribed medicines.' : 'Book a consultation with a doctor for a routine health check.'}

⚕️ Always consult your doctor for medical decisions.`;
};

const formatText = (text) => (text ? text.split('\n').filter((line) => line.trim()) : []);
const isSectionHeader = (line) => SECTION_EMOJI.some((e) => line.startsWith(e));

// Gemini emits Markdown (`**bold**`, `*italic*`, `# headers`) freely — strip it
// so the patient sees clean prose instead of raw stars and hashes.
const cleanText = (text) => {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s/gm, '')
    .trim();
};

const AIHealthSummary = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState(null);

  const generateSummary = async () => {
    setLoading(true);
    setError(null);
    let data = null;

    try {
      const res = await API.get('/api/patient/health-data/');
      if (!res.data?.success) throw new Error('Failed to fetch health data');
      data = res.data.data;

      // Gemini is called through the backend proxy — the API key stays on the
      // server and never reaches the browser.
      const aiRes = await API.post('/api/ai/health-summary/', {
        prompt: buildPrompt(data),
        patient_id: data.basic_info?.patient_id,
      });

      // Handle multiple possible response shapes — the backend wraps in
      // {success, data: {summary}} via the ok() helper, but be defensive.
      const resData = aiRes.data;
      const text =
        (resData?.success && resData?.data?.summary) ||
        resData?.summary ||
        resData?.data?.summary ||
        resData?.text ||
        null;
      if (!text) throw new Error(resData?.message || 'Empty response from AI');

      setSummary({
        text,
        patient_name: resData?.data?.patient_name || data.basic_info?.name || '',
        is_demo: false,
        generated_at: new Date().toISOString(),
        stats: data.stats,
      });
      setGenerated(true);
    } catch (err) {
      console.error('Health summary error:', err);
      if (data) {
        setSummary({
          text: generateDemoSummary(data),
          is_demo: true,
          generated_at: new Date().toISOString(),
          stats: data.stats,
        });
        setGenerated(true);
      } else {
        setError('Failed to generate summary. Please try again!');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
          >
            🧠
          </div>
          <div>
            <h3 className="font-bold text-black">AI Health Summary</h3>
            <p className="text-xs text-gray-400">Powered by Gemini AI</p>
          </div>
        </div>

        <button
          onClick={generateSummary}
          disabled={loading}
          className="px-4 py-2 rounded-full text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: '#F97316' }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </span>
          ) : generated ? '🔄 Regenerate' : '✨ Generate'}
        </button>
      </div>

      {/* Body */}
      <div className="p-5">
        {!generated && !loading && !error && (
          <div className="text-center py-8">
            <p className="text-5xl mb-3">🏥</p>
            <p className="font-semibold text-gray-700 mb-2">Your AI Health Summary</p>
            <p className="text-sm text-gray-400 mb-4 max-w-xs mx-auto">
              Get a personalized health overview based on your FederCare records
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {['📋 Consultations', '💊 Medicines', '🔬 Lab Tests', '💡 Insights'].map((item) => (
                <span
                  key={item}
                  className="text-xs px-3 py-1 rounded-full"
                  style={{ backgroundColor: '#FFF7ED', color: '#F97316' }}
                >
                  {item}
                </span>
              ))}
            </div>
            <button
              onClick={generateSummary}
              className="px-8 py-3 rounded-full font-semibold text-white"
              style={{ backgroundColor: '#F97316' }}
            >
              ✨ Generate My Summary
            </button>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="font-medium text-gray-600 mb-1">Analyzing your health records...</p>
            <p className="text-xs text-gray-400">
              Gemini AI is reviewing your medical history
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-50 rounded-xl p-4 text-center">
            <p className="text-red-500 text-sm mb-2">{error}</p>
            <button onClick={generateSummary} className="text-sm underline" style={{ color: '#F97316' }}>
              Try again
            </button>
          </div>
        )}

        {summary && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center p-3 rounded-xl" style={{ backgroundColor: '#FFF7ED' }}>
                <p className="font-bold text-lg" style={{ color: '#F97316' }}>
                  {summary.stats?.total_consultations || 0}
                </p>
                <p className="text-xs text-gray-500">Consultations</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-gray-50">
                <p className="font-bold text-lg text-black">
                  {summary.stats?.total_prescriptions || 0}
                </p>
                <p className="text-xs text-gray-500">Prescriptions</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-gray-50">
                <p className="font-bold text-lg text-black">
                  {summary.stats?.total_lab_tests || 0}
                </p>
                <p className="text-xs text-gray-500">Lab Tests</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-1" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {formatText(summary.text).map((line, i) => (
                <p
                  key={i}
                  className={`leading-relaxed ${
                    isSectionHeader(line)
                      ? 'font-bold text-black text-sm mt-3 first:mt-0'
                      : 'text-sm text-gray-600 ml-2'
                  }`}
                >
                  {cleanText(line)}
                </p>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                {summary.is_demo ? '📋 Sample summary' : '🧠 Gemini AI'}
                {' · '}
                {new Date(summary.generated_at).toLocaleTimeString('en-IN', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
              <p className="text-xs text-gray-400">⚕️ Not medical advice</p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default AIHealthSummary;
